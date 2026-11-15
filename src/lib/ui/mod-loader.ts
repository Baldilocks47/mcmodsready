// Loads mods for the list checker, asking for each id at most once. Without that, an id that can't
// be found (a deleted mod, a failed lookup) would be requested again every time the list re-renders.
import type { ModFile } from '../core/types';

export class ModLoader {
  private tried = new Set<string>();

  constructor(private fetchMods: (ids: string[]) => Promise<Map<string, ModFile>>) {}

  /** Fetch the ids not asked for before. `missing` are the ones that couldn't be found. */
  async load(ids: string[]): Promise<{ found: Map<string, ModFile>; missing: string[] }> {
    const want = [...new Set(ids)].filter((id) => !this.tried.has(id));
    if (!want.length) return { found: new Map(), missing: [] };
    for (const id of want) this.tried.add(id);
    const found = await this.fetchMods(want).catch(() => new Map<string, ModFile>());
    return { found, missing: want.filter((id) => !found.has(id)) };
  }

  /** Let these ids be asked for again. */
  forget(ids: string[]) {
    for (const id of ids) this.tried.delete(id);
  }
}
