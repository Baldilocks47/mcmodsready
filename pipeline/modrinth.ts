// Minimal Modrinth v2 client: identifies itself, paces requests, respects X-Ratelimit headers,
// backs off on 429/5xx and network errors.
import type { Loader, ModVersion } from '../src/lib/core/types';

const API = 'https://api.modrinth.com/v2';

export const USER_AGENT =
  process.env.MODRINTH_USER_AGENT || 'mcmodsready/0.1 (mod readiness tracker; https://mcmodsready.com)';

/** Minimum gap between request starts: ~270/min, under Modrinth's 300/min. */
const MIN_GAP_MS = Number(process.env.MODRINTH_MIN_GAP_MS ?? 220);

let remaining = 300;
let resetAt = 0;
let nextSlot = 0;

async function pace() {
  const now = Date.now();
  const wait = Math.max(0, nextSlot - now);
  nextSlot = Math.max(now, nextSlot) + MIN_GAP_MS;
  if (wait) await sleep(wait);
  if (remaining < 5 && Date.now() < resetAt) await sleep(resetAt - Date.now() + 250);
}

async function get<T>(path: string, attempt = 0): Promise<T> {
  await pace();
  let res: Response;
  try {
    res = await fetch(API + path, { headers: { 'User-Agent': USER_AGENT } });
  } catch (e) {
    if (attempt >= 5) throw e;
    await sleep(1000 * 2 ** attempt);
    return get<T>(path, attempt + 1);
  }
  remaining = Number(res.headers.get('x-ratelimit-remaining') ?? remaining);
  const reset = Number(res.headers.get('x-ratelimit-reset') ?? 0);
  resetAt = Date.now() + reset * 1000;

  if (res.status === 429 || res.status >= 500) {
    if (attempt >= 5) throw new Error(`Modrinth ${res.status} on ${path} after retries`);
    await sleep(Math.max(reset * 1000, 1000 * 2 ** attempt));
    return get<T>(path, attempt + 1);
  }
  if (res.status === 404) return null as T;
  if (!res.ok) throw new Error(`Modrinth ${res.status} on ${path}`);
  return (await res.json()) as T;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const q = (v: unknown) => encodeURIComponent(JSON.stringify(v));

export interface SearchHit {
  project_id: string;
  project_type: string;
  slug: string;
  title: string;
  description: string;
  icon_url: string | null;
  downloads: number;
  categories: string[];
  client_side: string;
  server_side: string;
  environment?: string[] | string;
  date_modified: string;
}

/** All mods for a loader with at least `minDownloads`, most downloaded first (capped at `max`). */
export async function modsForLoader(loader: Loader, minDownloads: number, max: number): Promise<SearchHit[]> {
  const hits: SearchHit[] = [];
  const facets = q([['project_type:mod'], [`categories:${loader}`], [`downloads>=${minDownloads}`]]);
  for (let offset = 0; offset < max; offset += 100) {
    const res = await get<{ hits: SearchHit[] }>(`/search?facets=${facets}&index=downloads&limit=100&offset=${offset}`);
    hits.push(...res.hits);
    if (res.hits.length < 100) break;
  }
  return hits.slice(0, max);
}

/** All versions of a project (all loaders), trimmed to the fields we use. null if the project is gone. */
export async function versions(projectId: string): Promise<ModVersion[] | null> {
  const raw = await get<ModVersion[] | null>(`/project/${projectId}/version?include_changelog=false`);
  if (!raw) return null;
  return raw.map((v) => ({
    id: v.id,
    project_id: v.project_id,
    version_number: v.version_number,
    game_versions: v.game_versions,
    loaders: v.loaders,
    version_type: v.version_type,
    date_published: v.date_published,
    dependencies: (v.dependencies ?? []).map((d) => ({ project_id: d.project_id, dependency_type: d.dependency_type })),
  }));
}

/** Bulk project lookup by id or slug (used by the contract check). */
export async function projects<T = Record<string, unknown>>(ids: string[]): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += 100) out.push(...(await get<T[]>(`/projects?ids=${q(ids.slice(i, i + 100))}`)));
  return out;
}

/** Run `fn` over items with bounded concurrency. */
export async function pool<T, R>(items: T[], size: number, fn: (t: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: size }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    }),
  );
  return out;
}
