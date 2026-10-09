import { sidesFor } from './readiness';
import type { Env } from './types';

export interface AltCandidate {
  slug: string;
  title: string;
  description: string;
  categories: string[];
  downloads: number;
  env: Env;
  /** ISO time of last update */
  updated: string;
  /** true if ready for the target drop + loader */
  ready: boolean;
}

export interface Override {
  slug: string;
  note?: string;
}

export interface Alternative {
  slug: string;
  title: string;
  score: number;
  curated: boolean;
  note?: string;
}

/** Libraries are dependencies, not features; they can't be swapped for something "similar". */
export const NO_ALTERNATIVES_CATEGORY = 'library';

/** Minimum description similarity for an algorithmic suggestion. Below this we show nothing. */
export const MIN_TEXT_SIM = 0.2;

const STOP = new Set(
  'the and for with your that this from into are you its can not but all any has have will more minecraft mod mods adds add added which also than when what other some like such only just very game player players allows makes using used use based version versions fabric neoforge forge quilt'.split(
    ' ',
  ),
);

export function tokens(text: string): string[] {
  return (text.toLowerCase().match(/[a-z][a-z0-9]{2,}/g) ?? []).filter((t) => !STOP.has(t));
}

type Vec = Map<string, number>;

/** TF-IDF vectors over title + description, plus IDF weights for categories. */
export class SimilarityIndex {
  private vecs = new Map<string, Vec>();
  private catIdf = new Map<string, number>();

  constructor(docs: Pick<AltCandidate, 'slug' | 'title' | 'description' | 'categories'>[]) {
    const n = docs.length || 1;
    const df = new Map<string, number>();
    const cdf = new Map<string, number>();
    const toks = docs.map((d) => tokens(`${d.title} ${d.description}`));
    for (const ts of toks) for (const t of new Set(ts)) df.set(t, (df.get(t) ?? 0) + 1);
    for (const d of docs) for (const c of new Set(d.categories)) cdf.set(c, (cdf.get(c) ?? 0) + 1);
    for (const [c, k] of cdf) this.catIdf.set(c, Math.log(1 + n / k));

    docs.forEach((d, i) => {
      const tf = new Map<string, number>();
      for (const t of toks[i]) tf.set(t, (tf.get(t) ?? 0) + 1);
      const v: Vec = new Map();
      let norm = 0;
      for (const [t, f] of tf) {
        const w = f * Math.log(1 + n / (df.get(t) ?? 1));
        v.set(t, w);
        norm += w * w;
      }
      norm = Math.sqrt(norm) || 1;
      for (const [t, w] of v) v.set(t, w / norm);
      this.vecs.set(d.slug, v);
    });
  }

  text(a: string, b: string): number {
    const va = this.vecs.get(a);
    const vb = this.vecs.get(b);
    if (!va || !vb) return 0;
    let dot = 0;
    for (const [t, w] of va) dot += w * (vb.get(t) ?? 0);
    return dot;
  }

  /** IDF-weighted Jaccard: sharing a rare category counts more than sharing "utility". */
  categories(a: string[], b: string[]): number {
    const A = new Set(a);
    const B = new Set(b);
    let inter = 0;
    let union = 0;
    for (const c of new Set([...A, ...B])) {
      const w = this.catIdf.get(c) ?? 1;
      union += w;
      if (A.has(c) && B.has(c)) inter += w;
    }
    return union ? inter / union : 0;
  }
}

/**
 * A candidate can stand in for the target if it works on every side the target was used on.
 * A client-only replacement for a server mod is no use.
 */
export function sideCompatible(target: Env, candidate: Env): boolean {
  const need = sidesFor(target);
  if (candidate === 'unknown') return false;
  if (candidate === 'both' || candidate === 'either') return true;
  return need.every((s) => s === candidate);
}

/**
 * Rank up to `limit` alternatives. Curated overrides first; then candidates that share a
 * category and have similar descriptions, ranked by similarity with downloads and recency
 * as tie-breakers. Returns nothing for libraries.
 */
export function alternativesFor(
  target: Omit<AltCandidate, 'ready'>,
  candidates: AltCandidate[],
  index: SimilarityIndex,
  overrides: Override[] = [],
  limit = 3,
  now = Date.now(),
): Alternative[] {
  const bySlug = new Map(candidates.map((c) => [c.slug, c]));
  const out: Alternative[] = [];

  for (const o of overrides) {
    const c = bySlug.get(o.slug);
    if (c?.ready) out.push({ slug: c.slug, title: c.title, score: Infinity, curated: true, note: o.note });
  }
  // A curated entry means we know the real replacements; don't pad with guesses.
  if (overrides.length || target.categories.includes(NO_ALTERNATIVES_CATEGORY)) return out.slice(0, limit);

  const maxLogDl = Math.log10(Math.max(10, ...candidates.map((c) => c.downloads)));
  const scored = candidates
    .filter(
      (c) =>
        c.ready &&
        c.slug !== target.slug &&
        !c.categories.includes(NO_ALTERNATIVES_CATEGORY) &&
        !out.some((o) => o.slug === c.slug) &&
        sideCompatible(target.env, c.env),
    )
    .map((c) => {
      const cat = index.categories(target.categories, c.categories);
      const text = index.text(target.slug, c.slug);
      const dl = Math.log10(Math.max(10, c.downloads)) / maxLogDl;
      const ageDays = (now - Date.parse(c.updated)) / 86_400_000;
      const recency = Math.max(0, 1 - ageDays / 365);
      return { c, cat, text, score: text * 0.6 + cat * 0.4 + dl * 0.05 + recency * 0.02 };
    })
    .filter((x) => x.cat > 0 && x.text >= MIN_TEXT_SIM)
    .sort((a, b) => b.score - a.score);

  for (const { c, score } of scored) {
    if (out.length >= limit) break;
    out.push({ slug: c.slug, title: c.title, score, curated: false });
  }
  return out.slice(0, limit);
}
