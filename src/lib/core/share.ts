// Mod lists, stored in localStorage and shared via the URL fragment (never sent to a server).
import type { Loader } from './types';
import { LOADERS } from './types';

export interface ModList {
  id: string;
  name: string;
  loader: Loader;
  /** target drop id, e.g. "26.3" */
  drop: string;
  acceptPrerelease: boolean;
  /** Modrinth project ids */
  mods: string[];
}

const ID_RE = /^[A-Za-z0-9]{8}$/;

export function encodeList(l: ModList): string {
  const p = new URLSearchParams();
  p.set('v', '1');
  p.set('n', l.name);
  p.set('l', l.loader);
  p.set('d', l.drop);
  if (l.acceptPrerelease) p.set('b', '1');
  p.set('m', l.mods.join('.'));
  return p.toString();
}

export function decodeList(fragment: string, newId: () => string): ModList | null {
  const p = new URLSearchParams(fragment.replace(/^#/, ''));
  if (p.get('v') !== '1') return null;
  const loader = p.get('l') as Loader;
  if (!LOADERS.includes(loader)) return null;
  const mods = (p.get('m') ?? '').split('.').filter((x) => ID_RE.test(x));
  return {
    id: newId(),
    name: (p.get('n') ?? 'Shared list').slice(0, 80),
    loader,
    drop: p.get('d') ?? '',
    acceptPrerelease: p.get('b') === '1',
    mods: [...new Set(mods)].slice(0, 500),
  };
}

/** Pull slugs/ids out of pasted text: Modrinth URLs, slugs, or one name per line. */
export function parsePasted(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/[\n,]+/)) {
    const line = raw.trim();
    if (!line) continue;
    const url = /modrinth\.com\/(?:mod|plugin|datapack)\/([^/?#\s]+)/i.exec(line);
    if (url) out.push(url[1].toLowerCase());
    else out.push(line.replace(/\.jar$/i, '').toLowerCase());
  }
  return [...new Set(out)];
}
