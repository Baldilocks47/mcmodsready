// Build-time data access for pre-rendered pages. Reads the pipeline output from disk.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Loader } from './core/types';
import type { FeedEvent, MatrixFile, MetaFile, ProjectFile, StatsFile } from './data-schema';

const DIR = process.env.DATA_DIR ?? 'public/data';
const read = <T>(f: string): T => JSON.parse(readFileSync(join(DIR, f), 'utf8')) as T;

export const meta = () => read<MetaFile>('meta.json');
export const stats = (l: Loader) => read<StatsFile>(`stats-${l}.json`);
export const matrix = (l: Loader) => read<MatrixFile>(`matrix-${l}.json`);
export const feed = () => read<{ generatedAt: string; events: FeedEvent[] }>('feed.json');
export const project = (slug: string) => read<ProjectFile>(`projects/${slug}.json`);
export const projectSlugs = () => readdirSync(join(DIR, 'projects')).map((f) => f.replace(/\.json$/, ''));
