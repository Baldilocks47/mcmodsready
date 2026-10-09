// Client-side data access. Precomputed data comes from our /data host; anything not precomputed
// (mods under the download threshold) is looked up live from Modrinth in the browser and turned
// into the same ModFile shape with the same core code, so the UI can't tell the difference.
import { deriveModFile, projectFromHit } from '../core/support';
import type { Loader, ModFile, ModProject, ModVersion } from '../core/types';
import type { MatrixFile, MetaFile, VersionShard } from '../data-schema';
import { DATA_BASE } from './status';

const MODRINTH = 'https://api.modrinth.com/v2';
const cache = new Map<string, Promise<unknown>>();

function getJson<T>(url: string, allow404 = false): Promise<T | null> {
  let p = cache.get(url) as Promise<T | null> | undefined;
  if (!p) {
    p = fetch(url).then((r) => {
      if (allow404 && r.status === 404) return null;
      if (!r.ok) throw new Error(`${url}: ${r.status}`);
      return r.json() as Promise<T>;
    });
    cache.set(url, p);
    p.catch(() => cache.delete(url));
  }
  return p;
}

const data = <T>(file: string, allow404 = false) => getJson<T>(`${DATA_BASE}/${file}`, allow404);

export const loadMeta = () => data<MetaFile>('meta.json') as Promise<MetaFile>;
export const loadMatrix = (loader: Loader) => data<MatrixFile>(`matrix-${loader}.json`) as Promise<MatrixFile>;
export const loadShard = async (loader: Loader, version: string) =>
  (await data<VersionShard>(`v/${loader}/${encodeURIComponent(version)}.json`, true))?.mods ?? {};

/** Load mods by Modrinth project id (or slug, for live ones). Precomputed first, live for the rest. */
export async function loadMods(ids: string[]): Promise<Map<string, ModFile>> {
  const out = new Map<string, ModFile>();
  const pre = await Promise.all(ids.map((id) => data<ModFile>(`m/${id}.json`, true).catch(() => null)));
  const missing: string[] = [];
  ids.forEach((id, i) => (pre[i] ? out.set(id, pre[i]!) : missing.push(id)));
  if (missing.length) for (const [k, v] of await liveMods(missing)) out.set(k, v);
  return out;
}

const liveCache = new Map<string, Promise<ModFile | null>>();

/** Look mods up directly on Modrinth (CORS is open). Keyed by the id/slug asked for. */
export async function liveMods(idsOrSlugs: string[]): Promise<Map<string, ModFile>> {
  const out = new Map<string, ModFile>();
  const todo = idsOrSlugs.filter((x) => !liveCache.has(x));
  if (todo.length) {
    const projectsP = getJson<RawProject[]>(`${MODRINTH}/projects?ids=${encodeURIComponent(JSON.stringify(todo))}`).then((ps) => ps ?? []);
    for (const key of todo) {
      liveCache.set(
        key,
        projectsP.then(async (ps) => {
          const p = ps.find((x) => x.id === key || x.slug === key.toLowerCase());
          if (!p) return null;
          const vs = await getJson<ModVersion[]>(`${MODRINTH}/project/${p.id}/version?include_changelog=false`);
          return { ...deriveModFile(fromProject(p), vs ?? []), live: true };
        }),
      );
    }
  }
  await Promise.all(
    idsOrSlugs.map(async (k) => {
      const m = await liveCache.get(k)!.catch(() => null);
      if (m) out.set(k, m);
    }),
  );
  return out;
}

export interface SearchResult {
  id: string;
  slug: string;
  title: string;
  icon: string | null;
  downloads: number;
}

/** Search all of Modrinth (not just tracked mods). */
export async function searchMods(query: string, loader: Loader, limit = 8): Promise<SearchResult[]> {
  const facets = encodeURIComponent(JSON.stringify([['project_type:mod'], [`categories:${loader}`]]));
  const r = await getJson<{ hits: Parameters<typeof projectFromHit>[0][] }>(
    `${MODRINTH}/search?query=${encodeURIComponent(query)}&facets=${facets}&limit=${limit}`,
  );
  return (r?.hits ?? []).map((h) => ({ id: h.project_id, slug: h.slug, title: h.title, icon: h.icon_url || null, downloads: h.downloads }));
}

/** Resolve pasted slugs, ids or names to project ids. */
export async function resolveNames(keys: string[], loader: Loader): Promise<{ found: Map<string, SearchResult>; notFound: string[] }> {
  const found = new Map<string, SearchResult>();
  const plain = keys.filter((k) => /^[a-z0-9_.-]+$/i.test(k));
  if (plain.length) {
    const ps = (await getJson<RawProject[]>(`${MODRINTH}/projects?ids=${encodeURIComponent(JSON.stringify(plain))}`)) ?? [];
    for (const k of plain) {
      const p = ps.find((x) => x.slug === k.toLowerCase() || x.id === k);
      if (p) found.set(k, { id: p.id, slug: p.slug, title: p.title, icon: p.icon_url || null, downloads: p.downloads });
    }
  }
  const rest = keys.filter((k) => !found.has(k));
  await Promise.all(
    rest.map(async (k) => {
      const [hit] = await searchMods(k, loader, 1);
      if (hit && hit.title.toLowerCase().replace(/[^a-z0-9]/g, '').includes(k.toLowerCase().replace(/[^a-z0-9]/g, ''))) found.set(k, hit);
    }),
  );
  return { found, notFound: keys.filter((k) => !found.has(k)) };
}

interface RawProject {
  id: string;
  slug: string;
  title: string;
  description: string;
  icon_url: string | null;
  downloads: number;
  categories: string[];
  loaders: string[];
  project_type: string;
  client_side: string;
  server_side: string;
  environment?: string[] | string;
  updated: string;
}

function fromProject(p: RawProject): ModProject {
  return {
    ...p,
    icon_url: p.icon_url || null,
    environment: typeof p.environment === 'string' ? [p.environment] : p.environment,
  };
}
