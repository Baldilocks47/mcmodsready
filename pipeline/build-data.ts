// Pulls Mojang + Modrinth data and writes static JSON shards (see src/lib/data-schema.ts).
// Usage: npx tsx pipeline/build-data.ts [--min-downloads 10000] [--max-per-loader 20000] [--top 500]
//          [--pages 5000] [--max-fetch N] [--out public/data] [--cache .cache/mods]
// Incremental: a mod's versions are only re-fetched when its Modrinth `date_modified` changes.
// --max-fetch caps version fetches per run so the first (cold-cache) backfill can span several runs;
// mods not yet fetched are simply looked up live by the site.
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { alternativesFor, SimilarityIndex, type AltCandidate } from '../src/lib/core/alternatives';
import { dropCell, median, type StatusContext } from '../src/lib/core/status';
import { deriveModFile, projectFromHit } from '../src/lib/core/support';
import { LOADERS, type Cell, type Loader, type ModFile, type ModProject, type ModVersion } from '../src/lib/core/types';
import { buildDrops, buildGameVersions } from '../src/lib/core/versions';
import type { FeedEvent, MatrixFile, MatrixMod, MetaFile, PageRef, StatsFile, VersionShard } from '../src/lib/data-schema';
import { fetchManifest } from './mojang';
import { modsForLoader, pool, versions, type SearchHit } from './modrinth';
import { loadOverrides } from './overrides';

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].replace(/^--/, ''), process.argv[i + 1]);
const MIN_DL = Number(args.get('min-downloads') ?? 10_000);
const MAX_PER_LOADER = Number(args.get('max-per-loader') ?? 20_000);
const TOP = Number(args.get('top') ?? 500);
const PAGES = Number(args.get('pages') ?? 5000);
const MAX_FETCH = Number(args.get('max-fetch') ?? Infinity);
const OUT = args.get('out') ?? 'public/data';
const CACHE = args.get('cache') ?? '.cache/mods';
const WINDOW = Number(args.get('window') ?? 4);
const DAY = 86_400_000;

/**
 * Cached per mod: the raw (trimmed) version list, not derived data, so changes to how we derive
 * support never require re-downloading. Compact tuple per version:
 * [game_versions, loaders, type, date_published, required dep ids, incompatible ids]
 */
type CompactVersion = [string[], string[], ModVersion['version_type'], string, string[], string[]];
interface CacheEntry {
  format: 2;
  updated: string;
  vs: CompactVersion[];
}

const compact = (vs: ModVersion[]): CompactVersion[] =>
  vs.map((v) => [
    v.game_versions,
    v.loaders,
    v.version_type,
    v.date_published,
    v.dependencies.filter((d) => d.dependency_type === 'required' && d.project_id).map((d) => d.project_id!),
    v.dependencies.filter((d) => d.dependency_type === 'incompatible' && d.project_id).map((d) => d.project_id!),
  ]);

const expand = (projectId: string, vs: CompactVersion[]): ModVersion[] =>
  vs.map(([game_versions, loaders, version_type, date_published, req, inc], i) => ({
    id: String(i),
    project_id: projectId,
    version_number: '',
    game_versions,
    loaders,
    version_type,
    date_published,
    dependencies: [
      ...req.map((project_id) => ({ project_id, dependency_type: 'required' })),
      ...inc.map((project_id) => ({ project_id, dependency_type: 'incompatible' })),
    ],
  }));

async function main() {
  const t0 = Date.now();
  const manifest = await fetchManifest();
  const allDrops = buildDrops(manifest.versions);
  const drops = allDrops.slice(0, WINDOW);
  const released = allDrops.filter((d) => !d.upcoming);
  const allVersions = buildGameVersions(manifest.versions);
  log(`drops: ${drops.map((d) => d.id + (d.upcoming ? '*' : '')).join(', ')}`);

  // 1. Tracked set: every mod with >= MIN_DL downloads, per loader.
  const hitsById = new Map<string, SearchHit>();
  for (const loader of LOADERS) {
    const hits = await modsForLoader(loader, MIN_DL, MAX_PER_LOADER);
    for (const h of hits) hitsById.set(h.project_id, h);
    log(`${loader}: ${hits.length} mods with >= ${MIN_DL} downloads`);
  }
  const projs: ModProject[] = [...hitsById.values()].map(projectFromHit).sort((a, b) => b.downloads - a.downloads);
  log(`${projs.length} unique mods`);

  // 2. Support maps, cached by Modrinth's modified date. Most-downloaded first so a capped run covers the important ones.
  await mkdir(CACHE, { recursive: true });
  let fetched = 0;
  let skipped = 0;
  const files = await pool(projs, 6, async (p): Promise<ModFile | null> => {
    const file = join(CACHE, `${p.id}.json`);
    let cached: CacheEntry | null = null;
    if (existsSync(file)) {
      const c = JSON.parse(await readFile(file, 'utf8')) as CacheEntry;
      if (c.format === 2) cached = c;
    }
    if (cached && cached.updated === p.updated) return deriveModFile(p, expand(p.id, cached.vs));
    if (fetched >= MAX_FETCH) {
      skipped++;
      // stale is better than missing; brand-new mods wait for the next run (the site looks them up live)
      return cached ? deriveModFile(p, expand(p.id, cached.vs)) : null;
    }
    fetched++;
    const vs = await versions(p.id);
    if (!vs) return null;
    await writeFile(file, JSON.stringify({ format: 2, updated: p.updated, vs: compact(vs) } satisfies CacheEntry));
    if (fetched % 500 === 0) log(`  fetched ${fetched} version lists…`);
    return deriveModFile(p, vs);
  });
  const mods = files.filter((f): f is ModFile => !!f && Object.keys(f.loaders).length > 0);
  log(`versions: ${fetched} fetched, ${skipped} deferred, ${mods.length} mods with data`);

  const overrides = await loadOverrides();
  const now = Date.now();
  const generatedAt = new Date(now).toISOString();
  const bySlug = new Map(mods.map((m) => [m.slug, m]));
  const byId = new Map(mods.map((m) => [m.id, m]));
  const ctxFor = (m: ModFile): StatusContext => ({
    latestDrops: released.slice(0, 2),
    currentDrop: released[0].id,
    updated: m.updated,
    now,
  });

  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });

  const feed: FeedEvent[] = [];
  const tracked = {} as Record<Loader, number>;
  const popularLegacy = {} as Record<Loader, string[]>;
  const versionsWithData = new Set<string>();

  for (const loader of LOADERS) {
    const lm = mods.filter((m) => m.loaders[loader]).sort((a, b) => b.downloads - a.downloads);
    tracked[loader] = lm.length;
    const topIds = new Set(lm.slice(0, TOP).map((m) => m.id));

    // drop cells for every mod (needed for alternatives as well as the grid)
    const cells = new Map<string, Record<string, Cell>>();
    for (const m of lm) {
      const c: Record<string, Cell> = {};
      for (const d of allDrops.filter((d) => drops.includes(d) || !d.upcoming)) c[d.id] = dropCell(m.loaders[loader], d, ctxFor(m));
      cells.set(m.id, c);
    }

    // 3. Alternatives: textual neighbours + declared rivals, filtered to ready + side-compatible.
    const index = new SimilarityIndex(lm);
    const rivalsOf = new Map<string, Set<string>>();
    for (const m of lm) {
      for (const otherId of m.loaders[loader]!.incompat) {
        const o = byId.get(otherId);
        if (!o) continue;
        (rivalsOf.get(m.slug) ?? rivalsOf.set(m.slug, new Set()).get(m.slug)!).add(o.slug);
        (rivalsOf.get(o.slug) ?? rivalsOf.set(o.slug, new Set()).get(o.slug)!).add(m.slug);
      }
    }
    for (const m of lm) {
      const rivals = rivalsOf.get(m.slug) ?? new Set<string>();
      const pool = [...new Set([...index.neighbours(m.slug, 40), ...rivals, ...(overrides.get(m.slug) ?? []).map((o) => o.slug)])]
        .map((s) => bySlug.get(s))
        .filter((x): x is ModFile => !!x && !!x.loaders[loader]);
      for (const d of drops) {
        const st = cells.get(m.id)![d.id].status;
        if (st === 'ready' || st === 'not_applicable') continue;
        const candidates: AltCandidate[] = pool.map((c) => {
          const cs = cells.get(c.id)![d.id].status;
          return { ...c, ready: cs === 'ready' || (d.upcoming && cs === 'snapshot') };
        });
        const alts = alternativesFor(m, candidates, index, overrides.get(m.slug), 3, now, rivals);
        if (alts.length) {
          m.alts ??= {};
          (m.alts[loader] ??= {})[d.id] = alts.map((a) => ({ slug: a.slug, curated: a.curated, ...(a.note ? { note: a.note } : {}) }));
        }
      }
    }

    // 4. Grid (top N), stats + feed (top 100).
    const rows: MatrixMod[] = lm.slice(0, TOP).map((m) => ({
      id: m.id,
      slug: m.slug,
      title: m.title,
      icon: m.icon,
      downloads: m.downloads,
      env: m.env,
      cells: Object.fromEntries(drops.map((d) => [d.id, cells.get(m.id)![d.id]])),
    }));
    await writeJson('matrix-' + loader + '.json', { loader, generatedAt, drops: drops.map((d) => d.id), mods: rows } satisfies MatrixFile);

    const top100 = lm.slice(0, 100);
    const stats: StatsFile = {
      loader,
      generatedAt,
      window: drops.map((d) => {
        const counts: Record<string, number> = {};
        for (const m of top100) {
          const s = cells.get(m.id)![d.id].status;
          counts[s] = (counts[s] ?? 0) + 1;
        }
        return { drop: d.id, upcoming: d.upcoming, releasedAt: d.releasedAt, top100: counts };
      }),
      lag: released.map((d) => {
        const lags = top100
          .map((m) => cells.get(m.id)![d.id])
          .filter((c) => c.status === 'ready' && c.lagDays != null)
          .map((c) => c.lagDays!);
        const by = (n: number) => lags.filter((x) => x <= n).length;
        return { drop: d.id, releasedAt: d.releasedAt!, median: median(lags), readyCount: lags.length, of: top100.length, readyBy: { 1: by(1), 7: by(7), 30: by(30) } };
      }),
    };
    await writeJson(`stats-${loader}.json`, stats);

    const latest = released[0];
    for (const m of lm) {
      const s = m.loaders[loader]!;
      const days = latest.patches.map((p) => (s.v[p]?.[0] === 'r' ? s.v[p][1] : undefined)).filter((x): x is number => x != null);
      if (!days.length) continue;
      const first = Math.min(...days);
      if (now - first * DAY < 7 * DAY) feed.push({ at: new Date(first * DAY).toISOString(), slug: m.slug, title: m.title, loader, drop: latest.id, top: topIds.has(m.id) });
    }

    // 5. Exact-version shards.
    const shards = new Map<string, Record<string, 'r' | 'b' | 'a'>>();
    for (const m of lm) {
      for (const [gv, e] of Object.entries(m.loaders[loader]!.v)) {
        (shards.get(gv) ?? shards.set(gv, {}).get(gv)!)[m.id] = e[0];
      }
    }
    const known = new Set(allVersions.map((v) => v.id));
    for (const [gv, entries] of shards) {
      if (!known.has(gv)) continue;
      versionsWithData.add(gv);
      await writeJson(`v/${loader}/${gv}.json`, { loader, version: gv, mods: entries } satisfies VersionShard);
    }
    const windowPatches = new Set(drops.flatMap((d) => [...d.patches, ...d.previews]));
    popularLegacy[loader] = allVersions
      .filter((v) => v.type === 'release' && !windowPatches.has(v.id))
      .map((v) => ({ id: v.id, n: Object.values(shards.get(v.id) ?? {}).filter((t) => t === 'r').length }))
      .sort((a, b) => b.n - a.n)
      .slice(0, 4)
      .map((x) => x.id);
  }

  // 6. Per-mod files and the pre-rendered page list.
  const pageList: PageRef[] = mods.slice(0, PAGES).map((m) => ({ id: m.id, slug: m.slug }));
  const pageIds = new Set(pageList.map((p) => p.id));
  for (const m of mods) await writeJson(`m/${m.id}.json`, { ...m, page: pageIds.has(m.id) } satisfies ModFile);
  await writeJson('pages.json', pageList);

  feed.sort((a, b) => b.at.localeCompare(a.at) || Number(b.top) - Number(a.top));
  await writeJson('feed.json', { generatedAt, events: feed.slice(0, 200) });
  const meta: MetaFile = {
    generatedAt,
    latestRelease: manifest.latest.release,
    latestSnapshot: manifest.latest.snapshot,
    drops,
    versions: allVersions.filter((v) => versionsWithData.has(v.id) || windowHas(drops, v.id)),
    popularLegacy,
    loaders: LOADERS,
    tracked,
    minDownloads: MIN_DL,
  };
  await writeJson('meta.json', meta);
  log(`tracked: ${LOADERS.map((l) => `${l} ${tracked[l]}`).join(', ')}; ${versionsWithData.size} versions with data`);
  log(`done in ${((Date.now() - t0) / 1000).toFixed(1)}s → ${OUT}`);
}

function windowHas(drops: { patches: string[]; previews: string[] }[], id: string) {
  return drops.some((d) => d.patches.includes(id) || d.previews.includes(id));
}

async function writeJson(rel: string, data: unknown) {
  const path = join(OUT, rel);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(data));
}

function log(msg: string) {
  console.log(`[build-data] ${msg}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
