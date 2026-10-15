import { describe, expect, it } from 'vitest';
import { alternativesFor, SimilarityIndex, sideCompatible, type AltCandidate } from '../src/lib/core/alternatives';
import { listReadiness, type ListItem } from '../src/lib/core/readiness';
import { dropCell, envOf, median, versionCell, type StatusContext } from '../src/lib/core/status';
import { deriveSupport, epochDay } from '../src/lib/core/support';
import { cellAt, isUpcoming, parseTarget } from '../src/lib/core/targets';
import type { ModFile, ModVersion } from '../src/lib/core/types';
import { buildDrops, buildGameVersions, dropOf } from '../src/lib/core/versions';

const manifest = [
  { id: '1.20.1', type: 'release', releaseTime: '2023-06-12T00:00:00Z' },
  { id: '23w51a', type: 'snapshot', releaseTime: '2023-12-18T00:00:00Z' },
  { id: '1.21.11', type: 'release', releaseTime: '2025-12-09T00:00:00Z' },
  { id: '26.1-snapshot-1', type: 'snapshot', releaseTime: '2026-01-10T00:00:00Z' },
  { id: '26.1', type: 'release', releaseTime: '2026-03-24T00:00:00Z' },
  { id: '26.1.1', type: 'release', releaseTime: '2026-04-01T00:00:00Z' },
  { id: '26.2', type: 'release', releaseTime: '2026-06-16T00:00:00Z' },
  { id: '26.3-rc-1', type: 'snapshot', releaseTime: '2026-09-10T00:00:00Z' },
  { id: '26.3', type: 'release', releaseTime: '2026-09-15T00:00:00Z' },
  { id: '26.4-snapshot-1', type: 'snapshot', releaseTime: '2026-09-22T00:00:00Z' },
  { id: 'b1.7.3', type: 'old_beta', releaseTime: '2011-07-08T00:00:00Z' },
];
const drops = buildDrops(manifest);
const versions = buildGameVersions(manifest);
const src = { drops, versions };
const drop = (id: string) => drops.find((d) => d.id === id)!;
const gv = (id: string) => versions.find((v) => v.id === id)!;
const NOW = Date.parse('2026-10-09T00:00:00Z');

function v(game: string[], type: ModVersion['version_type'] = 'release', date = '2026-09-16T00:00:00Z', loaders = ['fabric'], deps: ModVersion['dependencies'] = []): ModVersion {
  return { id: Math.random().toString(36), project_id: 'p', version_number: '1', game_versions: game, loaders, version_type: type, date_published: date, dependencies: deps };
}
const ctx = (updated = '2026-09-20T00:00:00Z'): StatusContext => ({ latestDrops: [drop('26.3'), drop('26.2')], currentDrop: '26.3', updated, now: NOW });

describe('versions', () => {
  it('groups year-based versions into drops and ignores 1.x', () => {
    expect(dropOf('26.1.2')).toBe('26.1');
    expect(dropOf('26.3-rc-1')).toBe('26.3');
    expect(dropOf('1.21.11')).toBeNull();
    expect(drops.map((d) => d.id)).toEqual(['26.4', '26.3', '26.2', '26.1']);
    expect(drop('26.1').patches).toEqual(['26.1', '26.1.1']);
    expect(drop('26.4').upcoming).toBe(true);
  });
  it('lists every release and snapshot as a target, newest first, without old betas', () => {
    expect(versions.map((x) => x.id)).toEqual(['26.4-snapshot-1', '26.3', '26.3-rc-1', '26.2', '26.1.1', '26.1', '26.1-snapshot-1', '1.21.11', '23w51a', '1.20.1']);
    expect(gv('23w51a').type).toBe('snapshot');
    expect(gv('26.3-rc-1')).toMatchObject({ type: 'snapshot', drop: '26.3' });
  });
});

describe('deriveSupport', () => {
  it('keeps the best build type and first release day per game version', () => {
    const s = deriveSupport(
      [
        v(['26.3'], 'beta', '2026-09-15T12:00:00Z'),
        v(['26.3'], 'release', '2026-09-20T00:00:00Z'),
        v(['26.3', '26.2'], 'release', '2026-09-18T00:00:00Z'),
        v(['26.3'], 'release', '2026-09-25T00:00:00Z', ['neoforge']),
      ],
      'fabric',
    )!;
    expect(s.v['26.3']).toEqual(['r', epochDay('2026-09-18T00:00:00Z')]);
    expect(s.v['26.2'][0]).toBe('r');
    expect(deriveSupport([v(['26.3'], 'release', undefined, ['neoforge'])], 'fabric')).toBeUndefined();
  });
  it('records required deps of the newest build and every declared incompatibility', () => {
    const s = deriveSupport(
      [
        v(['26.2'], 'release', '2026-06-20T00:00:00Z', ['fabric'], [{ project_id: 'OLDDEP00', dependency_type: 'required' }, { project_id: 'RIVAL001', dependency_type: 'incompatible' }]),
        v(['26.3'], 'release', '2026-09-20T00:00:00Z', ['fabric'], [{ project_id: 'FABRICAP', dependency_type: 'required' }, { project_id: 'OPTION00', dependency_type: 'optional' }]),
      ],
      'fabric',
    )!;
    expect(s.deps).toEqual(['FABRICAP']);
    expect(s.incompat).toEqual(['RIVAL001']);
  });
});

describe('dropCell', () => {
  const s = (vs: ModVersion[]) => deriveSupport(vs, 'fabric');
  it('ready when a release build targets any patch in the drop, with lag', () => {
    const c = dropCell(s([v(['26.1.1'], 'release', '2026-04-03T00:00:00Z')]), drop('26.1'), ctx());
    expect(c).toEqual({ status: 'ready', patches: ['26.1.1'], lagDays: 10 });
  });
  it('lag clamps early builds to 0', () => {
    expect(dropCell(s([v(['26.3'], 'release', '2026-09-01T00:00:00Z')]), drop('26.3'), ctx()).lagDays).toBe(0);
  });
  it('prerelease, snapshot, not yet, not applicable, dropped', () => {
    expect(dropCell(s([v(['26.3'], 'beta')]), drop('26.3'), ctx()).status).toBe('prerelease');
    expect(dropCell(s([v(['26.3-rc-1'])]), drop('26.3'), ctx()).status).toBe('not_yet');
    expect(dropCell(s([v(['26.4-snapshot-1'], 'alpha')]), drop('26.4'), ctx()).status).toBe('snapshot');
    expect(dropCell(undefined, drop('26.3'), ctx()).status).toBe('not_applicable');
    expect(dropCell(s([v(['1.20.1'])]), drop('26.3'), ctx('2025-01-01T00:00:00Z')).status).toBe('dropped');
  });
});

describe('versionCell (exact versions)', () => {
  const s = deriveSupport([v(['1.20.1'], 'release', '2023-07-01T00:00:00Z'), v(['1.21.11'], 'beta'), v(['23w51a'], 'alpha'), v(['26.2'])], 'fabric');
  it('handles legacy releases, betas and old snapshots', () => {
    expect(versionCell(s, gv('1.20.1'), ctx()).status).toBe('ready');
    expect(versionCell(s, gv('1.21.11'), ctx()).status).toBe('prerelease');
    expect(versionCell(s, gv('23w51a'), ctx()).status).toBe('snapshot');
  });
  it('"no build" for old versions, "not yet" for current ones', () => {
    expect(versionCell(s, gv('26.1'), ctx()).status).toBe('no_build');
    expect(versionCell(s, gv('26.3'), ctx()).status).toBe('not_yet');
    expect(versionCell(s, gv('26.4-snapshot-1'), ctx()).status).toBe('not_yet');
  });
});

describe('targets', () => {
  const mod = { updated: '2026-09-20T00:00:00Z', loaders: { fabric: deriveSupport([v(['1.20.1']), v(['26.3'], 'beta')], 'fabric') } } as unknown as ModFile;
  it('parses drop and exact-version keys', () => {
    expect(parseTarget('d:26.3', src)?.kind).toBe('drop');
    expect(parseTarget('v:1.20.1', src)?.kind).toBe('version');
    expect(parseTarget('v:9.9', src)).toBeNull();
  });
  it('computes cells for any target', () => {
    expect(cellAt(mod, 'fabric', parseTarget('v:1.20.1', src)!, src, NOW).status).toBe('ready');
    expect(cellAt(mod, 'fabric', parseTarget('d:26.3', src)!, src, NOW).status).toBe('prerelease');
    expect(cellAt(mod, 'forge', parseTarget('d:26.3', src)!, src, NOW).status).toBe('not_applicable');
  });
  it('knows when "not yet" is normal', () => {
    expect(isUpcoming(parseTarget('d:26.4', src)!, src)).toBe(true);
    expect(isUpcoming(parseTarget('v:26.4-snapshot-1', src)!, src)).toBe(true);
    expect(isUpcoming(parseTarget('v:26.3-rc-1', src)!, src)).toBe(false);
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
    const r = listReadiness([item('sodium', 'client', 'not_yet'), item('lithium', 'either', 'not_yet'), item('carpet', 'server', 'ready'), item('fabric-api', 'both', 'ready')]);
    expect(r.server).toEqual({ ready: 2, total: 3, ok: false });
    expect(r.client).toEqual({ ready: 1, total: 3, ok: false });
    expect(r.all).toEqual({ ready: 2, total: 4, ok: false });
    // groups: where each mod is installed (sodium = client-only, carpet = server-only, lithium + fabric-api = both)
    expect(r.groups.client).toEqual({ ready: 0, total: 1, ok: false });
    expect(r.groups.server).toEqual({ ready: 1, total: 1, ok: true });
    expect(r.groups.both).toEqual({ ready: 1, total: 2, ok: false });
    expect(r.blockers.map((b) => b.group)).toEqual(['client', 'both']);
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
    expect(listReadiness([item('jei', 'both', 'prerelease')], { acceptPrerelease: true }).all.ok).toBe(true);
  });
  it('20-mod list: everything ready means ready everywhere', () => {
    const items = Array.from({ length: 20 }, (_, i) => item(`m${i}`, (['client', 'server', 'both', 'either'] as const)[i % 4], 'ready'));
    const r = listReadiness(items);
    expect(r.all.ok).toBe(true);
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
    { ...base, slug: 'renderer', title: 'Fast Renderer', description: 'Rendering chunks sooner with smarter caching of terrain meshes and shaders', categories: ['optimization'], ready: true },
    { ...base, slug: 'renderer-x', title: 'Render X', description: 'Rendering engine replacement for frame rates', categories: ['optimization'], ready: false },
  ];
  const index = new SimilarityIndex(cands);

  it('suggests similar, side-compatible, ready mods and never libraries', () => {
    expect(alternativesFor(cands[0], cands, index, undefined, 3, NOW).map((a) => a.slug)).toEqual(['minimap-b']);
  });
  it('curated overrides win and suppress guesses', () => {
    expect(alternativesFor(cands[0], cands, index, [{ slug: 'zoom', note: 'test' }], 3, NOW)).toEqual([{ slug: 'zoom', title: 'Zoom', score: Infinity, curated: true, note: 'test' }]);
  });
  it('libraries get no algorithmic alternatives', () => {
    expect(alternativesFor(cands[4], cands, index, undefined, 3, NOW)).toEqual([]);
  });
  it('declared incompatibilities (rivals) count as strong evidence', () => {
    expect(alternativesFor(cands[6], cands, index, undefined, 3, NOW).map((a) => a.slug)).not.toContain('renderer');
    expect(alternativesFor(cands[6], cands, index, undefined, 3, NOW, new Set(['renderer'])).map((a) => a.slug)).toContain('renderer');
  });
  it('finds textual neighbours', () => {
    expect(index.neighbours('minimap-a', 3)[0]).toBe('minimap-b');
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

describe('stage-changed', async () => {
  const { stage } = await import('../pipeline/stage-changed');
  const { mkdtemp, mkdir, writeFile, readFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  it('stages only new/changed files and lists deletions', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mmr-'));
    const out = join(root, 'out');
    await mkdir(join(out, 'm'), { recursive: true });
    await writeFile(join(out, 'a.json'), '1');
    await writeFile(join(out, 'm', 'b.json'), '2');
    const manifest = join(root, 'manifest.json');
    expect(await stage(out, join(root, 'stage'), manifest)).toEqual({ total: 2, changed: 2, deleted: 0 });
    await writeFile(join(out, 'a.json'), '1b');
    await rm(join(out, 'm', 'b.json'));
    expect(await stage(out, join(root, 'stage'), manifest)).toEqual({ total: 1, changed: 1, deleted: 1 });
    expect((await readFile(join(root, 'deleted.txt'), 'utf8')).trim()).toBe('m/b.json');
    await rm(root, { recursive: true, force: true });
  });
});

describe('regressions', () => {
  it('envOf combines multiple environment values (Create: both + server-only)', () => {
    expect(envOf({ client_side: 'optional', server_side: 'required', environment: ['client_and_server', 'server_only_client_optional'] })).toBe('both');
    expect(envOf({ client_side: 'optional', server_side: 'optional', environment: ['client_or_server', 'client_only'] })).toBe('client');
  });
  it('required libraries depend on the target version (JEI needs MezzConfig only on 26.3)', async () => {
    const { depsAt } = await import('../src/lib/core/targets');
    const s = deriveSupport(
      [
        v(['1.20.1'], 'release', '2023-07-01T00:00:00Z', ['fabric'], [{ project_id: 'FABRICAP', dependency_type: 'required' }]),
        v(['26.3'], 'release', '2026-09-20T00:00:00Z', ['fabric'], [
          { project_id: 'FABRICAP', dependency_type: 'required' },
          { project_id: 'MEZZCONF', dependency_type: 'required' },
        ]),
      ],
      'fabric',
    )!;
    const mod = { updated: '2026-09-20T00:00:00Z', loaders: { fabric: s } } as unknown as ModFile;
    expect(depsAt(mod, 'fabric', parseTarget('d:26.3', src)!)).toEqual(['FABRICAP', 'MEZZCONF']);
    expect(depsAt(mod, 'fabric', parseTarget('v:1.20.1', src)!)).toEqual(['FABRICAP']);
  });
});

describe('past drops', () => {
  it('"no build" for an older drop the mod skipped, "not yet" only for the current one', () => {
    const s = deriveSupport([v(['26.3'])], 'fabric');
    expect(dropCell(s, drop('26.2'), ctx()).status).toBe('no_build');
    expect(dropCell(deriveSupport([v(['1.20.1'])], 'fabric'), drop('26.3'), ctx()).status).toBe('not_yet');
  });
});

describe('thin descriptions', () => {
  it('skips guessed alternatives when there is too little text, but keeps rivals', () => {
    const base = { downloads: 1000, updated: '2026-09-01T00:00:00Z', env: 'both' as const, categories: ['technology'] };
    const c: AltCandidate[] = [
      { ...base, slug: 'create', title: 'Create', description: 'Aesthetic Technology that empowers the Player', ready: false },
      { ...base, slug: 'citymod', title: 'City Mod', description: 'Aesthetic technology blocks for the player city', ready: true },
    ];
    const idx = new SimilarityIndex(c);
    expect(alternativesFor(c[0], c, idx, undefined, 3, NOW)).toEqual([]);
    expect(alternativesFor(c[0], c, idx, undefined, 3, NOW, new Set(['citymod'])).map((a) => a.slug)).toEqual(['citymod']);
  });
});

describe('curated "no replacement"', () => {
  it('an empty curated list suppresses guesses', () => {
    const base = { downloads: 1000, updated: '2026-09-01T00:00:00Z', env: 'client' as const, categories: ['utility'] };
    const c: AltCandidate[] = [
      { ...base, slug: 'a', title: 'Map A', description: 'minimap waypoints world map overlay radar', ready: false },
      { ...base, slug: 'b', title: 'Map B', description: 'minimap waypoints world map overlay compass', ready: true },
    ];
    const idx = new SimilarityIndex(c);
    expect(alternativesFor(c[0], c, idx, undefined, 3, NOW).length).toBe(1);
    expect(alternativesFor(c[0], c, idx, [], 3, NOW)).toEqual([]);
  });
});

describe('badges', async () => {
  const { badgeSvg, bestStatus, textWidth, BADGE_STATUS } = await import('../src/lib/core/badge');
  it('picks the best status across loaders', () => {
    expect(bestStatus(['not_yet', 'ready', 'prerelease'])).toBe('ready');
    expect(bestStatus(['no_build', 'prerelease'])).toBe('prerelease');
    expect(bestStatus([])).toBe('unknown');
  });
  it('sizes text roughly like Verdana 11px', () => {
    expect(textWidth('ready')).toBeGreaterThan(25);
    expect(textWidth('ready')).toBeLessThan(40);
    expect(textWidth('MC 26.3 · NeoForge')).toBeGreaterThan(textWidth('MC 26.3'));
  });
  it('renders accessible, escaped SVG', () => {
    const svg = badgeSvg({ label: 'MC 26.3', message: BADGE_STATUS.ready.text, color: BADGE_STATUS.ready.color, title: 'A <b> & "c"' });
    expect(svg).toContain('role="img"');
    expect(svg).toContain('<title>A &lt;b&gt; &amp; &quot;c&quot;</title>');
    expect(svg).toContain('>ready<');
    expect(svg).not.toContain('<b>');
  });
});
