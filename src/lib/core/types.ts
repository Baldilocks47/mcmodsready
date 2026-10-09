// Shared types used by the data pipeline and the site.

export type Loader = 'fabric' | 'neoforge' | 'forge';
export const LOADERS: Loader[] = ['fabric', 'neoforge', 'forge'];

/** Where a mod has to be installed, normalised from Modrinth's environment fields. */
export type Env = 'client' | 'server' | 'both' | 'either' | 'unknown';

export type Status =
  | 'ready' // a release build is declared for this version/drop
  | 'prerelease' // only beta/alpha builds are declared
  | 'snapshot' // target is a snapshot/pre/rc (or an upcoming drop) and a build is declared for it
  | 'not_yet' // current version: supports the loader, nothing declared yet
  | 'no_build' // older version: supports the loader, but never had a build for it
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

/** One Minecraft version a user can target. */
export interface GameVersion {
  id: string;
  type: 'release' | 'snapshot';
  /** ISO release time */
  date: string;
  /** year-based drop this belongs to (26.x only) */
  drop: string | null;
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

/** Minimal subset of a Modrinth v2 project object (or search hit, normalised). */
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

/**
 * Best build declared for one game version: [type, first release-build day].
 * type: r = release, b = beta, a = alpha. Day = days since epoch of the first
 * *release* build tagged with this version (absent if none).
 */
export type SupportEntry = ['r' | 'b' | 'a', number?];

export interface LoaderSupport {
  /** game version id -> best build */
  v: Record<string, SupportEntry>;
  /** required dependency project ids of the newest build */
  deps: string[];
  /** per game version, when that version's newest build needs different deps than `deps` */
  d?: Record<string, string[]>;
  /** project ids this mod declares itself incompatible with */
  incompat: string[];
}

export interface AltRef {
  slug: string;
  curated: boolean;
  note?: string;
}

/** Everything the site needs about one mod. Published as data/m/<id>.json. */
export interface ModFile {
  id: string;
  slug: string;
  title: string;
  description: string;
  icon: string | null;
  downloads: number;
  env: Env;
  categories: string[];
  updated: string;
  loaders: Partial<Record<Loader, LoaderSupport>>;
  /** alternatives per loader per drop id (precomputed for tracked mods only) */
  alts?: Partial<Record<Loader, Record<string, AltRef[]>>>;
  /** true when looked up live from Modrinth instead of precomputed */
  live?: boolean;
  /** has a pre-rendered /mod/<slug> page */
  page?: boolean;
}

export interface Cell {
  status: Status;
  /** game versions in the drop that have a matching build */
  patches?: string[];
  /** days from drop release to first release build (released drops only) */
  lagDays?: number;
}
