// Browser side of import: unzip and hash locally, then look hashes up on Modrinth.
// Only SHA-1 hashes (and names, for mods whose hash isn't found) leave the browser, never the files.
import { isModPath, JAR_META, majorityLoader, MAX_FILES, parsePackIndex, type JarInfo } from '../core/import';
import type { Loader } from '../core/types';
import { resolveNames } from './data';

const MODRINTH = 'https://api.modrinth.com/v2';
const BATCH = 500;

export interface ImportResult {
  ids: string[];
  /** list name, when importing a pack */
  name: string | null;
  loader: Loader | null;
  gameVersion: string | null;
  byName: string[];
  missing: string[];
  skipped: number;
}

export async function sha1(data: ArrayBuffer | Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-1', data as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** hash -> project id, for every hash Modrinth knows. */
export async function lookupHashes(hashes: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (let i = 0; i < hashes.length; i += BATCH) {
    const res = await fetch(`${MODRINTH}/version_files`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ hashes: hashes.slice(i, i + BATCH), algorithm: 'sha1' }),
    });
    if (!res.ok) throw new Error(`Modrinth ${res.status}`);
    for (const [hash, v] of Object.entries((await res.json()) as Record<string, { project_id: string }>)) out.set(hash, v.project_id);
  }
  return out;
}

async function jarInfo(bytes: Uint8Array): Promise<JarInfo | null> {
  const { unzipSync, strFromU8 } = await import('fflate');
  const wanted = new Set(JAR_META.map((m) => m.path));
  const files = unzipSync(bytes, { filter: (f) => wanted.has(f.name) });
  for (const m of JAR_META) {
    if (!files[m.path]) continue;
    try {
      return m.parse(strFromU8(files[m.path]));
    } catch {
      // malformed metadata: try the next format
    }
  }
  return null;
}

/** Jars: hash each; for hashes Modrinth doesn't know, fall back to the mod's declared id/name. */
async function importJars(jars: { name: string; bytes: () => Promise<Uint8Array> }[], loader: Loader, onProgress: (msg: string) => void) {
  const hashes = new Map<string, (typeof jars)[number]>();
  let done = 0;
  // sequential on purpose: one jar in memory at a time
  for (const jar of jars) {
    hashes.set(await sha1(await jar.bytes()), jar);
    if (++done % 10 === 0) onProgress(`Checking ${done} of ${jars.length}…`);
  }
  onProgress('Looking mods up on Modrinth…');
  const found = await lookupHashes([...hashes.keys()]);
  const ids = new Set(found.values());
  const byName: string[] = [];
  const missing: string[] = [];
  const loaders: (Loader | null)[] = [];
  for (const [hash, jar] of hashes) {
    if (found.has(hash)) continue;
    const info = await jarInfo(await jar.bytes()).catch(() => null);
    loaders.push(info?.loader ?? null);
    const key = info?.id ?? info?.name;
    if (!key) {
      missing.push(jar.name);
      continue;
    }
    const { found: r } = await resolveNames([key.toLowerCase()], info?.loader ?? loader);
    const hit = r.values().next().value;
    if (hit) {
      ids.add(hit.id);
      byName.push(`${jar.name} → ${hit.title}`);
    } else missing.push(jar.name);
  }
  return { ids: [...ids], byName, missing, loaderHint: majorityLoader(loaders) };
}

async function importPack(file: File, loader: Loader, onProgress: (msg: string) => void): Promise<ImportResult> {
  const { unzipSync, strFromU8 } = await import('fflate');
  onProgress(`Reading ${file.name}…`);
  const zip = unzipSync(new Uint8Array(await file.arrayBuffer()), {
    filter: (f) => f.name === 'modrinth.index.json' || (/overrides\//.test(f.name) && isModPath(f.name)),
  });
  const entry = zip['modrinth.index.json'];
  if (!entry) throw new Error(`${file.name} isn't a Modrinth modpack (no modrinth.index.json).`);
  const pack = parsePackIndex(strFromU8(entry));
  onProgress('Looking mods up on Modrinth…');
  const found = await lookupHashes(pack.hashes);
  const packLoader = pack.loader ?? loader;
  // mods bundled in the pack rather than downloaded have no entry in the index
  const bundled = Object.entries(zip)
    .filter(([n]) => n !== 'modrinth.index.json')
    .map(([n, b]) => ({ name: n.split('/').pop()!, bytes: async () => b }));
  const extra = await importJars(bundled, packLoader, onProgress);
  const missingFromIndex = pack.hashes.length - new Set(pack.hashes.filter((h) => found.has(h))).size;
  return {
    ids: [...new Set([...found.values(), ...extra.ids])],
    name: pack.name,
    loader: pack.loader,
    gameVersion: pack.gameVersion,
    byName: extra.byName,
    missing: [...extra.missing, ...(missingFromIndex ? [`${missingFromIndex} file(s) listed in the pack`] : [])],
    skipped: 0,
  };
}

/** Entry point for dropped or picked files: one or more .mrpack and/or .jar. */
export async function importFiles(all: File[], loader: Loader, onProgress: (msg: string) => void): Promise<ImportResult> {
  const pack = all.find((f) => /\.mrpack$/i.test(f.name));
  if (pack) return importPack(pack, loader, onProgress);
  const jars = all.filter((f) => /\.jar$/i.test(f.name));
  if (!jars.length) throw new Error('Drop a .mrpack file or your mods folder\'s .jar files.');
  const used = jars.slice(0, MAX_FILES);
  const r = await importJars(
    used.map((f) => ({ name: f.name, bytes: async () => new Uint8Array(await f.arrayBuffer()) })),
    loader,
    onProgress,
  );
  return { ids: r.ids, name: null, loader: r.loaderHint, gameVersion: null, byName: r.byName, missing: r.missing, skipped: jars.length - used.length };
}
