import type { Env, Status } from '../core/types';

/** Every status has an icon and text so colour is never the only signal. */
export const STATUS: Record<Status, { icon: string; label: string; short: string; hint: string }> = {
  ready: { icon: '✓', label: 'Ready', short: 'Ready', hint: 'A release build is declared compatible' },
  prerelease: { icon: 'β', label: 'Beta only', short: 'Beta', hint: 'Only beta or alpha builds are declared' },
  snapshot: { icon: '◐', label: 'Snapshot build', short: 'Snap', hint: 'Builds declared for snapshots or pre-releases of this drop' },
  not_yet: { icon: '✕', label: 'Not yet', short: 'Not yet', hint: 'Supports this loader, but nothing declared for this drop yet' },
  no_build: { icon: '–', label: 'No build', short: 'No build', hint: 'Supports this loader, but never published a build for this version' },
  not_applicable: { icon: '–', label: 'No build for loader', short: 'N/A', hint: 'This mod is not published for this loader' },
  dropped: { icon: '⊘', label: 'Inactive', short: 'Inactive', hint: 'No updates for over a year and missing recent drops' },
  unknown: { icon: '?', label: 'Unknown', short: '?', hint: 'No data or conflicting data' },
};

export const ENV: Record<Env, string> = {
  client: 'Client only',
  server: 'Server only',
  both: 'Client and server',
  either: 'Client and/or server',
  unknown: 'Unknown side (treated as both)',
};

export const LOADER_LABEL = { fabric: 'Fabric', neoforge: 'NeoForge', forge: 'Forge' } as const;

export const DECLARED_NOTE =
  'Statuses are author-declared on Modrinth: "ready" means declared compatible, not tested.';

export function modrinthUrl(slug: string): string {
  return `https://modrinth.com/mod/${slug}`;
}

export function fmtDownloads(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)}k`;
  return String(n);
}

export function timeAgo(iso: string, now = Date.now()): string {
  const m = Math.round((now - Date.parse(iso)) / 60000);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

/** For day-resolution dates (e.g. first release day): today / yesterday / N days ago. */
export function daysAgo(isoDay: string, now = Date.now()): string {
  const d = Math.floor(now / 86_400_000) - Math.floor(Date.parse(isoDay) / 86_400_000);
  return d <= 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`;
}

/** Where the client fetches data shards from. In production this is the R2-backed data host. */
export const DATA_BASE = (import.meta.env.PUBLIC_DATA_BASE as string | undefined) ?? '/data';
