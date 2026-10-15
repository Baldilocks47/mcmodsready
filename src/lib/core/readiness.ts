import type { Env, Status } from './types';

export interface ListItem {
  slug: string;
  title: string;
  env: Env;
  status: Status;
}

export interface Blocker {
  slug: string;
  title: string;
  status: Status;
  /** which sides this mod blocks */
  sides: ('server' | 'client')[];
  envUnknown: boolean;
  /** Modrinth marks it optional on each side: it still blocks wherever you run it, but could be left off one side */
  optional: boolean;
  /** which group the mod belongs to (where it is installed) */
  group: Group;
}

/** Where a mod is installed: only on the server, only in players' games, or on both. */
export type Group = 'server' | 'client' | 'both';

export function groupFor(env: Env): Group {
  return env === 'server' ? 'server' : env === 'client' ? 'client' : 'both';
}

export interface SideResult {
  ready: number;
  total: number;
  ok: boolean;
}

export interface ListReadiness {
  /** can the server update? server-only mods + mods needed on both sides */
  server: SideResult;
  /** can players update? client-only mods + mods needed on both sides */
  client: SideResult;
  /** every mod in the list, whichever side it runs on */
  all: SideResult;
  /** readiness per group: server-only, client-only and both-sides mods */
  groups: Record<Group, SideResult>;
  blockers: Blocker[];
}

export interface ReadinessOptions {
  /** count beta/alpha (and snapshot, for upcoming drops) builds as ready */
  acceptPrerelease?: boolean;
}

/**
 * Which sides a mod must be ready on. Unknown is treated as both (and flagged).
 * "Either" (optional on each side) also counts on both: Modrinth tags mods like Fabric API and
 * Simple Voice Chat this way, and if it's in your list you are running it somewhere.
 */
export function sidesFor(env: Env): ('server' | 'client')[] {
  switch (env) {
    case 'client':
      return ['client'];
    case 'server':
      return ['server'];
    case 'both':
    case 'either':
    case 'unknown':
      return ['server', 'client'];
  }
}

export function isReady(status: Status, opts: ReadinessOptions = {}): boolean {
  if (status === 'ready') return true;
  if (opts.acceptPrerelease && (status === 'prerelease' || status === 'snapshot')) return true;
  return false;
}

export function listReadiness(items: ListItem[], opts: ReadinessOptions = {}): ListReadiness {
  const server: SideResult = { ready: 0, total: 0, ok: true };
  const client: SideResult = { ready: 0, total: 0, ok: true };
  const blockers: Blocker[] = [];
  const groups: Record<Group, SideResult> = {
    server: { ready: 0, total: 0, ok: true },
    client: { ready: 0, total: 0, ok: true },
    both: { ready: 0, total: 0, ok: true },
  };

  for (const item of items) {
    const sides = sidesFor(item.env);
    const ready = isReady(item.status, opts);
    const group = groupFor(item.env);
    const g = groups[group];
    g.total++;
    if (ready) g.ready++;
    else g.ok = false;
    for (const side of sides) {
      const r = side === 'server' ? server : client;
      r.total++;
      if (ready) r.ready++;
      else r.ok = false;
    }
    if (!ready) {
      blockers.push({
        slug: item.slug,
        title: item.title,
        status: item.status,
        sides,
        envUnknown: item.env === 'unknown',
        optional: item.env === 'either',
        group,
      });
    }
  }

  const total = items.length;
  const notReady = blockers.length;
  return { server, client, all: { ready: total - notReady, total, ok: server.ok && client.ok }, groups, blockers };
}
