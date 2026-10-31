// Freezes a sample of mods for the alternatives evaluation: every mod in the gold set plus the most
// downloaded mods as distractors. Re-run only to refresh the sample; scores change when it does.
// Usage: npx tsx pipeline/make-alt-corpus.ts   (reads public/data)
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import type { ModFile } from '../src/lib/core/types';

interface Gold {
  slug: string;
  good: string[];
  bad: string[];
}
const DATA = 'public/data';
const gold = JSON.parse(readFileSync('data/alternatives-gold.json', 'utf8')) as Gold[];
const wanted = new Set(gold.flatMap((g) => [g.slug, ...g.good, ...g.bad]));
const pages = JSON.parse(readFileSync(`${DATA}/pages.json`, 'utf8')) as { id: string; slug: string }[];
const mods: Record<string, unknown>[] = [];
const seen = new Set<string>();
const add = (id: string) => {
  const f = `${DATA}/m/${id}.json`;
  if (seen.has(id) || !existsSync(f)) return;
  seen.add(id);
  const m = JSON.parse(readFileSync(f, 'utf8')) as ModFile;
  mods.push({ slug: m.slug, title: m.title, description: m.description, categories: m.categories, downloads: m.downloads, env: m.env, updated: m.updated, author: m.author });
};
const missing: string[] = [];
for (const slug of wanted) {
  const f = `${DATA}/slug/${slug}.json`;
  if (existsSync(f)) add((JSON.parse(readFileSync(f, 'utf8')) as { id: string }).id);
  else missing.push(slug);
}
for (const p of pages.slice(0, 1500)) add(p.id);
writeFileSync('tests/fixtures/alt-corpus.json', JSON.stringify(mods));
console.log(`${mods.length} mods; missing from data: ${missing.join(', ') || 'none'}`);
