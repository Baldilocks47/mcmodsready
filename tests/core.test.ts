import { describe, expect, it } from 'vitest';
import { alternativesFor, SimilarityIndex, sideCompatible, type AltCandidate } from '../src/lib/core/alternatives';
import { listReadiness, type ListItem } from '../src/lib/core/readiness';
import { cellFor, envOf, lagDays, median } from '../src/lib/core/status';
import type { ModVersion } from '../src/lib/core/types';
import { buildDrops, dropOf } from '../src/lib/core/versions';

const manifest = [
  { id: '1.21.11', type: 'release', releaseTime: '2025-12-09T00:00:00Z' },
  { id: '26.1-snapshot-1', type: 'snapshot', releaseTime: '2026-01-10T00:00:00Z' },
  { id: '26.1', type: 'release', releaseTime: '2026-03-24T00:00:00Z' },
  { id: '26.1.1', type: 'release', releaseTime: '2026-04-01T00:00:00Z' },
  { id: '26.2', type: 'release', releaseTime: '2026-06-16T00:00:00Z' },
  { id: '26.3-rc-1', type: 'snapshot', releaseTime: '2026-09-10T00:00:00Z' },
  { id: '26.3', type: 'release', releaseTime: '2026-09-15T00:00:00Z' },
  { id: '26.4-snapshot-1', type: 'snapshot', releaseTime: '2026-09-22T00:00:00Z' },
];
const drops = buildDrops(manifest);
const drop = (id: string) => drops.find((d) => d.id === id)!;

function v(game: string[], type: ModVersion['version_type'] = 'release', date = '2026-09-16T00:00:00Z', loaders = ['fabric']): ModVersion {
  return { id: Math.random().toString(36), project_id: 'p', version_number: '1', game_versions: game, loaders, version_type: type, date_published: date, dependencies: [] };
}
const project = { loaders: ['fabric'], updated: '2026-09-20T00:00:00Z' };
const NOW = Date.parse('2026-10-09T00:00:00Z');

describe('versions', () => {
  it('groups year-based versions into drops and ignores 1.x', () => {
    expect(dropOf('26.1.2')).toBe('26.1');
    expect(dropOf('26.3-rc-1')).toBe('26.3');
    expect(dropOf('1.21.11')).toBeNull();
    expect(drops.map((d) => d.id)).toEqual(['26.4', '26.3', '26.2', '26.1']);
    expect(drop('26.1').patches).toEqual(['26.1', '26.1.1']);
    expect(drop('26.4').upcoming).toBe(true);
    expect(drop('26.3').releasedAt).toBe('2026-09-15T00:00:00Z');
  });
});

describe('cellFor', () => {
  const latest = drops.filter((d) => !d.upcoming).slice(0, 2);
  const cell = (vs: ModVersion[], d: string, p = project) => cellFor(p, vs, 'fabric', drop(d), latest, NOW);

  it('ready when a release build targets any patch in the drop', () => {
    const c = cell([v(['26.1.1'])], '26.1');
    expect(c.status).toBe('ready');
    expect(c.patches).toEqual(['26.1.1']);
  });
  it('prerelease when only beta/alpha builds exist', () => {
    expect(cell([v(['26.3'], 'beta')], '26.3').status).toBe('prerelease');
  });
  it('rc-tagged builds do not count as ready for the release', () => {
    expect(cell([v(['26.3-rc-1'])], '26.3').status).toBe('not_yet');
  });
  it('snapshot status for upcoming drops', () => {
    expect(cell([v(['26.4-snapshot-1'], 'alpha')], '26.4').status).toBe('snapshot');
    expect(cell([v(['26.3'])], '26.4').status).toBe('not_yet');
  });
  it('not applicable when the loader is unsupported', () => {
    expect(cellFor(project, [v(['26.3'], 'release', undefined, ['neoforge'])], 'neoforge', drop('26.3'), latest, NOW).status).toBe('not_applicable');
    expect(cell([v(['26.3'], 'release', undefined, ['neoforge'])], '26.3').status).toBe('not_applicable');
  });
  it('dropped when idle for a year and absent from recent drops', () => {
    const old = { loaders: ['fabric'], updated: '2025-01-01T00:00:00Z' };
    expect(cell([v(['1.21.4'])], '26.3', old).status).toBe('dropped');
  });
  it('lag counts days from release, clamping early builds to 0', () => {
    expect(lagDays([v(['26.3'], 'release', '2026-09-20T12:00:00Z')], drop('26.3'))).toBe(5);
    expect(lagDays([v(['26.3'], 'release', '2026-09-01T00:00:00Z')], drop('26.3'))).toBe(0);
  });
});

describe('envOf', () => {
  it('prefers the environment field', () => {
    expect(envOf({ client_side: 'required', server_side: 'required', environment: ['client_only'] })).toBe('client');
  });
  it('falls back to side flags', () => {
    expect(envOf({ client_side: 'required', server_side: 'unsupported' })).toBe('client');
    expect(envOf({ client_side: 'unsupported', server_side: 'required' })).toBe('server');
    expect(envOf({ client_side: 'required', server_side: 'required' })).toBe('both');
    expect(envOf({ client_side: 'optional', server_side: 'optional' })).toBe('either');
    expect(envOf({ client_side: 'unknown', server_side: 'required' })).toBe('unknown');
  });
});

describe('listReadiness', () => {
  const item = (slug: string, env: ListItem['env'], status: ListItem['status']): ListItem => ({ slug, title: slug, env, status });

  it('computes server / client / both independently', () => {
    const r = listReadiness([
      item('sodium', 'client', 'not_yet'),
      item('lithium', 'either', 'not_yet'),
      item('carpet', 'server', 'ready'),
      item('fabric-api', 'both', 'ready'),
    ]);
    expect(r.server).toEqual({ ready: 2, total: 3, ok: false });
    expect(r.client).toEqual({ ready: 1, total: 3, ok: false });
    expect(r.both.ok).toBe(false);
    expect(r.blockers.map((b) => [b.slug, b.sides, b.optional])).toEqual([
      ['sodium', ['client'], false],
      ['lithium', ['server', 'client'], true],
    ]);
  });
  it('treats unknown env as both and flags it', () => {
    const r = listReadiness([item('mystery', 'unknown', 'not_yet')]);
    expect(r.server.ok).toBe(false);
    expect(r.client.ok).toBe(false);
    expect(r.blockers[0].envUnknown).toBe(true);
  });
  it('can accept prerelease builds', () => {
    const r = listReadiness([item('jei', 'both', 'prerelease')], { acceptPrerelease: true });
    expect(r.both.ok).toBe(true);
  });
  it('20-mod list: everything ready means ready everywhere', () => {
    const items = Array.from({ length: 20 }, (_, i) => item(`m${i}`, (['client', 'server', 'both', 'either'] as const)[i % 4], 'ready'));
    const r = listReadiness(items);
    expect(r.both.ok).toBe(true);
    expect(r.server.total).toBe(15);
    expect(r.client.total).toBe(15);
  });
});

describe('alternatives', () => {
  const base = { downloads: 1000, updated: '2026-09-01T00:00:00Z', env: 'client' as const };
  const cands: AltCandidate[] = [
    { ...base, slug: 'minimap-a', title: 'Minimap A', description: 'A minimap and world map with waypoints', categories: ['utility', 'adventure'], ready: false },
    { ...base, slug: 'minimap-b', title: 'Minimap B', description: 'Lightweight minimap showing waypoints and world map', categories: ['utility', 'adventure'], ready: true },
    { ...base, slug: 'zoom', title: 'Zoom', description: 'Zoom in like a spyglass', categories: ['utility'], ready: true },
    { ...base, slug: 'server-map', title: 'Server Map', description: 'Web world map with waypoints for servers', categories: ['utility', 'adventure'], env: 'server', ready: true },
    { ...base, slug: 'lib', title: 'Lib', description: 'minimap waypoints world map library', categories: ['library', 'adventure'], ready: true },
  ];
  const index = new SimilarityIndex(cands);

  it('suggests similar, side-compatible, ready mods and never libraries', () => {
    const alts = alternativesFor(cands[0], cands, index, [], 3, NOW);
    expect(alts.map((a) => a.slug)).toEqual(['minimap-b']);
  });
  it('curated overrides win and suppress guesses', () => {
    const alts = alternativesFor(cands[0], cands, index, [{ slug: 'zoom', note: 'test' }], 3, NOW);
    expect(alts).toEqual([{ slug: 'zoom', title: 'Zoom', score: Infinity, curated: true, note: 'test' }]);
  });
  it('libraries get no algorithmic alternatives', () => {
    expect(alternativesFor(cands[4], cands, index, [], 3, NOW)).toEqual([]);
  });
  it('side compatibility', () => {
    expect(sideCompatible('both', 'client')).toBe(false);
    expect(sideCompatible('client', 'either')).toBe(true);
    expect(sideCompatible('server', 'unknown')).toBe(false);
  });
});

describe('median', () => {
  it('works for odd, even and empty', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});


describe('guard', async () => {
  const { regressionRatio } = await import('../pipeline/guard');
  const mk = (statuses: string[]) => ({
    loader: 'fabric' as const,
    generatedAt: '',
    drops: ['26.3'],
    mods: statuses.map((s, i) => ({ id: `m${i}`, cells: { '26.3': { status: s } } })),
  });
  it('measures the share of ready cells that regressed', () => {
    // @ts-expect-error partial fixtures
    expect(regressionRatio(mk(['ready', 'ready', 'ready', 'not_yet']), mk(['ready', 'not_yet', 'ready', 'ready']))).toBeCloseTo(1 / 3);
  });
});
