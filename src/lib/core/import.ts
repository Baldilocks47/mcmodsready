// Turn a modpack or a mods folder into a list of hashes (and fallback names) to look up on Modrinth.
// Pure parsing only: unzipping and hashing happen in the browser (src/lib/ui/import.ts), and files never leave it.
import { LOADERS, type Loader } from './types';

export interface PackIndex {
  name: string;
  loader: Loader | null;
  /** Minecraft version the pack is built for */
  gameVersion: string | null;
  /** SHA-1 of each mod listed in the index */
  hashes: string[];
}

interface RawIndex {
  name?: string;
  dependencies?: Record<string, string>;
  files?: { path?: string; hashes?: { sha1?: string } }[];
}

const LOADER_KEYS: Record<string, Loader> = { 'fabric-loader': 'fabric', neoforge: 'neoforge', forge: 'forge' };

/** Parse a .mrpack's modrinth.index.json. Throws if it isn't one. */
export function parsePackIndex(json: string): PackIndex {
  const raw = JSON.parse(json) as RawIndex;
  if (!raw || !Array.isArray(raw.files)) throw new Error('Not a Modrinth modpack index');
  const dep = raw.dependencies ?? {};
  const key = Object.keys(dep).find((k) => k in LOADER_KEYS);
  return {
    name: (raw.name ?? 'Imported pack').slice(0, 80),
    loader: key ? LOADER_KEYS[key] : null,
    gameVersion: dep.minecraft ?? null,
    hashes: [
      ...new Set(
        raw.files
          .filter((f) => isModPath(f.path ?? '') && /^[0-9a-f]{40}$/i.test(f.hashes?.sha1 ?? ''))
          .map((f) => f.hashes!.sha1!.toLowerCase()),
      ),
    ],
  };
}

/** Mods only: not resource packs, shaders or config inside a pack. */
export function isModPath(path: string): boolean {
  return /(^|\/)mods\/[^/]+\.jar$/i.test(path.replace(/\\/g, '/'));
}

/** Mod name/id declared inside a jar, as a fallback when its hash isn't on Modrinth. */
export interface JarInfo {
  id: string | null;
  name: string | null;
  loader: Loader | null;
}

export function parseFabricModJson(text: string): JarInfo {
  const j = JSON.parse(text) as { id?: string; name?: string };
  return { id: j.id ?? null, name: j.name ?? null, loader: 'fabric' };
}

/** Enough of mods.toml for this: the first [[mods]] block's modId and displayName. */
export function parseModsToml(text: string, loader: Loader): JarInfo {
  const block = text.split(/^\s*\[\[mods\]\]\s*$/m)[1] ?? '';
  const field = (k: string) => new RegExp(`^\\s*${k}\\s*=\\s*["']([^"']*)["']`, 'm').exec(block)?.[1] ?? null;
  const id = field('modId');
  // "${file.jarVersion}"-style templates aren't useful names
  const name = field('displayName');
  return { id, name: name && !name.includes('${') ? name : null, loader };
}

/** Which metadata file in a jar to read, in order of preference. */
export const JAR_META: { path: string; parse: (text: string) => JarInfo }[] = [
  { path: 'fabric.mod.json', parse: parseFabricModJson },
  { path: 'META-INF/neoforge.mods.toml', parse: (t) => parseModsToml(t, 'neoforge') },
  { path: 'META-INF/mods.toml', parse: (t) => parseModsToml(t, 'forge') },
];

export function isLoader(x: unknown): x is Loader {
  return (LOADERS as unknown[]).includes(x);
}

/** The loader most jars in a folder were built for. */
export function majorityLoader(loaders: (Loader | null)[]): Loader | null {
  const counts = new Map<Loader, number>();
  for (const l of loaders) if (l) counts.set(l, (counts.get(l) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

export function summariseImport(r: { found: number; byName: string[]; missing: string[]; skipped?: number }): string {
  const parts = [`Added ${r.found} mod${r.found === 1 ? '' : 's'}.`];
  if (r.byName.length) parts.push(`Matched by name, so please check: ${list(r.byName)}.`);
  if (r.missing.length) parts.push(`Not found on Modrinth: ${list(r.missing)}.`);
  if (r.skipped) parts.push(`Skipped ${r.skipped} over the ${MAX_FILES}-file limit.`);
  return parts.join(' ');
}

const list = (xs: string[]) => xs.slice(0, 10).join(', ') + (xs.length > 10 ? ` and ${xs.length - 10} more` : '');

/** Keeps a huge drop from exhausting browser memory. */
export const MAX_FILES = 1000;
