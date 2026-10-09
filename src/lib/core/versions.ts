import type { Drop } from './types';

export interface ManifestVersion {
  id: string;
  type: string;
  releaseTime: string;
}

/**
 * Year-based versions (26.1, 26.1.2, 26.3-snapshot-1, 26.3-rc-2) group into a
 * drop by their first two numbers. Legacy 1.x versions are ignored.
 */
export function dropOf(gameVersion: string): string | null {
  const m = /^(\d+)\.(\d+)/.exec(gameVersion);
  if (!m) return null;
  if (Number(m[1]) < 25) return null;
  return `${m[1]}.${m[2]}`;
}

export function isReleaseId(id: string): boolean {
  return /^\d+\.\d+(\.\d+)?$/.test(id);
}

/** Build drops from the Mojang manifest, newest first. */
export function buildDrops(manifest: ManifestVersion[]): Drop[] {
  const byId = new Map<string, Drop>();
  const sorted = [...manifest].sort((a, b) => a.releaseTime.localeCompare(b.releaseTime));
  for (const v of sorted) {
    const d = dropOf(v.id);
    if (!d) continue;
    let drop = byId.get(d);
    if (!drop) {
      drop = { id: d, patches: [], previews: [], releasedAt: null, upcoming: true };
      byId.set(d, drop);
    }
    if (v.type === 'release' && isReleaseId(v.id)) {
      drop.patches.push(v.id);
      if (!drop.releasedAt) drop.releasedAt = v.releaseTime;
      drop.upcoming = false;
    } else {
      drop.previews.push(v.id);
    }
  }
  return [...byId.values()].sort((a, b) => compareDrop(b.id, a.id));
}

export function compareDrop(a: string, b: string): number {
  const [a1, a2] = a.split('.').map(Number);
  const [b1, b2] = b.split('.').map(Number);
  return a1 - b1 || a2 - b2;
}
