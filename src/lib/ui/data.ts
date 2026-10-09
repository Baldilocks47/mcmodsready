// Client-side data loading with a small in-memory cache.
import type { Loader } from '../core/types';
import type { MatrixFile } from '../data-schema';
import { DATA_BASE } from './status';

const cache = new Map<string, Promise<unknown>>();

function getJson<T>(file: string): Promise<T> {
  let p = cache.get(file) as Promise<T> | undefined;
  if (!p) {
    p = fetch(`${DATA_BASE}/${file}`).then((r) => {
      if (!r.ok) throw new Error(`${file}: ${r.status}`);
      return r.json() as Promise<T>;
    });
    cache.set(file, p);
    p.catch(() => cache.delete(file));
  }
  return p;
}

export const loadMatrix = (loader: Loader) => getJson<MatrixFile>(`matrix-${loader}.json`);
