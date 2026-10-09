// Refuse to publish data that looks wrong. Compares new output with the previously published copy.
// Usage: npx tsx pipeline/guard.ts <prev-dir> <next-dir>
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LOADERS } from '../src/lib/core/types';
import type { MatrixFile, MetaFile } from '../src/lib/data-schema';

/** Max share of previously-ready cells allowed to regress in one run. */
export const MAX_REGRESSION = 0.3;
/** New tracked set may not shrink below this share of the old one. */
export const MIN_SIZE_RATIO = 0.8;

export function regressionRatio(prev: MatrixFile, next: MatrixFile): number {
  const nextById = new Map(next.mods.map((m) => [m.id, m]));
  let wasReady = 0;
  let regressed = 0;
  for (const m of prev.mods) {
    const n = nextById.get(m.id);
    if (!n) continue;
    for (const [drop, cell] of Object.entries(m.cells)) {
      if (cell.status !== 'ready' || !n.cells[drop]) continue;
      wasReady++;
      if (n.cells[drop].status !== 'ready') regressed++;
    }
  }
  return wasReady ? regressed / wasReady : 0;
}

export function check(prevDir: string, nextDir: string): string[] {
  const problems: string[] = [];
  const read = <T>(dir: string, f: string) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as T;

  const meta = read<MetaFile>(nextDir, 'meta.json');
  if (Date.now() - Date.parse(meta.generatedAt) > 3600_000) problems.push('meta.generatedAt is over an hour old');
  if (!meta.drops.some((d) => !d.upcoming)) problems.push('no released drop in window');

  for (const l of LOADERS) {
    const next = read<MatrixFile>(nextDir, `matrix-${l}.json`);
    if (next.mods.length < 50) problems.push(`${l}: only ${next.mods.length} mods`);
    const prevFile = join(prevDir, `matrix-${l}.json`);
    if (!existsSync(prevFile)) continue; // first publish
    const prev = read<MatrixFile>(prevDir, `matrix-${l}.json`);
    const r = regressionRatio(prev, next);
    if (r > MAX_REGRESSION) problems.push(`${l}: ${(r * 100).toFixed(0)}% of ready cells regressed`);
    if (next.mods.length < prev.mods.length * MIN_SIZE_RATIO) problems.push(`${l}: tracked set shrank ${prev.mods.length} → ${next.mods.length}`);
  }
  return problems;
}

if (process.argv[1]?.endsWith('guard.ts')) {
  const [prev, next] = process.argv.slice(2);
  const problems = check(prev, next);
  if (problems.length) {
    console.error('Guard failed, not publishing:\n- ' + problems.join('\n- '));
    process.exit(1);
  }
  console.log('Guard passed');
}
