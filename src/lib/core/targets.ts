// What a user can check a list against: a drop ("26.3", any patch) or one exact version.
import { dropCell, versionCell, type StatusContext } from './status';
import type { Cell, Drop, GameVersion, Loader, ModFile } from './types';

export type Target = { kind: 'drop'; key: string; label: string; drop: Drop } | { kind: 'version'; key: string; label: string; version: GameVersion };

export interface TargetSource {
  drops: Drop[];
  versions: GameVersion[];
}

export function parseTarget(key: string, src: TargetSource): Target | null {
  const [kind, id] = [key.slice(0, 1), key.slice(2)];
  if (kind === 'd') {
    const drop = src.drops.find((d) => d.id === id);
    return drop ? { kind: 'drop', key, label: drop.upcoming ? `${drop.id} (upcoming)` : `${drop.id} (any patch)`, drop } : null;
  }
  if (kind === 'v') {
    const version = src.versions.find((v) => v.id === id);
    return version ? { kind: 'version', key, label: version.id, version } : null;
  }
  return null;
}

export function defaultTarget(src: TargetSource): string {
  return `d:${src.drops.find((d) => !d.upcoming)!.id}`;
}

/** Drop whose precomputed alternatives apply to this target (if any). */
export function altDrop(t: Target): string | null {
  return t.kind === 'drop' ? t.drop.id : t.version.drop;
}

/** True when "not yet" is the normal state (nothing released yet). */
export function isUpcoming(t: Target, src: TargetSource): boolean {
  if (t.kind === 'drop') return t.drop.upcoming;
  return t.version.type === 'snapshot' && !!src.drops.find((d) => d.id === t.version.drop)?.upcoming;
}

export function contextFor(m: Pick<ModFile, 'updated'>, src: TargetSource, now?: number): StatusContext {
  const released = src.drops.filter((d) => !d.upcoming);
  return { latestDrops: released.slice(0, 2), currentDrop: released[0].id, updated: m.updated, now };
}

/** Required dependencies for the build a user would install for this target. */
export function depsAt(m: ModFile, loader: Loader, t: Target): string[] {
  const s = m.loaders[loader];
  if (!s) return [];
  const ids = t.kind === 'drop' ? [...t.drop.patches, ...t.drop.previews].reverse() : [t.version.id];
  const gv = ids.find((id) => s.v[id]);
  return (gv && s.d?.[gv]) || s.deps;
}

export function cellAt(m: ModFile, loader: Loader, t: Target, src: TargetSource, now?: number): Cell {
  const s = m.loaders[loader];
  const ctx = contextFor(m, src, now);
  return t.kind === 'drop' ? dropCell(s, t.drop, ctx) : versionCell(s, t.version, ctx);
}
