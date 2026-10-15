<script lang="ts">
  import { onMount } from 'svelte';
  import type { Drop, Loader } from '../lib/core/types';
  import { searchMods, type SearchResult } from '../lib/ui/data';
  import { LOADER_LABEL } from '../lib/ui/status';

  let { drops, loaders }: { drops: Drop[]; loaders: Loader[] } = $props();

  // Badges are served by the live site; previews always use it so they work from anywhere.
  const SITE = 'https://mcmodsready.com';

  let query = $state('');
  let results = $state<SearchResult[]>([]);
  let mod = $state<{ slug: string; title: string } | null>(null);
  let loader = $state<'' | Loader>('');
  let version = $state('');
  let copied = $state('');

  onMount(() => {
    const p = new URLSearchParams(location.search);
    const m = p.get('mod');
    if (m) mod = { slug: m, title: p.get('title') ?? m };
  });

  let timer: ReturnType<typeof setTimeout>;
  $effect(() => {
    const q = query.trim();
    clearTimeout(timer);
    if (q.length < 2) {
      results = [];
      return;
    }
    timer = setTimeout(async () => {
      try {
        // search across loaders: try the chosen one, else Fabric then others
        const r = await Promise.all((loader ? [loader] : loaders).map((l) => searchMods(q, l, 5)));
        const seen = new Set<string>();
        results = r.flat().filter((x) => !seen.has(x.id) && seen.add(x.id)).sort((a, b) => b.downloads - a.downloads).slice(0, 8);
      } catch {
        results = [];
      }
    }, 250);
  });

  const params = $derived.by(() => {
    const p = new URLSearchParams();
    if (version) p.set('v', version);
    if (loader) p.set('loader', loader);
    const s = p.toString();
    return s ? `?${s}` : '';
  });
  const img = $derived(mod ? `${SITE}/badge/${mod.slug}.svg${params}` : '');
  const link = $derived(mod ? `${SITE}/mod/${mod.slug}` : '');
  const alt = $derived(mod ? `${mod.title} readiness for the latest Minecraft version` : '');
  const snippets = $derived(
    mod
      ? [
          { name: 'Markdown (Modrinth, GitHub, CurseForge)', code: `[![${alt}](${img})](${link})` },
          { name: 'HTML', code: `<a href="${link}"><img src="${img}" alt="${alt}"></a>` },
          { name: 'BBCode (forums)', code: `[url=${link}][img]${img}[/img][/url]` },
        ]
      : [],
  );

  async function copy(code: string, name: string) {
    try {
      await navigator.clipboard.writeText(code);
      copied = name;
      setTimeout(() => (copied = ''), 1500);
    } catch {
      prompt('Copy this:', code);
    }
  }
</script>

<div class="grid grid-2">
  <section class="card setup">
    <h2>1. Pick your mod</h2>
    <div class="add">
      <label for="bq">Search Modrinth</label>
      <input id="bq" type="search" placeholder="Your mod's name or slug…" bind:value={query} autocomplete="off" />
      {#if results.length}
        <ul class="sugg" role="listbox">
          {#each results as r}
            <li>
              <button onclick={() => { mod = { slug: r.slug, title: r.title }; query = ''; results = []; }}>
                {#if r.icon}<img class="mod-icon" src={r.icon} alt="" width="20" height="20" />{/if}{r.title}
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
    {#if mod}<p>Selected: <strong>{mod.title}</strong> <span class="muted small">({mod.slug})</span></p>{/if}

    <h2>2. Options</h2>
    <label>
      Version
      <select bind:value={version}>
        <option value="">Always the latest release (recommended)</option>
        {#each drops as d}<option value={d.id}>{d.id}{d.upcoming ? ' (upcoming)' : ''}</option>{/each}
      </select>
    </label>
    <label>
      Loader
      <select bind:value={loader}>
        <option value="">Best of all loaders</option>
        {#each loaders as l}<option value={l}>{LOADER_LABEL[l]}</option>{/each}
      </select>
    </label>
    <p class="small muted">The default badge moves on by itself: when 26.4 comes out it switches to 26.4 and shows "not yet" until you ship an update.</p>
  </section>

  <section class="card">
    <h2>3. Copy it</h2>
    {#if mod}
      <p class="preview"><img src={img} alt={alt} height="20" /></p>
      {#each snippets as s}
        <div class="snip">
          <div class="snip-h"><span class="small">{s.name}</span><button onclick={() => copy(s.code, s.name)}>{copied === s.name ? 'Copied ✓' : 'Copy'}</button></div>
          <code>{s.code}</code>
        </div>
      {/each}
    {:else}
      <p class="muted">Pick a mod to get its badge.</p>
    {/if}
  </section>
</div>

<style>
  .setup { display: flex; flex-direction: column; gap: 10px; }
  .setup label { display: flex; flex-direction: column; gap: 4px; font-size: 0.875rem; }
  .add { position: relative; display: flex; flex-direction: column; gap: 4px; font-size: 0.875rem; }
  .sugg { list-style: none; margin: 0; padding: 4px; position: absolute; top: 100%; left: 0; right: 0; z-index: 5; background: var(--surface); border: 2px solid var(--outline); border-radius: 3px; }
  .sugg button { width: 100%; border: 0; box-shadow: none; justify-content: flex-start; }
  .sugg .mod-icon { width: 20px; height: 20px; }
  .preview { padding: 12px; background: var(--surface-2); border: 2px dashed var(--border); text-align: center; }
  .snip { margin-top: 12px; }
  .snip-h { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; }
  .snip code { display: block; padding: 8px; font-size: 0.8rem; word-break: break-all; background: var(--surface-2); border: 2px solid var(--outline); border-radius: 3px; }
</style>
