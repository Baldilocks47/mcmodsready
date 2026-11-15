import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ModFile } from '../src/lib/core/types';
import { ModLoader } from '../src/lib/ui/mod-loader';
import { readVectors, writeVectors } from '../pipeline/embed';

const mod = (id: string) => ({ id }) as ModFile;

describe('ModLoader', () => {
  it('asks for each id once, even when it is never found', async () => {
    const asked: string[][] = [];
    const loader = new ModLoader(async (ids) => {
      asked.push(ids);
      return new Map(ids.filter((id) => id !== 'gone').map((id) => [id, mod(id)]));
    });
    const first = await loader.load(['a', 'gone', 'a']);
    expect([...first.found.keys()]).toEqual(['a']);
    expect(first.missing).toEqual(['gone']);
    // the list re-renders and asks again: nothing new to fetch
    expect(await loader.load(['a', 'gone'])).toEqual({ found: new Map(), missing: [] });
    expect(asked).toEqual([['a', 'gone']]);
  });

  it('retries an id after forget(), and treats a failed fetch as missing', async () => {
    let fail = true;
    const loader = new ModLoader(async (ids) => {
      if (fail) throw new Error('offline');
      return new Map(ids.map((id) => [id, mod(id)]));
    });
    expect((await loader.load(['a'])).missing).toEqual(['a']);
    fail = false;
    loader.forget(['a']);
    expect([...(await loader.load(['a'])).found.keys()]).toEqual(['a']);
  });
});

describe('vector cache', () => {
  const dir = mkdtempSync(join(tmpdir(), 'vec-'));
  const paths = [join(dir, 'v.f32'), join(dir, 'v.json'), join(dir, 'old.json')] as const;

  it('reads the old JSON format when there is no binary cache yet', async () => {
    writeFileSync(paths[2], JSON.stringify({ h1: [0.5, -0.25], h2: [1, 0] }));
    const v = await readVectors(...paths);
    expect([...v.keys()]).toEqual(['h1', 'h2']);
    expect([...v.get('h1')!]).toEqual([0.5, -0.25]);
  });

  it('round-trips through the binary format, which then takes priority', async () => {
    await writeVectors(new Map([['a', Float32Array.from([0.5, -0.25, 1])], ['b', Float32Array.from([0, 2, 4])]]), paths[0], paths[1]);
    const v = await readVectors(...paths);
    expect([...v.keys()]).toEqual(['a', 'b']);
    expect([...v.get('b')!]).toEqual([0, 2, 4]);
  });

  it('starts again if the two files disagree', async () => {
    writeFileSync(paths[1], JSON.stringify(['a', 'b', 'c', 'd']));
    expect((await readVectors(...paths)).size).toBe(0);
  });
});
