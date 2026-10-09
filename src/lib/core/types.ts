// Shared types used by the data pipeline and the site.

export type Loader = 'fabric' | 'neoforge';
export const LOADERS: Loader[] = ['fabric', 'neoforge'];

/** Where a mod has to be installed, normalised from Modrinth's environment fields. */
export type Env = 'client' | 'server' | 'both' | 'either' | 'unknown';

export type Status =
  | 'ready' // a release build is declared for this drop
  | 'prerelease' // only beta/alpha builds are declared
  | 'snapshot' // upcoming drop: builds declared for its snapshots/pre-releases/RCs
  | 'not_yet' // supports the loader, but nothing declared for this drop
  | 'not_applicable' // does not support this loader at all
  | 'dropped' // no recent activity and not on recent drops
  | 'unknown';

export interface Drop {
  /** e.g. "26.3" */
  id: string;
  /** release versions in this drop, oldest first, e.g. ["26.1", "26.1.1", "26.1.2"] */
  patches: string[];
  /** snapshot/pre/rc ids belonging to this drop */
  previews: string[];
  /** ISO time of the first release in the drop, or null while upcoming */
  releasedAt: string | null;
  upcoming: boolean;
}

/** Minimal subset of a Modrinth v2 version object. */
export interface ModVersion {
  id: string;
  project_id: string;
  version_number: string;
  game_versions: string[];
  loaders: string[];
  version_type: 'release' | 'beta' | 'alpha';
  date_published: string;
  dependencies: { project_id: string | null; dependency_type: string }[];
}

/** Minimal subset of a Modrinth v2 project object. */
export interface ModProject {
  id: string;
  slug: string;
  title: string;
  description: string;
  icon_url: string | null;
  downloads: number;
  categories: string[];
  loaders: string[];
  project_type: string;
  client_side: string;
  server_side: string;
  environment?: string[];
  updated: string;
}

export interface Cell {
  status: Status;
  /** game versions in the drop that have a matching build */
  patches?: string[];
  /** days from drop release to first release build (released drops only) */
  lagDays?: number;
}
