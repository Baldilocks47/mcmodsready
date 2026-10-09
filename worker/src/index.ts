// Cloudflare Worker: serves the static site (dist/ via the ASSETS binding) plus the dynamic bits.
//  - cron (every 10 min): watch the Mojang manifest; trigger the GitHub data pipeline on a new
//    version, and every 30 min during the 48h after a release ("release-day mode").
//  - GET /data/*: serve pipeline output from R2 with short cache times.
//  - GET /go/<partner>: cookie-free affiliate redirect with an anonymous click count.

export interface Env {
  ASSETS: Fetcher;
  DATA: R2Bucket;
  STATE: KVNamespace;
  CLICKS?: AnalyticsEngineDataset;
  /** fine-grained PAT with "Actions: write" (or "Contents: write") on the repo */
  GITHUB_TOKEN: string;
  /** "owner/repo" */
  GITHUB_REPO: string;
  /** JSON map of partner -> URL, e.g. {"host":"https://partner.example/?ref=abc"} */
  AFFILIATES: string;
}

const MANIFEST = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
const RELEASE_WINDOW_MS = 48 * 3600_000;
const RELEASE_REFRESH_MS = 30 * 60_000;

interface State {
  release: string;
  snapshot: string;
  releaseTime: string;
  lastRefresh: number;
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname.startsWith('/data/')) return serveData(req, url, env);
    if (url.pathname.startsWith('/go/')) return redirect(url, env, ctx);
    return env.ASSETS.fetch(req);
  },

  async scheduled(_c: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(checkManifest(env));
  },
};

async function serveData(req: Request, url: URL, env: Env): Promise<Response> {
  const key = url.pathname.slice(1); // "data/meta.json"
  if (!/^data\/[a-z0-9._/-]+\.json$/i.test(key) || key.includes('..')) return new Response('Bad path', { status: 400 });
  const obj = await env.DATA.get(key);
  // Before the first pipeline publish, fall back to any data bundled with the site.
  if (!obj) return env.ASSETS.fetch(req);
  const headers = new Headers({
    'content-type': 'application/json; charset=utf-8',
    // meta/stats/feed change often on release day; project files less so
    'cache-control': key.includes('/projects/') ? 'public, max-age=900' : 'public, max-age=120',
    etag: obj.httpEtag,
  });
  return new Response(obj.body, { headers });
}

async function redirect(url: URL, env: Env, ctx: ExecutionContext): Promise<Response> {
  const partner = url.pathname.split('/')[2] ?? '';
  let map: Record<string, string> = {};
  try {
    map = JSON.parse(env.AFFILIATES || '{}');
  } catch {
    // misconfigured: fall through to home
  }
  const target = map[partner];
  if (!target) return Response.redirect(new URL('/', url).toString(), 302);
  // Anonymous count only: partner name and the page it came from. No IPs, no cookies.
  ctx.waitUntil(
    Promise.resolve(env.CLICKS?.writeDataPoint({ blobs: [partner, url.searchParams.get('from') ?? ''], indexes: [partner] })),
  );
  return new Response(null, { status: 302, headers: { location: target, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' } });
}

export async function checkManifest(env: Env): Promise<void> {
  const res = await fetch(MANIFEST, { cf: { cacheTtl: 60 } });
  if (!res.ok) throw new Error(`manifest ${res.status}`);
  const m = (await res.json()) as { latest: { release: string; snapshot: string }; versions: { id: string; releaseTime: string }[] };
  const releaseTime = m.versions.find((v) => v.id === m.latest.release)?.releaseTime ?? '';
  const prev = await env.STATE.get<State>('manifest', 'json');
  const now = Date.now();

  let reason: string | null = null;
  if (!prev) reason = 'init';
  else if (prev.release !== m.latest.release) reason = `new-release:${m.latest.release}`;
  else if (prev.snapshot !== m.latest.snapshot) reason = `new-snapshot:${m.latest.snapshot}`;
  else if (now - Date.parse(releaseTime) < RELEASE_WINDOW_MS && now - prev.lastRefresh >= RELEASE_REFRESH_MS) reason = 'release-day';

  const next: State = { release: m.latest.release, snapshot: m.latest.snapshot, releaseTime, lastRefresh: prev?.lastRefresh ?? 0 };
  if (reason) {
    await dispatch(env, reason);
    next.lastRefresh = now;
  }
  await env.STATE.put('manifest', JSON.stringify(next));
}

async function dispatch(env: Env, reason: string): Promise<void> {
  const res = await fetch(`https://api.github.com/repos/${env.GITHUB_REPO}/dispatches`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.GITHUB_TOKEN}`,
      accept: 'application/vnd.github+json',
      'user-agent': 'mcmodsready-worker',
    },
    // a new release or snapshot adds a column, so the site is rebuilt too
    body: JSON.stringify({ event_type: 'refresh-data', client_payload: { reason, rebuild: !reason.startsWith('release-day') } }),
  });
  if (!res.ok) throw new Error(`GitHub dispatch ${res.status}: ${await res.text()}`);
}
