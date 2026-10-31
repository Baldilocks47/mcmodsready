// Meaning-based text vectors for alternatives, from an existing pre-trained open model. Nothing is trained.
// OFF by default (ALT_EMBEDDINGS=1) until Modrinth confirms this is fine under their AI clause.
// The runtime isn't a project dependency: `npm install --no-save @huggingface/transformers` first.
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import type { ModFile } from '../src/lib/core/types';
import { pool, projects } from './modrinth';

const MODEL = 'Xenova/all-MiniLM-L6-v2';
const TEXT_CACHE = '.cache/alt-text.json'; // id -> { updated, text }
const VECTOR_CACHE = '.cache/vectors.json'; // text hash -> vector
const BODY_CHARS = 2000;

/** Project page markdown reduced to plain words: no images, links, HTML or code. */
export function plainText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/!\[[^\]]*]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[#*_>`|~-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export type Embedder = (texts: string[]) => Promise<number[][]>;

async function defaultEmbedder(): Promise<Embedder> {
  const name = '@huggingface/transformers'; // a variable, so it's only needed when this runs
  const { pipeline } = (await import(name)) as { pipeline: (task: string, model: string) => Promise<(t: string[], o: object) => Promise<{ tolist(): number[][] }>> };
  const extract = await pipeline('feature-extraction', MODEL);
  return async (texts) => (await extract(texts, { pooling: 'mean', normalize: true })).tolist();
}

const round = (v: number[]) => v.map((x) => Number(x.toFixed(4)));

/** Project text for each mod, re-fetched only when the mod changes. */
async function texts(mods: ModFile[]): Promise<Map<string, string>> {
  const cache: Record<string, { updated: string; text: string }> = existsSync(TEXT_CACHE) ? JSON.parse(await readFile(TEXT_CACHE, 'utf8')) : {};
  const stale = mods.filter((m) => cache[m.id]?.updated !== m.updated);
  if (stale.length) {
    const found = await projects<{ id: string; body?: string }>(stale.map((m) => m.id));
    const body = new Map(found.map((p) => [p.id, p.body ?? '']));
    for (const m of stale) cache[m.id] = { updated: m.updated, text: plainText(body.get(m.id) ?? '').slice(0, BODY_CHARS) };
    await mkdir('.cache', { recursive: true });
    await writeFile(TEXT_CACHE, JSON.stringify(cache));
  }
  return new Map(mods.map((m) => [m.id, `${m.title}. ${m.description}. ${cache[m.id].text}`]));
}

export async function embedMods(mods: ModFile[], embed?: Embedder): Promise<Map<string, Float32Array>> {
  const text = await texts(mods);
  const vectors: Record<string, number[]> = existsSync(VECTOR_CACHE) ? JSON.parse(await readFile(VECTOR_CACHE, 'utf8')) : {};
  const hash = (t: string) => createHash('sha1').update(t).digest('hex');
  const todo = [...new Set([...text.values()])].filter((t) => !vectors[hash(t)]);
  if (todo.length) {
    const run = embed ?? (await defaultEmbedder());
    const batches = Array.from({ length: Math.ceil(todo.length / 16) }, (_, i) => todo.slice(i * 16, i * 16 + 16));
    await pool(batches, 1, async (batch) => {
      const out = await run(batch);
      batch.forEach((t, i) => (vectors[hash(t)] = round(out[i])));
    });
    await writeFile(VECTOR_CACHE, JSON.stringify(vectors));
  }
  return new Map(mods.map((m) => [m.id, Float32Array.from(vectors[hash(text.get(m.id)!)])]));
}
