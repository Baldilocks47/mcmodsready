// Turn a project's raw Modrinth version list into a compact per-loader support map.
// Used by the pipeline (precomputed mods) and the browser (live lookups), so both agree exactly.
import { envOf } from './status';
import { LOADERS, type Loader, type LoaderSupport, type ModFile, type ModProject, type ModVersion, type SupportEntry } from './types';

const DAY = 86_400_000;
const RANK = { r: 3, b: 2, a: 1 } as const;
const CODE = { release: 'r', beta: 'b', alpha: 'a' } as const;

export const epochDay = (iso: string) => Math.floor(Date.parse(iso) / DAY);

export function deriveSupport(versions: ModVersion[], loader: Loader): LoaderSupport | undefined {
  const forLoader = versions.filter((v) => v.loaders.includes(loader));
  if (!forLoader.length) return undefined;

  const v: Record<string, SupportEntry> = {};
  for (const ver of forLoader) {
    const code = CODE[ver.version_type] ?? 'a';
    const day = epochDay(ver.date_published);
    for (const gv of ver.game_versions) {
      const cur = v[gv];
      if (!cur) {
        v[gv] = code === 'r' ? ['r', day] : [code];
        continue;
      }
      if (RANK[code] > RANK[cur[0]]) cur[0] = code;
      if (code === 'r' && (cur[1] === undefined || day < cur[1])) cur[1] = day;
    }
  }

  const newest = [...forLoader].sort((a, b) => b.date_published.localeCompare(a.date_published));
  const required = (ver: ModVersion | undefined) =>
    [...new Set((ver?.dependencies ?? []).filter((d) => d.dependency_type === 'required' && d.project_id).map((d) => d.project_id!))].sort();
  const deps = required(newest[0]);
  // A library a mod needs on 26.3 may not exist on 1.20.1: record per-version deps where they differ.
  const d: Record<string, string[]> = {};
  const seen = new Set<string>();
  for (const ver of newest) {
    for (const gv of ver.game_versions) {
      if (seen.has(gv)) continue;
      seen.add(gv);
      const r = required(ver);
      if (r.join() !== deps.join()) d[gv] = r;
    }
  }
  const incompat = [
    ...new Set(
      forLoader.flatMap((ver) =>
        ver.dependencies.filter((d) => d.dependency_type === 'incompatible' && d.project_id).map((d) => d.project_id!),
      ),
    ),
  ];
  return { v, deps, ...(Object.keys(d).length ? { d } : {}), incompat };
}

/** Normalise a Modrinth search hit into the project shape we use. */
export function projectFromHit(h: {
  project_id: string;
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
  project_type: string;
}): ModProject {
  const loaders = h.categories.filter((c) => (LOADERS as string[]).includes(c) || c === 'quilt');
  return {
    id: h.project_id,
    slug: h.slug,
    title: h.title,
    description: h.description,
    icon_url: h.icon_url || null,
    downloads: h.downloads,
    categories: h.categories.filter((c) => !loaders.includes(c)),
    loaders,
    project_type: h.project_type,
    client_side: h.client_side,
    server_side: h.server_side,
    environment: typeof h.environment === 'string' ? [h.environment] : h.environment,
    updated: h.date_modified,
  };
}

export function deriveModFile(p: ModProject, versions: ModVersion[]): ModFile {
  const loaders: ModFile['loaders'] = {};
  for (const l of LOADERS) {
    const s = deriveSupport(versions, l);
    if (s) loaders[l] = s;
  }
  return {
    id: p.id,
    slug: p.slug,
    title: p.title,
    description: p.description,
    icon: p.icon_url,
    downloads: p.downloads,
    env: envOf(p),
    categories: p.categories.filter((c) => !(LOADERS as string[]).includes(c)),
    updated: p.updated,
    loaders,
  };
}
