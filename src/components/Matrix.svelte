<script lang="ts">
  import { onMount } from 'svelte';
  import type { Cell, Drop, Loader } from '../lib/core/types';
  import type { MatrixFile, MatrixMod } from '../lib/data-schema';
  import { loadMatrix } from '../lib/ui/data';
  import { ENV, LOADER_LABEL, STATUS, fmtDownloads } from '../lib/ui/status';
  import Chip from './Chip.svelte';

  let { drops, loaders }: { drops: Drop[]; loaders: Loader[] } = $props();

  let loader = $state<Loader>('fabric');
  let data = $state<MatrixFile | null>(null);
  let error = $state('');
  let query = $state('');
  let sort = $state<'downloads' | 'lag' | 'name'>('downloads');
  let focusDrop = $state(drops.find((d) => !d.upcoming)!.id);
  let onlyBlocked = $state(false);
  let limit = $state(100);

  onMount(() => {
    const p = new URLSearchParams(location.search);
    const l = p.get('loader');
    if (l && loaders.includes(l as Loader)) loader = l as Loader;
    query = p.get('q') ?? '';
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
    const url = new URL(location.href);
    url.searchParams.set('loader', l);
    history.replaceState(null, '', url);
  });

  const rows = $derived.by(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    let r = data.mods.filter((m) => m.top || q);
    if (q) r = r.filter((m) => m.title.toLowerCase().includes(q) || m.slug.includes(q));
    if (onlyBlocked) r = r.filter((m) => !['ready', 'not_applicable'].includes(m.cells[focusDrop].status));
    const lag = (m: MatrixMod) => m.cells[focusDrop].lagDays ?? Infinity;
    if (sort === 'name') r = [...r].sort((a, b) => a.title.localeCompare(b.title));
    if (sort === 'lag') r = [...r].sort((a, b) => lag(a) - lag(b) || b.downloads - a.downloads);
    return r;
  });

  function cellTitle(c: Cell, d: Drop): string {
    const parts = [STATUS[c.status].hint];
    if (c.patches?.length) parts.push(`Declared for: ${c.patches.join(', ')}`);
    if (c.lagDays != null) parts.push(c.lagDays === 0 ? 'Ready on release day' : `Ready ${c.lagDays} days after release`);
    if (d.upcoming) parts.push(`${d.id} is not released yet`);
    return parts.join('\n');
  }
</script>

<div class="controls">
  <div class="tabs" role="group" aria-label="Mod loader">
    {#each loaders as l}
      <button aria-pressed={loader === l} onclick={() => (loader = l)}>{LOADER_LABEL[l]}</button>
    {/each}
  </div>
  <label class="sr-only" for="q">Search mods</label>
  <input id="q" type="search" placeholder="Search mods…" bind:value={query} />
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
</div>

{#if error}
  <p class="card">Couldn't load data ({error}). Try refreshing.</p>
{:else if !data}
  <p class="muted">Loading {LOADER_LABEL[loader]} mods…</p>
{:else}
  <p class="muted small">
    {rows.length} mods{query ? ' matching' : ` (top ${LOADER_LABEL[loader]} by downloads)`}. Hover or tap a status for detail.
  </p>
  <div class="scroller">
    <table class="matrix">
      <thead>
        <tr>
          <th scope="col" class="mod-col">Mod</th>
          {#each drops as d}
            <th scope="col" class:focus={d.id === focusDrop}>{d.id}{#if d.upcoming}<span class="muted small"> next</span>{/if}</th>
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
              <td class:focus={d.id === focusDrop} data-drop={d.id}>
                <Chip status={m.cells[d.id].status} short upcoming={d.upcoming} title={cellTitle(m.cells[d.id], d)} />
              </td>
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
  .scroller { max-height: 75vh; overflow: auto; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); }
  .matrix { border-collapse: separate; border-spacing: 0; width: 100%; }
  .matrix th, .matrix td { padding: 6px 10px; border-bottom: 1px solid var(--border); text-align: left; }
  .matrix thead th { position: sticky; top: 0; background: var(--surface); z-index: 2; font-size: 0.875rem; }
  .mod-col { position: sticky; left: 0; background: var(--surface); z-index: 1; font-weight: normal; min-width: 220px; }
  thead .mod-col { z-index: 3; }
  .focus { background: var(--surface-2) !important; }
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
    .matrix td::before { content: attr(data-drop) ' '; font-size: 0.8125rem; color: var(--muted); }
    .focus { background: none !important; }
  }
</style>
