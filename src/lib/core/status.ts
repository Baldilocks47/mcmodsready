import type { Cell, Drop, Env, GameVersion, LoaderSupport, ModProject } from './types';

const DAY = 86_400_000;

/** How long without updates (and without the latest drops) before a mod is "dropped". */
export const DROPPED_AFTER_DAYS = 365;

/** Normalise Modrinth's environment info into one value. Prefers the newer `environment` field. */
export function envOf(p: Pick<ModProject, 'client_side' | 'server_side' | 'environment'>): Env {
  // A project can list several values (its versions differ, e.g. Create: client_and_server +
  // server_only_client_optional). Take the union of the sides any of them require.
  const values = p.environment ?? [];
  let client = false;
  let server = false;
  let either = false;
  for (const e of values) {
    if (e === 'client_and_server') client = server = true;
    else if (e === 'client_only' || e === 'client_only_server_optional') client = true;
    else if (e === 'server_only' || e === 'server_only_client_optional' || e === 'dedicated_server_only') server = true;
    else if (e === 'client_or_server' || e === 'client_or_server_prefers_both') either = true;
  }
  if (client && server) return 'both';
  if (client) return 'client';
  if (server) return 'server';
  if (either) return 'either';
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

export interface StatusContext {
  /** the two newest released drops: a mod on neither, idle for a year, is "dropped" */
  latestDrops: Drop[];
  /** newest released drop id: targets in it (or later) are "current" */
  currentDrop: string;
  /** mod's last update (ISO) */
  updated: string;
  now?: number;
}

function idleAndGone(s: LoaderSupport, ctx: StatusContext): boolean {
  const idle = (ctx.now ?? Date.now()) - Date.parse(ctx.updated) > DROPPED_AFTER_DAYS * DAY;
  const onRecent = ctx.latestDrops.some((d) => d.patches.some((p) => s.v[p]));
  return idle && !onRecent;
}

/** Status for a drop (any patch counts), e.g. "26.3" covers 26.3, 26.3.1... */
export function dropCell(s: LoaderSupport | undefined, drop: Drop, ctx: StatusContext): Cell {
  if (!s) return { status: 'not_applicable' };
  if (drop.upcoming) {
    const patches = drop.previews.filter((p) => s.v[p]);
    if (patches.length) return { status: 'snapshot', patches };
  } else {
    const tagged = drop.patches.filter((p) => s.v[p]);
    const released = tagged.filter((p) => s.v[p][0] === 'r');
    if (released.length) {
      const first = Math.min(...released.map((p) => s.v[p][1] ?? Infinity));
      return { status: 'ready', patches: released, lagDays: lag(first, drop.releasedAt) };
    }
    if (tagged.length) return { status: 'prerelease', patches: tagged };
    // past drops: the moment has gone, "not yet" would imply it's coming
    if (compareDropIds(drop.id, ctx.currentDrop) < 0) return { status: 'no_build' };
  }
  if (idleAndGone(s, ctx)) return { status: 'dropped' };
  return { status: 'not_yet' };
}

/** Status for one exact game version, e.g. 1.20.1 or 26.4-snapshot-2. */
export function versionCell(s: LoaderSupport | undefined, gv: GameVersion, ctx: StatusContext): Cell {
  if (!s) return { status: 'not_applicable' };
  const e = s.v[gv.id];
  if (e) {
    if (gv.type === 'snapshot') return { status: 'snapshot', patches: [gv.id] };
    return { status: e[0] === 'r' ? 'ready' : 'prerelease', patches: [gv.id] };
  }
  const current = gv.drop != null && compareDropIds(gv.drop, ctx.currentDrop) >= 0;
  if (!current) return { status: 'no_build' };
  if (idleAndGone(s, ctx)) return { status: 'dropped' };
  return { status: 'not_yet' };
}

function compareDropIds(a: string, b: string): number {
  const [a1, a2] = a.split('.').map(Number);
  const [b1, b2] = b.split('.').map(Number);
  return a1 - b1 || a2 - b2;
}

/** Days from release to first release build; builds published early count as 0. */
export function lag(firstReleaseDay: number, releasedAt: string | null): number | undefined {
  if (!releasedAt || !Number.isFinite(firstReleaseDay)) return undefined;
  return Math.max(0, firstReleaseDay - Math.floor(Date.parse(releasedAt) / DAY));
}

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
