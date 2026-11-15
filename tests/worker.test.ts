// Release-day behaviour of the Worker cron, which can't be exercised for real until a drop ships.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker, { checkManifest, type Env } from '../worker/src/index';
import geckolib from './fixtures/data/m/8BmcQJ2H.json';
import meta from './fixtures/data/meta.json';

const HOUR = 3600_000;
const NOW = Date.parse('2026-12-15T12:00:00Z');
const OLD = new Date(NOW - 30 * 24 * HOUR).toISOString();
const manifest = (release: string, snapshot: string, releaseTime: string) => ({
  latest: { release, snapshot },
  versions: [{ id: release, releaseTime }],
});

function setup(m: ReturnType<typeof manifest>, state: unknown, uploaded = NOW - HOUR) {
  const dispatches: { reason: string; rebuild: boolean }[] = [];
  const store = new Map<string, string>(state ? [['manifest', JSON.stringify(state)]] : []);
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    if (String(url).includes('api.github.com')) {
      dispatches.push(JSON.parse(String(init!.body)).client_payload);
      return new Response(null, { status: 204 });
    }
    return Response.json(m);
  });
  const env = {
    GITHUB_REPO: 'o/r',
    GITHUB_TOKEN: 't',
    DATA: { head: async () => ({ uploaded: new Date(uploaded) }) },
    STATE: {
      get: async (k: string) => (store.has(k) ? JSON.parse(store.get(k)!) : null),
      put: async (k: string, v: string) => void store.set(k, v),
    },
  } as unknown as Env;
  return { env, dispatches, saved: () => JSON.parse(store.get('manifest')!) };
}

describe('manifest cron', () => {
  beforeEach(() => void vi.useFakeTimers({ now: NOW }));
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
  const prev = (over = {}) => ({ release: '26.3', snapshot: '26.4-snapshot-6', releaseTime: OLD, lastRefresh: NOW - 24 * HOUR, lastNightly: '2026-12-15', ...over });

  it('does nothing on a quiet day', async () => {
    const t = setup(manifest('26.3', '26.4-snapshot-6', OLD), prev());
    await checkManifest(t.env);
    expect(t.dispatches).toEqual([]);
  });

  it('a new snapshot refreshes and rebuilds', async () => {
    const t = setup(manifest('26.3', '26.4-snapshot-7', OLD), prev());
    await checkManifest(t.env);
    expect(t.dispatches).toEqual([{ reason: 'new-snapshot:26.4-snapshot-7', rebuild: true }]);
  });

  it('a new release refreshes and rebuilds immediately', async () => {
    const t = setup(manifest('26.4', '26.4', new Date(NOW - HOUR / 6).toISOString()), prev());
    await checkManifest(t.env);
    expect(t.dispatches).toEqual([{ reason: 'new-release:26.4', rebuild: true }]);
    expect(t.saved().lastRefresh).toBe(NOW);
  });

  it('in the 48h after release: data-only refresh every 30 minutes, not more often', async () => {
    const out = new Date(NOW - 5 * HOUR).toISOString();
    const state = (lastRefresh: number) => prev({ release: '26.4', snapshot: '26.4', releaseTime: out, lastRefresh });
    const due = setup(manifest('26.4', '26.4', out), state(NOW - HOUR));
    await checkManifest(due.env);
    expect(due.dispatches).toEqual([{ reason: 'release-day', rebuild: false }]);

    const early = setup(manifest('26.4', '26.4', out), state(NOW - HOUR / 6));
    await checkManifest(early.env);
    expect(early.dispatches).toEqual([]);
  });

  it('stops fast refreshes after 48h', async () => {
    const out = new Date(NOW - 49 * HOUR).toISOString();
    const t = setup(manifest('26.4', '26.4', out), prev({ release: '26.4', snapshot: '26.4', releaseTime: out, lastRefresh: NOW - HOUR }));
    await checkManifest(t.env);
    expect(t.dispatches).toEqual([]);
  });

  it('starts the nightly refresh once a day, from 03:00 UTC', async () => {
    const t = setup(manifest('26.3', '26.4-snapshot-6', OLD), prev({ lastNightly: '2026-12-14' }));
    await checkManifest(t.env);
    expect(t.dispatches).toEqual([{ reason: 'nightly', rebuild: true }]);
    expect(t.saved().lastNightly).toBe('2026-12-15');

    vi.setSystemTime(Date.parse('2026-12-16T02:50:00Z'));
    const early = setup(manifest('26.3', '26.4-snapshot-6', OLD), prev());
    await checkManifest(early.env);
    expect(early.dispatches).toEqual([]);
  });

  it('triggers a backstop refresh when published data is stale, at most every 6h', async () => {
    const stale = NOW - 30 * HOUR;
    const t = setup(manifest('26.3', '26.4-snapshot-6', OLD), prev(), stale);
    await checkManifest(t.env);
    expect(t.dispatches).toEqual([{ reason: 'backstop', rebuild: true }]);
    expect(t.saved().lastBackstop).toBe(NOW);

    const again = setup(manifest('26.3', '26.4-snapshot-6', OLD), prev({ lastBackstop: NOW - HOUR }), stale);
    await checkManifest(again.env);
    expect(again.dispatches).toEqual([]);
  });

  it('a failed GitHub call keeps the old state so the next cron retries', async () => {
    const t = setup(manifest('26.4', '26.4', OLD), prev());
    vi.stubGlobal('fetch', async (url: string) =>
      String(url).includes('api.github.com') ? new Response('nope', { status: 500 }) : Response.json(manifest('26.4', '26.4', OLD)),
    );
    await expect(checkManifest(t.env)).rejects.toThrow();
    expect(t.saved().release).toBe('26.3');
  });
});

describe('/data route', () => {
  const env = { DATA: { get: async () => ({ body: 'x', httpEtag: '"e"' }) }, ASSETS: { fetch: async () => new Response('asset') } } as unknown as Env;
  const get = (path: string) => worker.fetch(new Request('https://mcmodsready.com' + path), env, {} as never);

  it('serves JSON and icons with the right types, and refuses anything else', async () => {
    expect((await get('/data/meta.json')).headers.get('content-type')).toContain('application/json');
    expect((await get('/data/i/AANobbMI.webp')).headers.get('content-type')).toBe('image/webp');
    expect((await get('/data/secret.txt')).status).toBe(400);
    expect((await get('/data/..%2Fx.json')).status).toBe(400);
  });

  it('answers 304 when the browser copy is still current', async () => {
    // R2 returns the object without a body when the If-None-Match check fails
    const unchanged = { DATA: { get: async () => ({ httpEtag: '"e"' }) } } as unknown as Env;
    const res = await worker.fetch(new Request('https://mcmodsready.com/data/meta.json', { headers: { 'if-none-match': '"e"' } }), unchanged, {} as never);
    expect(res.status).toBe(304);
    expect(res.headers.get('etag')).toBe('"e"');
  });
});

describe('/badge route', () => {
  afterEach(() => vi.unstubAllGlobals());
  const files: Record<string, unknown> = { 'data/meta.json': meta, 'data/slug/geckolib.json': { id: geckolib.id }, [`data/m/${geckolib.id}.json`]: geckolib };

  it('finds a tracked mod whose slug looks like an id, and ignores stray query parameters when caching', async () => {
    const reads: string[] = [];
    const stored = new Map<string, Response>();
    vi.stubGlobal('caches', { default: { match: async (r: Request) => stored.get(r.url)?.clone(), put: async (r: Request, res: Response) => void stored.set(r.url, res) } });
    vi.stubGlobal('fetch', async () => {
      throw new Error('a tracked mod should not be looked up on Modrinth');
    });
    const env = {
      DATA: {
        get: async (key: string) => {
          reads.push(key);
          // "geckolib" is 8 characters, like a project id, but there is no m/geckolib.json
          return files[key] ? { json: async () => files[key] } : null;
        },
      },
    } as unknown as Env;
    const pending: Promise<unknown>[] = [];
    const ctx = { waitUntil: (p: Promise<unknown>) => void pending.push(p) } as never;
    const get = (q: string) => worker.fetch(new Request('https://mcmodsready.com/badge/geckolib.svg' + q), env, ctx);

    const first = await get('?utm_source=a');
    expect(await first.text()).toContain('Geckolib: ');
    await Promise.all(pending);
    const before = reads.length;
    expect((await get('?utm_source=b')).status).toBe(200);
    expect(reads.length).toBe(before);
    expect([...stored.keys()]).toEqual(['https://mcmodsready.com/badge/geckolib.svg']);
  });
});
