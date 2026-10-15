// Shields-style SVG badges ("MC 26.3 | ready"), rendered by the Worker at /badge/<mod>.svg.
// Pure functions so the Worker and tests share them. Text is Verdana 11px (what shields.io uses) so
// widths are predictable on GitHub, Modrinth and CurseForge, which proxy images and ignore web fonts.
import type { Loader, Status } from './types';

export const BADGE_STATUS: Record<Status, { text: string; color: string }> = {
  ready: { text: 'ready', color: '#2ea043' },
  prerelease: { text: 'beta only', color: '#c69026' },
  snapshot: { text: 'snapshot build', color: '#1b8b96' },
  not_yet: { text: 'not yet', color: '#cf4a3c' },
  no_build: { text: 'no build', color: '#6e7681' },
  not_applicable: { text: 'n/a', color: '#6e7681' },
  dropped: { text: 'inactive', color: '#6e7681' },
  unknown: { text: 'unknown', color: '#6e7681' },
};

/** Order used to pick the best status across loaders. */
const RANK: Status[] = ['ready', 'prerelease', 'snapshot', 'not_yet', 'no_build', 'dropped', 'not_applicable', 'unknown'];

export function bestStatus(statuses: Status[]): Status {
  return [...statuses].sort((a, b) => RANK.indexOf(a) - RANK.indexOf(b))[0] ?? 'unknown';
}

// Approximate Verdana 11px advance widths (px), close to shields.io's table.
const NARROW = new Set('iIl.,:;|!\'()[]{}');
const SLIM = new Set('fjrt- /');
const WIDE = new Set('mwMW');
export function textWidth(s: string): number {
  let w = 0;
  for (const ch of s) {
    if (NARROW.has(ch)) w += 3.6;
    else if (SLIM.has(ch)) w += 4.7;
    else if (WIDE.has(ch)) w += 10.2;
    else if (ch >= 'A' && ch <= 'Z') w += 7.6;
    else if (ch >= '0' && ch <= '9') w += 7;
    else w += 6.6;
  }
  return Math.ceil(w);
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export interface BadgeOptions {
  label: string;
  message: string;
  color: string;
  /** accessible title, e.g. "Sodium: ready for Minecraft 26.3 (Fabric)" */
  title: string;
}

export function badgeSvg({ label, message, color, title }: BadgeOptions): string {
  const pad = 6;
  const lw = textWidth(label) + pad * 2;
  const mw = textWidth(message) + pad * 2;
  const w = lw + mw;
  const t = esc(title);
  // flat style with a 1px darker bottom edge for a slightly blocky feel
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="20" role="img" aria-label="${t}"><title>${t}</title>
<clipPath id="r"><rect width="${w}" height="20" rx="3"/></clipPath>
<g clip-path="url(#r)">
<rect width="${lw}" height="20" fill="#2b2f36"/><rect x="${lw}" width="${mw}" height="20" fill="${color}"/>
<rect y="18" width="${w}" height="2" fill="#000" fill-opacity=".25"/>
</g>
<g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">
<text x="${lw / 2}" y="14.5" fill="#000" fill-opacity=".3">${esc(label)}</text><text x="${lw / 2}" y="13.5">${esc(label)}</text>
<text x="${lw + mw / 2}" y="14.5" fill="#000" fill-opacity=".3">${esc(message)}</text><text x="${lw + mw / 2}" y="13.5">${esc(message)}</text>
</g></svg>`;
}

export const LOADER_NAME: Record<Loader, string> = { fabric: 'Fabric', neoforge: 'NeoForge', forge: 'Forge' };
