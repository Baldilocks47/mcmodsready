<script lang="ts">
  import { onMount } from 'svelte';
  import type { Cell, Drop, GameVersion, Loader, Status } from '../lib/core/types';
  import type { MatrixFile, MatrixMod } from '../lib/data-schema';
  import { loadMatrix, loadShard } from '../lib/ui/data';
  import { ENV, LOADER_LABEL, STATUS, fmtDownloads } from '../lib/ui/status';
  import Chip from './Chip.svelte';

  let {
    drops,
    versions,
    loaders,
    popularLegacy,
  }: { drops: Drop[]; versions: GameVersion[]; loaders: Loader[]; popularLegacy: Record<Loader, string[]> } = $props();

  let loader = $state<Loader>('fabric');
  let data = $state<MatrixFile | null>(null);
  let error = $state('');
  let query = $state('');
  let sort = $state<'downloads' | 'lag' | 'name'>('downloads');
  let focusDrop = $state(drops.find((d) => !d.upcoming)!.id);
  let onlyBlocked = $state(false);
  let limit = $state(100);
  /** extra exact-version columns, e.g. ["1.21.1", "1.20.1"] */
  let extra = $state<string[]>([]);
  let shards = $state<Record<string, Record<string, 'r' | 'b' | 'a'>>>({});
  let adding = $state('');

  const released = drops.filter((d) => !d.upcoming);
  const currentDrop = released[0].id;
  const byId = new Map(versions.map((v) => [v.id, v]));

  onMount(() => {
    const p = new URLSearchParams(location.search);
    const l = p.get('loader');
    if (l && loaders.includes(l as Loader)) loader = l as Loader;
    query = p.get('q') ?? '';
    extra = (p.get('cols') ?? '').split(',').filter((v) => byId.has(v)).slice(0, 6);
  });

  $effect(() => {
    const l = loader;
    data = null;
    error = '';
    loadMatrix(l)
      .then((m) => {
        if (l === loader) data = m;
      })
      .catch((e) => (error = String(e)));
  });

  $effect(() => {
    const l = loader;
    for (const v of extra) {
      const key = `${l}/${v}`;
      if (shards[key]) continue;
      loadShard(l, v).then((s) => (shards = { ...shards, [key]: s }));
    }
    const url = new URL(location.href);
    url.searchParams.set('loader', l);
    if (extra.length) url.searchParams.set('cols', extra.join(','));
    else url.searchParams.delete('cols');
    history.replaceState(null, '', url);
  });

  function extraCell(m: MatrixMod, v: string): Cell {
    const s = shards[`${loader}/${v}`];
    if (!s) return { status: 'unknown' };
    const gv = byId.get(v)!;
    const e = s[m.id];
    if (e) return { status: gv.type === 'snapshot' ? 'snapshot' : e === 'r' ? 'ready' : 'prerelease', patches: [v] };
    const current = gv.drop != null && gv.drop.localeCompare(currentDrop, undefined, { numeric: true }) >= 0;
    return { status: current ? 'not_yet' : 'no_build' };
  }

  function addColumn() {
    if (adding && !extra.includes(adding)) extra = [...extra, adding];
    adding = '';
  }

  const legacyOptions = $derived([
    ...popularLegacy[loader].map((id) => ({ id, popular: true })),
    ...versions.filter((v) => !popularLegacy[loader].includes(v.id) && !drops.some((d) => d.patches.includes(v.id))).map((v) => ({ id: v.id, popular: false })),
  ]);

  const rows = $derived.by(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    let r = data.mods;
    if (q) r = r.filter((m) => m.title.toLowerCase().includes(q) || m.slug.includes(q));
    if (onlyBlocked) r = r.filter((m) => !['ready', 'not_applicable'].includes(m.cells[focusDrop].status));
    const lag = (m: MatrixMod) => m.cells[focusDrop].lagDays ?? Infinity;
    if (sort === 'name') r = [...r].sort((a, b) => a.title.localeCompare(b.title));
    if (sort === 'lag') r = [...r].sort((a, b) => lag(a) - lag(b) || b.downloads - a.downloads);
    return r;
  });

  function cellTitle(c: Cell, label: string, upcoming: boolean): string {
    const parts = [STATUS[c.status as Status].hint];
    if (c.patches?.length) parts.push(`Declared for: ${c.patches.join(', ')}`);
    if (c.lagDays != null) parts.push(c.lagDays === 0 ? 'Ready on release day' : `Ready ${c.lagDays} days after release`);
    if (upcoming) parts.push(`${label} is not released yet`);
    return parts.join('\n');
  }
</script>

<div class="controls">
  <div class="tabs" role="group" aria-label="Mod loader">
    {#each loaders as l}
      <button aria-pressed={loader === l} onclick={() => (loader = l)}>{LOADER_LABEL[l]}</button>
    {/each}
  </div>
  <label class="sr-only" for="q">Filter mods</label>
  <input id="q" type="search" placeholder="Filter the top mods…" bind:value={query} />
  <label>
    Sort
    <select bind:value={sort}>
      <option value="downloads">Most downloaded</option>
      <option value="lag">Fastest to update</option>
      <option value="name">Name</option>
    </select>
  </label>
  <label>
    Drop
    <select bind:value={focusDrop}>
      {#each drops as d}<option value={d.id}>{d.id}{d.upcoming ? ' (upcoming)' : ''}</option>{/each}
    </select>
  </label>
  <label class="check"><input type="checkbox" bind:checked={onlyBlocked} /> Only not ready</label>
  <span class="addcol">
    <label class="sr-only" for="addcol">Add a version column</label>
    <select id="addcol" bind:value={adding} onchange={addColumn}>
      <option value="">+ Add version column…</option>
      <optgroup label="Popular older versions">
        {#each legacyOptions.filter((o) => o.popular) as o}<option value={o.id}>{o.id}</option>{/each}
      </optgroup>
      <optgroup label="All versions and snapshots">
        {#each legacyOptions.filter((o) => !o.popular) as o}<option value={o.id}>{o.id}</option>{/each}
      </optgroup>
    </select>
  </span>
</div>

{#if error}
  <p class="card">Couldn't load data ({error}). Try refreshing.</p>
{:else if !data}
  <p class="muted">Loading {LOADER_LABEL[loader]} mods…</p>
{:else}
  <p class="muted small">
    Top {data.mods.length} {LOADER_LABEL[loader]} mods by downloads{query ? `, ${rows.length} matching` : ''}. Hover or tap a status for detail.
    Looking for a less popular mod? <a href="/list">Search all of Modrinth in the list checker</a>.
  </p>
  <div class="scroller">
    <table class="matrix">
      <thead>
        <tr>
          <th scope="col" class="mod-col">Mod</th>
          {#each drops as d}
            <th scope="col" class:focus={d.id === focusDrop}>{d.id}{#if d.upcoming}<span class="muted small"> next</span>{/if}</th>
          {/each}
          {#each extra as v}
            <th scope="col" class="extra">
              {v}
              <button class="rm" onclick={() => (extra = extra.filter((x) => x !== v))} aria-label="Remove {v} column">✕</button>
            </th>
          {/each}
        </tr>
      </thead>
      <tbody>
        {#each rows.slice(0, limit) as m (m.id)}
          <tr>
            <th scope="row" class="mod-col">
              <div class="mod">
                {#if m.icon}<img class="mod-icon" src={m.icon} alt="" loading="lazy" width="28" height="28" />{:else}<span class="mod-icon"></span>{/if}
                <div>
                  <a href="/mod/{m.slug}">{m.title}</a>
                  <div class="muted small">{fmtDownloads(m.downloads)} · {ENV[m.env]}</div>
                </div>
              </div>
            </th>
            {#each drops as d}
              <td class:focus={d.id === focusDrop} data-col={d.id}>
                <Chip status={m.cells[d.id].status} short upcoming={d.upcoming} title={cellTitle(m.cells[d.id], d.id, d.upcoming)} />
              </td>
            {/each}
            {#each extra as v}
              {@const c = extraCell(m, v)}
              <td data-col={v}><Chip status={c.status} short title={cellTitle(c, v, false)} /></td>
            {/each}
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
  {#if rows.length > limit}
    <p><button onclick={() => (limit += 100)}>Show 100 more</button></p>
  {/if}
{/if}

<style>
  .controls { display: flex; flex-wrap: wrap; gap: 8px 12px; align-items: center; margin-bottom: 12px; }
  .controls input[type='search'] { flex: 1 1 200px; }
  .check { display: inline-flex; gap: 6px; align-items: center; }
  .scroller { max-height: 75vh; overflow: auto; border: 2px solid var(--outline); border-radius: var(--radius); background: var(--surface); box-shadow: inset 2px 2px 0 var(--bevel-hi); }
  .matrix { border-collapse: separate; border-spacing: 0; width: 100%; }
  .matrix th, .matrix td { padding: 6px 10px; border-bottom: 1px solid var(--border); text-align: left; }
  .matrix thead th { position: sticky; top: 0; background: var(--surface-2); z-index: 2; font-family: var(--pixel); font-weight: 400; font-size: 16px; white-space: nowrap; border-bottom: 2px solid var(--outline); }
  .mod-col { position: sticky; left: 0; background: var(--surface); z-index: 1; font-weight: normal; min-width: 220px; }
  thead .mod-col { z-index: 3; }
  .focus { background: var(--surface-2) !important; }
  .extra { border-left: 2px solid var(--border); }
  .rm { padding: 0 6px; margin-left: 4px; font-size: 0.75rem; }
  .mod { display: flex; gap: 10px; align-items: center; }
  .mod a { color: var(--text); font-weight: 600; text-decoration: none; }
  .mod a:hover { text-decoration: underline; }

  /* Mobile: cards, no horizontal scrolling */
  @media (max-width: 640px) {
    .scroller { max-height: none; overflow: visible; border: 0; background: none; }
    .matrix thead { display: none; }
    .matrix, .matrix tbody { display: block; }
    .matrix tr { display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px; padding: 12px; margin-bottom: 8px; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); }
    .matrix th, .matrix td { border: 0; padding: 0; }
    .mod-col { position: static; grid-column: 1 / -1; min-width: 0; }
    .matrix td::before { content: attr(data-col) ' '; font-size: 0.8125rem; color: var(--muted); }
    .focus { background: none !important; }
  }
</style>
