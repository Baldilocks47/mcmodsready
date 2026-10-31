// Scores meaning-based matching on the frozen eval corpus across a grid of floors, next to word matching,
// and writes every suggestion for the best floors so unlabelled ones can be read by hand.
// Usage: npm install --no-save @huggingface/transformers && npx tsx pipeline/eval-embeddings.ts   (needs public/data)
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { alternativesFor, findRelations, SimilarityIndex, type AltCandidate, type Floors } from '../src/lib/core/alternatives';
import type { ModFile } from '../src/lib/core/types';
import { embedMods } from './embed';

interface Gold {
  slug: string;
  good: string[];
  bad: string[];
}
const gold = JSON.parse(readFileSync('data/alternatives-gold.json', 'utf8')) as Gold[];
const corpus = (JSON.parse(readFileSync('tests/fixtures/alt-corpus.json', 'utf8')) as (Omit<AltCandidate, 'ready'> & { author?: string; updated: string })[]).map((m) => ({ ...m, ready: true }));
const NOW = Date.parse('2026-11-01T00:00:00Z');
const bySlug = new Map(corpus.map((m) => [m.slug, m]));
const relations = findRelations(corpus);

// The corpus has no ids and the API's project lookup answers with them, so map through the published slug files.
const known = corpus.flatMap((m) => {
  const f = `public/data/slug/${m.slug}.json`;
  return existsSync(f) ? [{ ...m, id: (JSON.parse(readFileSync(f, 'utf8')) as { id: string }).id }] : [];
});
const byId = await embedMods(known as unknown as ModFile[]);
const vectors = new Map(known.map((m) => [m.slug, byId.get(m.id)!]));
console.log(`${vectors.size} of ${corpus.length} mods embedded`);

function run(index: SimilarityIndex) {
  let goodFound = 0;
  let badShown = 0;
  let shown = 0;
  const lists: Record<string, string[]> = {};
  for (const g of gold) {
    const target = bySlug.get(g.slug);
    if (!target) continue;
    const related = relations.get(g.slug) ?? new Map();
    const pool = [...new Set([...index.neighbours(g.slug, 40), ...related.keys()])].map((s) => bySlug.get(s)!).filter(Boolean);
    const alts = alternativesFor(target, pool, index, undefined, 3, NOW, new Set(), related).map((a) => a.slug);
    lists[g.slug] = alts;
    goodFound += g.good.filter((s) => alts.includes(s)).length;
    badShown += alts.filter((s) => g.bad.includes(s)).length;
    shown += alts.length;
  }
  const unlabelled = gold.reduce((n, g) => n + (lists[g.slug] ?? []).filter((s) => !g.good.includes(s) && !g.bad.includes(s)).length, 0);
  return { goodFound, badShown, unlabelled, shown, lists };
}

const words = run(new SimilarityIndex(corpus));
console.log('word matching', { ...words, lists: undefined });

const results: { floors: Floors; r: ReturnType<typeof run> }[] = [];
for (const minText of [0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7]) {
  for (const strongText of [0.6, 0.65, 0.7, 0.75, 0.8]) {
    if (strongText < minText) continue;
    for (const minScore of [0.3, 0.4, 0.5, 0.6]) {
      const index = new SimilarityIndex(corpus);
      const floors = { minText, strongText, minScore };
      index.useVectors(vectors, floors);
      results.push({ floors, r: run(index) });
    }
  }
}
results.sort((a, b) => b.r.goodFound - b.r.badShown - (a.r.goodFound - a.r.badShown) || a.r.unlabelled - b.r.unlabelled);
for (const { floors, r } of results.slice(0, 12)) console.log(JSON.stringify(floors), `good ${r.goodFound} bad ${r.badShown} unlabelled ${r.unlabelled} shown ${r.shown}`);

writeFileSync(process.argv[2] ?? '.cache/embedding-eval.json', JSON.stringify({ words: words.lists, best: results.slice(0, 3).map(({ floors, r }) => ({ floors, lists: r.lists })), gold }, null, 1));
