// Release-day behaviour of the Worker cron, which can't be exercised for real until a drop ships.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkManifest, type Env } from '../worker/src/index';

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
  const prev = (over = {}) => ({ release: '26.3', snapshot: '26.4-snapshot-6', releaseTime: OLD, lastRefresh: NOW - 24 * HOUR, ...over });

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
