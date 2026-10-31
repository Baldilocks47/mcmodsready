// Host copies of mod icons with our data instead of loading them from Modrinth's CDN.
// OFF by default (SELF_HOST_ICONS=1): only needed if Modrinth prefers it (their terms mention in-line linking).
// Each icon is fetched once per URL (the URL changes when the icon does), then reused from the cache.
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import type { ModFile } from '../src/lib/core/types';
import { pool } from './modrinth';

const CACHE = '.cache/icons';
const TYPES = new Set(['.webp', '.png', '.jpg', '.jpeg', '.gif', '.svg']);
const UA = process.env.MODRINTH_USER_AGENT || 'mcmodsready/1.0 (https://mcmodsready.com)';

/** Rewrites `icon` on each mod to our copy; mods whose icon can't be fetched keep their original URL. */
export async function selfHostIcons(mods: ModFile[], out: string, maxFetch = 5000): Promise<{ hosted: number; fetched: number }> {
  await mkdir(CACHE, { recursive: true });
  await mkdir(join(out, 'i'), { recursive: true });
  let fetched = 0;
  let hosted = 0;
  await pool(mods, 4, async (m) => {
    if (!m.icon?.startsWith('https://cdn.modrinth.com/')) return;
    const ext = extname(new URL(m.icon).pathname).toLowerCase();
    if (!TYPES.has(ext)) return;
    const cached = join(CACHE, createHash('sha1').update(m.icon).digest('hex') + ext);
    if (!existsSync(cached)) {
      if (fetched >= maxFetch) return;
      fetched++;
      const res = await fetch(m.icon, { headers: { 'user-agent': UA } }).catch(() => null);
      if (!res?.ok) return;
      await writeFile(cached, Buffer.from(await res.arrayBuffer()));
    }
    await copyFile(cached, join(out, 'i', m.id + ext));
    m.icon = `/data/i/${m.id}${ext}`;
    hosted++;
  });
  return { hosted, fetched };
}
