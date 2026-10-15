// GET /badge/<slug-or-id>.svg[?v=26.3|1.20.1][&loader=fabric|neoforge|forge]
// Defaults: the latest released drop, best status across loaders. Works for any Modrinth mod:
// tracked mods come from R2, others are derived live from Modrinth with the same core code.
import { BADGE_STATUS, LOADER_NAME, badgeSvg, bestStatus } from '../../src/lib/core/badge';
import { deriveModFile } from '../../src/lib/core/support';
import { cellAt, defaultTarget, parseTarget, type TargetSource } from '../../src/lib/core/targets';
import { LOADERS, type Loader, type ModFile, type ModProject, type ModVersion, type Status } from '../../src/lib/core/types';
import type { Env } from './index';

const UA = 'mcmodsready-badges/1.0 (https://mcmodsready.com)';
const TTL = 3600;

let metaCache: { at: number; src: TargetSource } | null = null;

async function targetSource(env: Env): Promise<TargetSource | null> {
  if (metaCache && Date.now() - metaCache.at < 300_000) return metaCache.src;
  const obj = await env.DATA.get('data/meta.json');
  if (!obj) return null;
  const m = (await obj.json()) as TargetSource;
  metaCache = { at: Date.now(), src: { drops: m.drops, versions: m.versions } };
  return metaCache.src;
}

async function loadMod(env: Env, key: string): Promise<ModFile | null> {
  let id = /^[A-Za-z0-9]{8}$/.test(key) ? key : null;
  if (!id) {
    const s = await env.DATA.get(`data/slug/${key.toLowerCase()}.json`);
    if (s) id = ((await s.json()) as { id: string }).id;
  }
  if (id) {
    const m = await env.DATA.get(`data/m/${id}.json`);
    if (m) return (await m.json()) as ModFile;
  }
  // Not precomputed (under the download threshold): look it up on Modrinth.
  const p = await fetch(`https://api.modrinth.com/v2/project/${encodeURIComponent(key)}`, { headers: { 'user-agent': UA } });
  if (!p.ok) return null;
  const raw = (await p.json()) as ModProject & { environment?: string[] | string };
  const v = await fetch(`https://api.modrinth.com/v2/project/${raw.id}/version?include_changelog=false`, { headers: { 'user-agent': UA } });
  const versions = v.ok ? ((await v.json()) as ModVersion[]) : [];
  const project: ModProject = { ...raw, environment: typeof raw.environment === 'string' ? [raw.environment] : raw.environment };
  return deriveModFile(project, versions);
}

export async function badge(req: Request, url: URL, env: Env, ctx: ExecutionContext): Promise<Response> {
  const key = decodeURIComponent(url.pathname.slice('/badge/'.length)).replace(/\.svg$/i, '');
  if (!/^[A-Za-z0-9_.-]{1,64}$/.test(key)) return new Response('Bad mod id', { status: 400 });

  // Anonymous adoption count: which mod's badge, and the embedding site (host only).
  const referer = req.headers.get('referer');
  let host = '';
  try {
    host = referer ? new URL(referer).host : '';
  } catch {
    // ignore malformed referers
  }
  ctx.waitUntil(Promise.resolve(env.CLICKS?.writeDataPoint({ blobs: ['badge', key.toLowerCase(), host], indexes: ['badge'] })));

  const cache = caches.default;
  const cacheKey = new Request(url.toString(), { method: 'GET' });
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  const src = await targetSource(env);
  const loaderParam = url.searchParams.get('loader')?.toLowerCase() as Loader | undefined;
  const loader = loaderParam && LOADERS.includes(loaderParam) ? loaderParam : undefined;

  let label = 'mcmodsready';
  let status: Status = 'unknown';
  let title = 'Mod readiness';
  if (src) {
    const v = url.searchParams.get('v');
    const t = (v && (parseTarget(`d:${v}`, src) ?? parseTarget(`v:${v}`, src))) || parseTarget(defaultTarget(src), src)!;
    const id = t.kind === 'drop' ? t.drop.id : t.version.id;
    label = `MC ${id}${loader ? ` · ${LOADER_NAME[loader]}` : ''}`;
    const mod = await loadMod(env, key);
    if (mod) {
      const loaders = loader ? [loader] : (Object.keys(mod.loaders) as Loader[]);
      status = loaders.length ? bestStatus(loaders.map((l) => cellAt(mod, l, t, src).status)) : 'not_applicable';
      title = `${mod.title}: ${BADGE_STATUS[status].text} for Minecraft ${id}${loader ? ` (${LOADER_NAME[loader]})` : ''}`;
    } else {
      title = `Mod "${key}" not found on Modrinth`;
    }
  }

  const s = BADGE_STATUS[status];
  const res = new Response(badgeSvg({ label, message: s.text, color: s.color, title }), {
    headers: {
      'content-type': 'image/svg+xml; charset=utf-8',
      'cache-control': `public, max-age=${TTL}`,
      'access-control-allow-origin': '*',
    },
  });
  ctx.waitUntil(cache.put(cacheKey, res.clone()));
  return res;
}
