// Build-time numbers for the per-drop adoption report (/report/<drop>).
// Everything is derived from the published data: top-100 per loader by Modrinth downloads.
import { matrix, meta, modFile, stats } from './build-data';
import { dropCell } from './core/status';
import { contextFor } from './core/targets';
import type { Drop, Loader, Status } from './core/types';

export interface LoaderCurve {
  loader: Loader;
  /** % of the top 100 with a release build by day N, for N = 0..days */
  points: number[];
  readyNow: number;
  betaNow: number;
  dayOne: number;
  median: number | null;
}

export interface Waiting {
  slug: string;
  title: string;
  downloads: number;
  /** best status across the loaders it supports */
  status: Status;
  loaders: Loader[];
}

export interface Report {
  drop: Drop;
  daysOut: number;
  curves: LoaderCurve[];
  /** readiness by day 1/7/30 for this and earlier drops, per loader */
  history: { loader: Loader; rows: { drop: string; d1: number; d7: number; d30: number; now: number }[] }[];
  /** top Forge mods not ready on Forge for this drop, and how many of them are ready on NeoForge */
  forgeMigration: { notReadyOnForge: number; readyOnNeoForge: number; examples: string[] };
  /** most-downloaded mods still not ready on any loader */
  waiting: Waiting[];
}

const DAY = 86_400_000;
const RANK: Status[] = ['ready', 'prerelease', 'snapshot', 'not_yet', 'no_build', 'dropped', 'not_applicable', 'unknown'];

export function reportFor(dropId: string): Report {
  const m = meta();
  const drop = m.drops.find((d) => d.id === dropId)!;
  const src = { drops: m.drops, versions: m.versions };
  const daysOut = Math.floor((Date.now() - Date.parse(drop.releasedAt!)) / DAY);
  const horizon = Math.min(30, daysOut);

  const curves: LoaderCurve[] = m.loaders.map((loader) => {
    const top = matrix(loader).mods.slice(0, 100);
    const cells = top.map((x) => x.cells[drop.id]).filter(Boolean);
    const lags = cells.filter((c) => c.status === 'ready' && c.lagDays != null).map((c) => c.lagDays!);
    const sorted = [...lags].sort((a, b) => a - b);
    return {
      loader,
      points: Array.from({ length: horizon + 1 }, (_, d) => Math.round((100 * lags.filter((x) => x <= d).length) / top.length)),
      readyNow: cells.filter((c) => c.status === 'ready').length,
      betaNow: cells.filter((c) => c.status === 'prerelease').length,
      dayOne: lags.filter((x) => x <= 1).length,
      median: sorted.length ? sorted[Math.floor(sorted.length / 2)] : null,
    };
  });

  const history = m.loaders.map((loader) => ({
    loader,
    rows: stats(loader)
      .lag.filter((l) => Date.parse(l.releasedAt) <= Date.parse(drop.releasedAt!))
      .map((l) => ({ drop: l.drop, d1: l.readyBy[1], d7: l.readyBy[7], d30: l.readyBy[30], now: l.readyCount })),
  }));

  // Forge -> NeoForge: of the top Forge mods without a Forge release, how many ship on NeoForge?
  const forgeTop = matrix('forge').mods.slice(0, 100).filter((x) => x.cells[drop.id]?.status !== 'ready');
  const movedTitles: string[] = [];
  for (const x of forgeTop) {
    const f = modFile(x.id);
    if (dropCell(f.loaders.neoforge, drop, contextFor(f, src)).status === 'ready') movedTitles.push(f.title);
  }

  // Most-wanted: biggest mods (any loader) with no release for this drop anywhere.
  const seen = new Map<string, { slug: string; title: string; downloads: number }>();
  for (const loader of m.loaders) for (const x of matrix(loader).mods.slice(0, 150)) seen.set(x.id, x);
  const waiting: Waiting[] = [];
  for (const [id, x] of [...seen].sort((a, b) => b[1].downloads - a[1].downloads)) {
    const f = modFile(id);
    const loaders = (Object.keys(f.loaders) as Loader[]).filter((l) => m.loaders.includes(l));
    const statuses = loaders.map((l) => dropCell(f.loaders[l], drop, contextFor(f, src)).status);
    if (!loaders.length || statuses.includes('ready')) continue;
    const best = [...statuses].sort((a, b) => RANK.indexOf(a) - RANK.indexOf(b))[0];
    if (best === 'dropped') continue; // abandoned mods aren't "waiting"
    waiting.push({ slug: x.slug, title: x.title, downloads: x.downloads, status: best, loaders });
    if (waiting.length >= 15) break;
  }

  return {
    drop,
    daysOut,
    curves,
    history,
    forgeMigration: { notReadyOnForge: forgeTop.length, readyOnNeoForge: movedTitles.length, examples: movedTitles.slice(0, 6) },
    waiting,
  };
}
