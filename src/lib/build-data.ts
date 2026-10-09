// Build-time data access for pre-rendered pages. Reads the pipeline output from disk.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Loader, ModFile } from './core/types';
import type { FeedEvent, MatrixFile, MetaFile, PageRef, StatsFile } from './data-schema';

const DIR = process.env.DATA_DIR ?? 'public/data';
const read = <T>(f: string): T => JSON.parse(readFileSync(join(DIR, f), 'utf8')) as T;

export const meta = () => read<MetaFile>('meta.json');
export const stats = (l: Loader) => read<StatsFile>(`stats-${l}.json`);
export const matrix = (l: Loader) => read<MatrixFile>(`matrix-${l}.json`);
export const feed = () => read<{ generatedAt: string; events: FeedEvent[] }>('feed.json');
export const pages = () => read<PageRef[]>('pages.json');
export const modFile = (id: string) => read<ModFile>(`m/${id}.json`);
export const hasMod = (id: string) => existsSync(join(DIR, 'm', `${id}.json`));
