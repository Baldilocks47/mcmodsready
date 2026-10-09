import type { Cell, Drop, Env, Loader, ModProject, ModVersion } from './types';

const DAY = 86_400_000;

/** How long without updates (and without the latest drops) before a mod is "dropped". */
export const DROPPED_AFTER_DAYS = 365;

/** Normalise Modrinth's environment info into one value. Prefers the newer `environment` field. */
export function envOf(p: Pick<ModProject, 'client_side' | 'server_side' | 'environment'>): Env {
  const e = p.environment?.[0];
  switch (e) {
    case 'client_only':
    case 'client_only_server_optional':
      return 'client';
    case 'server_only':
    case 'server_only_client_optional':
    case 'dedicated_server_only':
      return 'server';
    case 'client_and_server':
      return 'both';
    case 'client_or_server':
    case 'client_or_server_prefers_both':
      return 'either';
  }
  const c = p.client_side;
  const s = p.server_side;
  if (c === 'unknown' || s === 'unknown' || !c || !s) return 'unknown';
  if (c === 'required' && s === 'required') return 'both';
  if (c !== 'unsupported' && s === 'unsupported') return 'client';
  if (s !== 'unsupported' && c === 'unsupported') return 'server';
  if (c === 'optional' && s === 'optional') return 'either';
  if (c === 'required') return 'both';
  if (s === 'required') return 'both';
  return 'unknown';
}

/** Compute one matrix cell for (project, loader, drop). */
export function cellFor(
  project: Pick<ModProject, 'loaders' | 'updated'>,
  versions: ModVersion[],
  loader: Loader,
  drop: Drop,
  latestDrops: Drop[],
  now = Date.now(),
): Cell {
  if (!project.loaders.includes(loader)) return { status: 'not_applicable' };
  const forLoader = versions.filter((v) => v.loaders.includes(loader));
  if (forLoader.length === 0) return { status: 'not_applicable' };

  if (drop.upcoming) {
    const tagged = forLoader.filter((v) => v.game_versions.some((g) => drop.previews.includes(g)));
    if (tagged.length) return { status: 'snapshot', patches: coverage(tagged, drop.previews) };
  } else {
    const tagged = forLoader.filter((v) => v.game_versions.some((g) => drop.patches.includes(g)));
    const releases = tagged.filter((v) => v.version_type === 'release');
    if (releases.length) {
      return {
        status: 'ready',
        patches: coverage(releases, drop.patches),
        lagDays: lagDays(releases, drop),
      };
    }
    if (tagged.length) return { status: 'prerelease', patches: coverage(tagged, drop.patches) };
  }

  const idle = now - Date.parse(project.updated) > DROPPED_AFTER_DAYS * DAY;
  const onRecent = forLoader.some((v) =>
    v.game_versions.some((g) => latestDrops.some((d) => d.patches.includes(g))),
  );
  if (idle && !onRecent) return { status: 'dropped' };
  return { status: 'not_yet' };
}

function coverage(versions: ModVersion[], ids: string[]): string[] {
  const set = new Set(versions.flatMap((v) => v.game_versions));
  return ids.filter((id) => set.has(id));
}

/** Days from the drop's first release to the first release build. Builds published early count as 0. */
export function lagDays(releases: ModVersion[], drop: Drop): number | undefined {
  if (!drop.releasedAt) return undefined;
  const first = Math.min(...releases.map((v) => Date.parse(v.date_published)));
  return Math.max(0, Math.floor((first - Date.parse(drop.releasedAt)) / DAY));
}

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
