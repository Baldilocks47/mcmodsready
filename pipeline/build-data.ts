// Pulls Mojang + Modrinth data and writes static JSON shards.
// Usage: npx tsx pipeline/build-data.ts [--top 500] [--out public/data] [--only-top 100]
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { alternativesFor, SimilarityIndex, type AltCandidate } from '../src/lib/core/alternatives';
import { cellFor, envOf, median } from '../src/lib/core/status';
import { LOADERS, type Cell, type Drop, type Loader, type ModVersion } from '../src/lib/core/types';
import { buildDrops } from '../src/lib/core/versions';
import { fetchManifest } from './mojang';
import { pool, projects, topMods, versions } from './modrinth';
import { loadOverrides } from './overrides';
import type { MatrixFile, MatrixMod, MetaFile, ProjectFile, StatsFile, FeedEvent } from '../src/lib/data-schema';

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].replace(/^--/, ''), process.argv[i + 1]);
const TOP = Number(args.get('top') ?? 500);
const OUT = args.get('out') ?? 'public/data';
const CACHE = args.get('cache') ?? '.cache/versions';
/** number of drops shown as columns (including an upcoming one) */
const WINDOW = Number(args.get('window') ?? 4);
const DAY = 86_400_000;

async function main() {
  const t0 = Date.now();
  const manifest = await fetchManifest();
  const allDrops = buildDrops(manifest.versions);
  const drops = allDrops.slice(0, WINDOW);
  const released = allDrops.filter((d) => !d.upcoming);
  const latestTwo = released.slice(0, 2);
  log(`drops: ${drops.map((d) => d.id + (d.upcoming ? '*' : '')).join(', ')}`);

  // 1. Tracked set: top N per loader.
  const topByLoader = new Map<Loader, string[]>();
  for (const loader of LOADERS) {
    const hits = await topMods(loader, TOP);
    topByLoader.set(loader, hits.map((h) => h.project_id));
    log(`${loader}: ${hits.length} top mods`);
  }
  const ids = [...new Set([...topByLoader.values()].flat())];
  const projs = await projects(ids);
  log(`${projs.length} projects`);

  // 2. Versions, cached by project `updated` stamp.
  await mkdir(CACHE, { recursive: true });
  let fetched = 0;
  const versionLists = await pool(projs, 8, async (p) => {
    const file = join(CACHE, `${p.id}.json`);
    if (existsSync(file)) {
      const cached = JSON.parse(await readFile(file, 'utf8')) as { updated: string; versions: ModVersion[] };
      if (cached.updated === p.updated) return cached.versions;
    }
    const vs = await versions(p.id);
    fetched++;
    await writeFile(file, JSON.stringify({ updated: p.updated, versions: vs }));
    return vs;
  });
  const versionsById = new Map(projs.map((p, i) => [p.id, versionLists[i]]));
  log(`versions: ${fetched} fetched, ${projs.length - fetched} from cache`);

  const overrides = await loadOverrides();
  const now = Date.now();
  await mkdir(join(OUT, 'projects'), { recursive: true });

  const meta: MetaFile = {
    generatedAt: new Date(now).toISOString(),
    latestRelease: manifest.latest.release,
    latestSnapshot: manifest.latest.snapshot,
    drops,
    loaders: LOADERS,
    tracked: {} as Record<Loader, number>,
  };
  const projectFiles = new Map<string, ProjectFile>();
  const feed: FeedEvent[] = [];

  for (const loader of LOADERS) {
    const top = new Set(topByLoader.get(loader));
    const mods: MatrixMod[] = [];
    for (const p of projs) {
      if (!p.loaders.includes(loader)) continue;
      const vs = versionsById.get(p.id) ?? [];
      const cells: Record<string, Cell> = {};
      for (const d of drops) cells[d.id] = cellFor(p, vs, loader, d, latestTwo, now);
      // history: lag for every released year-based drop, not just the window
      const history: Record<string, number | null> = {};
      for (const d of released) {
        const c = drops.includes(d) ? cells[d.id] : cellFor(p, vs, loader, d, latestTwo, now);
        history[d.id] = c.status === 'ready' ? (c.lagDays ?? null) : null;
      }
      mods.push({
        id: p.id,
        slug: p.slug,
        title: p.title,
        icon: p.icon_url,
        downloads: p.downloads,
        env: envOf(p),
        description: p.description,
        categories: p.categories,
        updated: p.updated,
        top: top.has(p.id),
        cells,
        history,
        deps: requiredDeps(vs, loader, released[0]),
        alts: {},
      });
    }
    mods.sort((a, b) => b.downloads - a.downloads);

    // 3. Alternatives for not-ready cells.
    const index = new SimilarityIndex(mods);
    for (const d of drops) {
      const candidates: AltCandidate[] = mods.map((m) => ({
        slug: m.slug,
        title: m.title,
        description: m.description,
        categories: m.categories,
        downloads: m.downloads,
        env: m.env,
        updated: m.updated,
        ready: m.cells[d.id].status === 'ready' || (d.upcoming && m.cells[d.id].status === 'snapshot'),
      }));
      for (const m of mods) {
        const s = m.cells[d.id].status;
        if (s === 'ready' || s === 'not_applicable') continue;
        const alts = alternativesFor(m, candidates, index, overrides.get(m.slug) ?? [], 3, now);
        if (alts.length) m.alts[d.id] = alts.map((a) => ({ slug: a.slug, curated: a.curated, note: a.note }));
      }
    }

    // 4. Newly ready events: first release build for a window drop published in the last 7 days.
    for (const m of mods) {
      for (const d of drops) {
        if (d !== released[0] || m.cells[d.id].status !== 'ready') continue;
        const vs = (versionsById.get(m.id) ?? []).filter(
          (v) => v.loaders.includes(loader) && v.version_type === 'release' && v.game_versions.some((g) => d.patches.includes(g)),
        );
        const first = Math.min(...vs.map((v) => Date.parse(v.date_published)));
        if (now - first < 7 * DAY) feed.push({ at: new Date(first).toISOString(), slug: m.slug, title: m.title, loader, drop: d.id, top: m.top });
      }
    }

    meta.tracked[loader] = mods.length;
    const matrix: MatrixFile = { loader, generatedAt: meta.generatedAt, drops: drops.map((d) => d.id), mods };
    await writeJson(join(OUT, `matrix-${loader}.json`), matrix);
    await writeJson(join(OUT, `stats-${loader}.json`), stats(loader, mods, drops, released, meta.generatedAt));

    for (const m of mods) {
      const pf = projectFiles.get(m.slug) ?? {
        id: m.id,
        slug: m.slug,
        title: m.title,
        description: m.description,
        icon: m.icon,
        downloads: m.downloads,
        env: m.env,
        categories: m.categories,
        updated: m.updated,
        loaders: {},
      };
      pf.loaders[loader] = { cells: m.cells, history: m.history, alts: m.alts, deps: m.deps };
      projectFiles.set(m.slug, pf);
    }
  }

  for (const pf of projectFiles.values()) await writeJson(join(OUT, 'projects', `${pf.slug}.json`), pf);
  feed.sort((a, b) => b.at.localeCompare(a.at));
  await writeJson(join(OUT, 'feed.json'), { generatedAt: meta.generatedAt, events: feed });
  await writeJson(join(OUT, 'meta.json'), meta);
  log(`done in ${((Date.now() - t0) / 1000).toFixed(1)}s → ${OUT}`);
}

/** Required dependency project ids declared by the newest build for this loader on the latest drop. */
function requiredDeps(vs: ModVersion[], loader: Loader, drop: Drop | undefined): string[] {
  if (!drop) return [];
  const newest = vs
    .filter((v) => v.loaders.includes(loader) && v.game_versions.some((g) => drop.patches.includes(g)))
    .sort((a, b) => b.date_published.localeCompare(a.date_published))[0];
  return (newest?.dependencies ?? [])
    .filter((d) => d.dependency_type === 'required' && d.project_id)
    .map((d) => d.project_id!);
}

function stats(loader: Loader, mods: MatrixMod[], drops: Drop[], released: Drop[], generatedAt: string): StatsFile {
  const top100 = mods.filter((m) => m.top).slice(0, 100);
  return {
    loader,
    generatedAt,
    window: drops.map((d) => {
      const counts: Record<string, number> = {};
      for (const m of top100) counts[m.cells[d.id].status] = (counts[m.cells[d.id].status] ?? 0) + 1;
      return { drop: d.id, upcoming: d.upcoming, releasedAt: d.releasedAt, top100: counts };
    }),
    lag: released.map((d) => {
      const lags = top100.map((m) => m.history[d.id]).filter((x): x is number => x != null);
      const by = (days: number) => lags.filter((x) => x <= days).length;
      return {
        drop: d.id,
        releasedAt: d.releasedAt!,
        median: median(lags),
        readyCount: lags.length,
        of: top100.length,
        readyBy: { 1: by(1), 7: by(7), 30: by(30) },
      };
    }),
  };
}

async function writeJson(path: string, data: unknown) {
  await writeFile(path, JSON.stringify(data));
}

function log(msg: string) {
  console.log(`[build-data] ${msg}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
