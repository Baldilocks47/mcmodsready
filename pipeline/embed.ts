// Meaning-based text vectors for alternatives, from an existing pre-trained open model. Nothing is trained.
// Only runs with ALT_EMBEDDINGS=1, which the data workflow sets. Modrinth has confirmed they are fine with this feature.
// The runtime isn't a project dependency: `npm install --no-save @huggingface/transformers` first.
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { ModFile } from '../src/lib/core/types';
import { pool, projects } from './modrinth';

const MODEL = 'Xenova/all-MiniLM-L6-v2';
const TEXT_CACHE = '.cache/alt-text.json'; // id -> { updated, text }
// text hash -> vector, as one block of 32-bit floats plus the list of hashes in the same order.
// (As JSON number arrays this was tens of MB to parse and rewrite on every run.)
const VECTOR_BIN = '.cache/vectors.f32';
const VECTOR_INDEX = '.cache/vectors-index.json';
/** the cache format before vectors.f32; read once, then replaced */
const OLD_VECTOR_CACHE = '.cache/vectors.json';
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

export async function readVectors(bin = VECTOR_BIN, index = VECTOR_INDEX, old = OLD_VECTOR_CACHE): Promise<Map<string, Float32Array>> {
  if (existsSync(bin) && existsSync(index)) {
    const hashes = JSON.parse(await readFile(index, 'utf8')) as string[];
    const buf = await readFile(bin);
    const dim = hashes.length ? buf.byteLength / 4 / hashes.length : 0;
    if (Number.isInteger(dim)) {
      const all = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
      return new Map(hashes.map((h, i) => [h, all.slice(i * dim, (i + 1) * dim)]));
    }
    // sizes disagree (an interrupted write): start again rather than use misaligned vectors
    return new Map();
  }
  if (existsSync(old)) return new Map(Object.entries(JSON.parse(await readFile(old, 'utf8')) as Record<string, number[]>).map(([h, v]) => [h, Float32Array.from(v)]));
  return new Map();
}

export async function writeVectors(vectors: Map<string, Float32Array>, bin = VECTOR_BIN, index = VECTOR_INDEX): Promise<void> {
  const dim = vectors.values().next().value?.length ?? 0;
  const all = new Float32Array(vectors.size * dim);
  let i = 0;
  for (const v of vectors.values()) all.set(v, i++ * dim);
  await mkdir(dirname(bin), { recursive: true });
  await writeFile(bin, Buffer.from(all.buffer));
  await writeFile(index, JSON.stringify([...vectors.keys()]));
}

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
  const vectors = await readVectors();
  const hash = (t: string) => createHash('sha1').update(t).digest('hex');
  const todo = [...new Set([...text.values()])].filter((t) => !vectors.has(hash(t)));
  const current = new Set([...text.values()].map(hash));
  if (todo.length) {
    const run = embed ?? (await defaultEmbedder());
    const batches = Array.from({ length: Math.ceil(todo.length / 16) }, (_, i) => todo.slice(i * 16, i * 16 + 16));
    await pool(batches, 1, async (batch) => {
      const out = await run(batch);
      batch.forEach((t, i) => vectors.set(hash(t), Float32Array.from(out[i])));
    });
  }
  // Only keep current text, so the cache doesn't grow with every description edit.
  if (todo.length || !existsSync(VECTOR_BIN)) {
    await writeVectors(new Map([...vectors].filter(([h]) => current.has(h))));
    await rm(OLD_VECTOR_CACHE, { force: true });
  }
  return new Map(mods.map((m) => [m.id, vectors.get(hash(text.get(m.id)!))!]));
}
