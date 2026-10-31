// Scores suggestions against hand-checked pairs over a frozen sample of mods, so ranking changes can't
// quietly make things worse. Curated overrides are left out: this measures the automatic matching.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { alternativesFor, findRelations, SimilarityIndex, type AltCandidate } from '../src/lib/core/alternatives';

interface Gold {
  slug: string;
  good: string[];
  bad: string[];
}
const gold = JSON.parse(readFileSync('data/alternatives-gold.json', 'utf8')) as Gold[];
const corpus = (JSON.parse(readFileSync('tests/fixtures/alt-corpus.json', 'utf8')) as (Omit<AltCandidate, 'ready'> & { author?: string })[]).map((m) => ({ ...m, ready: true }));
const NOW = Date.parse('2026-11-01T00:00:00Z');

function score(withRelations: boolean) {
  const index = new SimilarityIndex(corpus);
  const relations = withRelations ? findRelations(corpus) : new Map();
  const bySlug = new Map(corpus.map((m) => [m.slug, m]));
  let goodFound = 0;
  let goodTotal = 0;
  let badShown = 0;
  let shown = 0;
  for (const g of gold) {
    const target = bySlug.get(g.slug);
    if (!target) continue;
    const related = relations.get(g.slug) ?? new Map();
    const pool = [...new Set([...index.neighbours(g.slug, 40), ...related.keys()])].map((s) => bySlug.get(s)!).filter(Boolean);
    const alts = alternativesFor(target, pool, index, undefined, 3, NOW, new Set(), related).map((a) => a.slug);
    const reachable = g.good.filter((s) => bySlug.has(s));
    goodTotal += reachable.length;
    goodFound += reachable.filter((s) => alts.includes(s)).length;
    badShown += alts.filter((s) => g.bad.includes(s)).length;
    shown += alts.length;
  }
  return { goodFound, goodTotal, badShown, shown };
}

describe('alternatives evaluation', () => {
  it('reports scores and holds the line on them', () => {
    const before = score(false);
    const after = score(true);
    console.log('without relations', before);
    console.log('with relations', after);
    // Baselines from the frozen corpus. Raise them as matching improves; never lower them without a reason.
    expect(after.goodFound).toBeGreaterThanOrEqual(BASELINE.goodFound);
    expect(after.badShown).toBeLessThanOrEqual(BASELINE.badShown);
    expect(after.goodFound).toBeGreaterThanOrEqual(before.goodFound);
  });
});

const BASELINE = { goodFound: 6, badShown: 5 }; // measured 31 Oct 2026 (was 6 and 8 before the score floor)
