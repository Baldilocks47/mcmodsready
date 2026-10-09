// Shape of the JSON files the pipeline publishes and the site reads.
//   meta.json                     versions, drops, loaders, counts
//   matrix-<loader>.json          top mods with a cell per window drop (grid + landing)
//   stats-<loader>.json           top-100 readiness and update-speed history
//   feed.json                     newly ready events
//   m/<projectId>.json            ModFile: full support map for one tracked mod
//   v/<loader>/<gameVersion>.json which tracked mods have a build for one exact version
//   pages.json                    mods that get a pre-rendered /mod/<slug> page
import type { Cell, Drop, Env, GameVersion, Loader } from './core/types';

export type { AltRef, ModFile } from './core/types';

export interface MetaFile {
  generatedAt: string;
  latestRelease: string;
  latestSnapshot: string;
  /** window of drops shown as default columns, newest first */
  drops: Drop[];
  /** every targetable version that at least one tracked mod declares, newest first */
  versions: GameVersion[];
  /** older releases most mods target, per loader (e.g. 1.20.1, 1.21.1): suggested extra columns */
  popularLegacy: Record<Loader, string[]>;
  loaders: Loader[];
  /** precomputed mods per loader */
  tracked: Record<Loader, number>;
  /** mods with at least this many downloads are precomputed; others are looked up live */
  minDownloads: number;
}

export interface MatrixMod {
  id: string;
  slug: string;
  title: string;
  icon: string | null;
  downloads: number;
  env: Env;
  /** keyed by drop id */
  cells: Record<string, Cell>;
}

export interface MatrixFile {
  loader: Loader;
  generatedAt: string;
  drops: string[];
  mods: MatrixMod[];
}

export interface VersionShard {
  loader: Loader;
  version: string;
  /** project id -> best build type */
  mods: Record<string, 'r' | 'b' | 'a'>;
}

export interface StatsFile {
  loader: Loader;
  generatedAt: string;
  window: { drop: string; upcoming: boolean; releasedAt: string | null; top100: Record<string, number> }[];
  lag: {
    drop: string;
    releasedAt: string;
    /** median days among mods that did ship a release build */
    median: number | null;
    readyCount: number;
    of: number;
    /** how many of the top 100 had a release build within N days */
    readyBy: Record<1 | 7 | 30, number>;
  }[];
}

export interface FeedEvent {
  /** ISO date (day resolution) of the first release build */
  at: string;
  slug: string;
  title: string;
  loader: Loader;
  drop: string;
  top: boolean;
}

export interface PageRef {
  id: string;
  slug: string;
}
