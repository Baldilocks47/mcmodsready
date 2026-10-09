// Mod lists, stored in localStorage and shared via the URL fragment (never sent to a server).
import type { Loader } from './types';
import { LOADERS } from './types';

export interface ModList {
  id: string;
  name: string;
  loader: Loader;
  /** "d:26.3" for a drop (any patch), or "v:1.20.1" / "v:26.4-snapshot-2" for an exact version */
  target: string;
  acceptPrerelease: boolean;
  /** Modrinth project ids */
  mods: string[];
}

const ID_RE = /^[A-Za-z0-9]{8}$/;
const TARGET_RE = /^[dv]:[A-Za-z0-9._-]{1,40}$/;

export function encodeList(l: ModList): string {
  const p = new URLSearchParams();
  p.set('v', '1');
  p.set('n', l.name);
  p.set('l', l.loader);
  p.set('t', l.target);
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
  // older links used d=<drop>
  const target = p.get('t') ?? (p.get('d') ? `d:${p.get('d')}` : '');
  return {
    id: newId(),
    name: (p.get('n') ?? 'Shared list').slice(0, 80),
    loader,
    target: TARGET_RE.test(target) ? target : '',
    acceptPrerelease: p.get('b') === '1',
    mods: [...new Set(mods)].slice(0, 500),
  };
}

/** Lists saved before exact-version targets existed had `drop` instead of `target`. */
export function migrateList(l: ModList & { drop?: string }): ModList {
  if (!l.target && l.drop) l.target = `d:${l.drop}`;
  delete l.drop;
  return l;
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
