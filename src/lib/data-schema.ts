// Shape of the JSON files the pipeline publishes and the site reads.
import type { Cell, Drop, Env, Loader } from './core/types';

export interface MetaFile {
  generatedAt: string;
  latestRelease: string;
  latestSnapshot: string;
  /** window of drops shown as columns, newest first */
  drops: Drop[];
  loaders: Loader[];
  tracked: Record<Loader, number>;
}

export interface AltRef {
  slug: string;
  curated: boolean;
  note?: string;
}

export interface MatrixMod {
  id: string;
  slug: string;
  title: string;
  icon: string | null;
  downloads: number;
  env: Env;
  description: string;
  categories: string[];
  updated: string;
  /** in the top N for this loader (vs. pulled in from the other loader's list) */
  top: boolean;
  /** keyed by drop id */
  cells: Record<string, Cell>;
  /** lag in days per released drop; null = no release build */
  history: Record<string, number | null>;
  /** required dependency project ids */
  deps: string[];
  /** alternatives per not-ready drop */
  alts: Record<string, AltRef[]>;
}

export interface MatrixFile {
  loader: Loader;
  generatedAt: string;
  drops: string[];
  mods: MatrixMod[];
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

export interface ProjectFile {
  id: string;
  slug: string;
  title: string;
  description: string;
  icon: string | null;
  downloads: number;
  env: Env;
  categories: string[];
  updated: string;
  loaders: Partial<Record<Loader, Pick<MatrixMod, 'cells' | 'history' | 'alts' | 'deps'>>>;
}

export interface FeedEvent {
  at: string;
  slug: string;
  title: string;
  loader: Loader;
  drop: string;
  top: boolean;
}
