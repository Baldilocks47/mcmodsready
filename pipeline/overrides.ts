// Hand-curated alternatives. Format (data/alternatives.json):
// { "mod-slug": [{ "slug": "replacement-slug", "note": "why" }] }
// An empty list means "no known replacement": suppresses guessed suggestions for that mod.
import { readFile } from 'node:fs/promises';
import type { Override } from '../src/lib/core/alternatives';

export async function loadOverrides(path = 'data/alternatives.json'): Promise<Map<string, Override[]>> {
  try {
    const raw = JSON.parse(await readFile(path, 'utf8')) as Record<string, Override[]>;
    return new Map(Object.entries(raw));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return new Map();
    throw e;
  }
}
