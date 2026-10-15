// Social preview (Open Graph) images, 1200x630 PNG, rendered after `astro build` into dist/og/.
// Site pages show live headline numbers; each pre-rendered mod page gets its own card.
// Usage: npx tsx pipeline/og.ts   (reads DATA_DIR, default public/data; writes dist/og)
import { renderAsync } from '@resvg/resvg-js';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import satori from 'satori';
import { dropCell } from '../src/lib/core/status';
import { contextFor } from '../src/lib/core/targets';
import type { Loader, ModFile, Status } from '../src/lib/core/types';
import type { MetaFile, PageRef, StatsFile } from '../src/lib/data-schema';

const DATA = process.env.DATA_DIR ?? 'public/data';
const OUT = 'dist/og';
// Rendered cards keyed by a hash of everything drawn on them, so unchanged cards are reused across builds.
const CACHE = '.cache/og';
const STYLE_VERSION = '1'; // bump to force every card to re-render after a design change
const W = 1200;
const H = 630;
const LOADER: Record<Loader, string> = { fabric: 'Fabric', neoforge: 'NeoForge', forge: 'Forge' };
const C = { bg: '#17191d', panel: '#24272d', outline: '#0b0c0e', text: '#ecebe6', muted: '#a3a29a', grass: '#5d9e33', grassLight: '#7cc04b', dirt: '#866043' };
const STATUS: Partial<Record<Status, { text: string; fg: string; bg: string }>> = {
  ready: { text: 'Ready', fg: '#6fe08f', bg: '#173823' },
  prerelease: { text: 'Beta only', fg: '#f5c84c', bg: '#3b2f0f' },
  snapshot: { text: 'Snapshot build', fg: '#6fe3ef', bg: '#11343a' },
  not_yet: { text: 'Not yet', fg: '#ff8a7d', bg: '#451b17' },
  no_build: { text: 'No build', fg: '#a3a29a', bg: '#2b2e34' },
  dropped: { text: 'Inactive', fg: '#a3a29a', bg: '#2b2e34' },
};

type Node = { type: string; props: Record<string, unknown> };
const h = (type: string, style: Record<string, unknown>, ...children: (Node | string)[]): Node => ({
  type,
  props: { style: { display: 'flex', ...style }, children: children.length === 1 ? children[0] : children },
});

const read = async <T>(f: string) => JSON.parse(await readFile(join(DATA, f), 'utf8')) as T;
const font = (pkg: string, file: string) => readFile(join('node_modules', '@fontsource', pkg, 'files', file));

function grassStrip(): Node {
  // pixel grass edge over dirt, like the site header
  const cols = 60;
  const drip = [2, 3, 2, 2, 4, 3, 2, 2, 3, 2, 2, 4, 3, 2, 3, 2];
  return h(
    'div',
    { position: 'absolute', top: 0, left: 0, width: W, height: 30, flexDirection: 'row' },
    ...Array.from({ length: cols }, (_, i) =>
      h('div', { width: W / cols, height: 30, flexDirection: 'column' }, h('div', { height: drip[i % 16] * 5, backgroundColor: i % 4 ? C.grass : C.grassLight }), h('div', { flexGrow: 1, backgroundColor: C.dirt })),
    ),
  );
}

function frame(...body: Node[]): Node {
  return h(
    'div',
    { width: W, height: H, boxSizing: 'border-box', backgroundColor: C.bg, flexDirection: 'column', padding: '70px 64px 48px', position: 'relative', fontFamily: 'Inter', color: C.text },
    grassStrip(),
    ...body,
    h('div', { position: 'absolute', bottom: 40, left: 64, width: W - 128, justifyContent: 'space-between', alignItems: 'center' },
      h('div', { fontFamily: 'Tiny5', fontSize: 40, color: C.text }, h('span', {}, 'mc'), h('span', { color: '#d8d4c8' }, 'mods'), h('span', { color: '#8fd655' }, 'ready')),
      h('div', { fontSize: 22, color: C.muted }, 'mcmodsready.com · free · no accounts'),
    ),
  );
}

function bar(label: string, ready: number, total: number): Node {
  const pct = total ? ready / total : 0;
  return h('div', { flexDirection: 'column', marginBottom: 22, width: W - 128 },
    h('div', { justifyContent: 'space-between', fontSize: 28, marginBottom: 8 }, h('span', { fontWeight: 700 }, label), h('span', { color: C.muted }, `${ready} of top ${total} ready`)),
    h('div', { height: 30, width: W - 128, boxSizing: 'border-box', backgroundColor: '#1c1e1a', border: `3px solid ${C.outline}` },
      h('div', { width: `${Math.round(pct * 100)}%`, backgroundColor: '#80ff20' }),
    ),
  );
}

function chip(status: Status): Node {
  const s = STATUS[status] ?? STATUS.no_build!;
  return h('div', { fontSize: 26, fontWeight: 700, color: s.fg, backgroundColor: s.bg, border: `3px solid ${s.fg}`, padding: '4px 14px' }, s.text);
}

async function main() {
  const fonts = [
    { name: 'Inter', data: await font('inter', 'inter-latin-400-normal.woff'), weight: 400 as const, style: 'normal' as const },
    { name: 'Inter', data: await font('inter', 'inter-latin-700-normal.woff'), weight: 700 as const, style: 'normal' as const },
    { name: 'Tiny5', data: await font('tiny5', 'tiny5-latin-400-normal.woff'), weight: 400 as const, style: 'normal' as const },
  ];
  await mkdir(CACHE, { recursive: true });
  let rendered = 0;
  let reused = 0;
  const render = async (node: Node, file: string) => {
    const key = createHash('sha1').update(STYLE_VERSION + JSON.stringify(node)).digest('hex');
    const cached = join(CACHE, `${key}.png`);
    if (existsSync(cached)) {
      reused++;
      return copyFile(cached, join(OUT, file));
    }
    const svg = await satori(node as never, { width: W, height: H, fonts });
    // renderAsync runs on libuv's thread pool, so several cards rasterise in parallel
    const png = (await renderAsync(svg, { fitTo: { mode: 'width', value: W } })).asPng();
    await writeFile(cached, png);
    await writeFile(join(OUT, file), png);
    rendered++;
  };

  const meta = await read<MetaFile>('meta.json');
  const latest = meta.drops.find((d) => !d.upcoming)!;
  const stats = await Promise.all(meta.loaders.map((l) => read<StatsFile>(`stats-${l}.json`)));
  await mkdir(join(OUT, 'mod'), { recursive: true });

  const headline = (text: string, size = 64) => h('div', { fontFamily: 'Tiny5', fontSize: size, lineHeight: 1.1, marginBottom: 30 }, text);
  const bars = h('div', { flexDirection: 'column', width: '100%' },
    ...stats.map((s) => {
      const w = s.window.find((x) => x.drop === latest.id)!;
      const total = Object.values(w.top100).reduce((a, b) => a + b, 0);
      return bar(LOADER[s.loader], w.top100.ready ?? 0, total);
    }),
  );

  await render(frame(headline(`Are your mods ready for Minecraft ${latest.id}?`), bars), 'index.png');
  await render(frame(headline(`Every Fabric, NeoForge & Forge mod, every version`, 56), bars), 'mods.png');
  await render(frame(headline('Is my mod list ready?'), h('div', { fontSize: 34, lineHeight: 1.4, color: C.muted, flexDirection: 'column' },
    h('div', {}, 'Paste your mods. See if your server and players can update,'),
    h('div', {}, "what's blocking you, and what to use instead."),
  )), 'list.png');
  await render(frame(headline('Readiness badges for mod pages'), h('div', { fontSize: 34, lineHeight: 1.4, color: C.muted, flexDirection: 'column' },
    h('div', {}, 'A free badge that shows if your mod is ready for the'),
    h('div', {}, 'latest Minecraft version, and updates by itself.'),
  )), 'badges.png');

  // per-mod cards for pre-rendered pages
  const pages = (await read<PageRef[]>("pages.json")).slice(0, Number(process.env.OG_LIMIT ?? Infinity));
  const src = { drops: meta.drops, versions: meta.versions };
  let n = 0;
  const queue = [...pages];
  const workers = Array.from({ length: 8 }, async () => {
    for (let p = queue.shift(); p; p = queue.shift()) await card(p);
  });
  async function card(p: PageRef) {
    const m = await read<ModFile>(`m/${p.id}.json`);
    const loaders = (Object.keys(m.loaders) as Loader[]).sort((a, b) => meta.loaders.indexOf(a) - meta.loaders.indexOf(b));
    const ctx = contextFor(m, src);
    const rows = loaders.map((l) =>
      h('div', { alignItems: 'center', marginBottom: 18 }, h('div', { width: 220, fontSize: 32, fontWeight: 700 }, LOADER[l]), chip(dropCell(m.loaders[l], latest, ctx).status)),
    );
    const title = m.title.length > 34 ? `${m.title.slice(0, 32)}…` : m.title;
    const desc = m.description.length > 120 ? `${m.description.slice(0, 118)}…` : m.description;
    const dl = m.downloads >= 1e6 ? `${Number((m.downloads / 1e6).toPrecision(2))}M` : `${Number((m.downloads / 1e3).toPrecision(2))}k`;
    await render(
      frame(
        headline(`Is ${title} ready for ${latest.id}?`, title.length > 20 ? 52 : 64),
        h('div', { fontSize: 26, color: C.muted, marginTop: -10, marginBottom: 30, width: W - 128 }, `${desc} · ${dl} downloads`),
        h('div', { flexDirection: 'column' }, ...rows),
      ),
      `mod/${p.slug}.png`,
    );
    if (++n % 1000 === 0) console.log(`[og] ${n} mod cards…`);
  }
  await Promise.all(workers);
  console.log(`[og] ${4 + n} cards in ${OUT}: ${rendered} rendered, ${reused} reused from cache`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
