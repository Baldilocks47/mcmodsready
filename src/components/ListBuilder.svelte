<script lang="ts">
  import { onMount } from 'svelte';
  import { listReadiness, type ListItem } from '../lib/core/readiness';
  import { decodeList, encodeList, migrateList, parsePasted, type ModList } from '../lib/core/share';
  import { altDrop, cellAt, defaultTarget, depsAt, isUpcoming, parseTarget } from '../lib/core/targets';
  import type { Drop, GameVersion, Loader, ModFile, Status } from '../lib/core/types';
  import { loadMods, resolveNames, searchMods, type SearchResult } from '../lib/ui/data';
  import { DECLARED_NOTE, ENV, LOADER_LABEL, modrinthUrl } from '../lib/ui/status';
  import Chip from './Chip.svelte';
  import Ring from './Ring.svelte';
  import TargetPicker from './TargetPicker.svelte';

  let { drops, versions, loaders, hostCta }: { drops: Drop[]; versions: GameVersion[]; loaders: Loader[]; hostCta: string | null } = $props();

  const KEY = 'mmr.lists.v1';
  const src = { drops, versions };
  const newId = () => Math.random().toString(36).slice(2, 10);
  const blank = (): ModList => ({ id: newId(), name: 'My mods', loader: 'fabric', target: defaultTarget(src), acceptPrerelease: false, mods: [] });

  let lists = $state<ModList[]>([]);
  let currentId = $state('');
  let mods = $state(new Map<string, ModFile>());
  let loading = $state(false);
  let query = $state('');
  let results = $state<SearchResult[]>([]);
  let pasted = $state('');
  let importMsg = $state('');
  let copied = $state(false);
  let ready = $state(false);
  let showSnapshots = $state(false);

  onMount(() => {
    try {
      lists = (JSON.parse(localStorage.getItem(KEY) ?? '[]') as ModList[]).map(migrateList);
    } catch {
      lists = [];
    }
    if (location.hash.length > 1) {
      const shared = decodeList(location.hash, newId);
      if (shared) {
        if (!shared.target) shared.target = defaultTarget(src);
        const same = lists.find((l) => l.name === shared.name && l.mods.join() === shared.mods.join());
        if (same) currentId = same.id;
        else {
          lists = [...lists, shared];
          currentId = shared.id;
        }
      }
      history.replaceState(null, '', location.pathname);
    }
    if (!lists.length) lists = [blank()];
    for (const l of lists) if (!parseTarget(l.target, src)) l.target = defaultTarget(src);
    if (!currentId) currentId = lists[0].id;
    ready = true;
  });

  $effect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(KEY, JSON.stringify(lists));
    } catch {
      // storage unavailable (private mode etc.); lists last for this visit only
    }
  });

  const list = $derived(lists.find((l) => l.id === currentId));
  const target = $derived(list ? parseTarget(list.target, src) : null);
  const upcoming = $derived(target ? isUpcoming(target, src) : false);
  const opts = $derived({ acceptPrerelease: list?.acceptPrerelease });

  // Load list mods, then any required dependencies not already loaded.
  $effect(() => {
    if (!list) return;
    const want = list.mods.filter((id) => !mods.has(id));
    const loader = list.loader;
    if (!want.length) {
      loadDeps(loader);
      return;
    }
    loading = true;
    loadMods(want)
      .then((got) => {
        const next = new Map(mods);
        for (const [k, v] of got) next.set(k, v);
        mods = next;
        loadDeps(loader);
      })
      .finally(() => (loading = false));
  });

  function loadDeps(loader: Loader) {
    if (!list) return;
    const t = parseTarget(list.target, src);
    if (!t) return;
    const deps = list.mods.flatMap((id) => { const m = mods.get(id); return m ? depsAt(m, loader, t) : []; }).filter((d) => !mods.has(d));
    if (!deps.length) return;
    loadMods([...new Set(deps)]).then((got) => {
      const next = new Map(mods);
      for (const [k, v] of got) next.set(k, v);
      mods = next;
    });
  }

  /** list mods plus required dependencies not already in the list */
  const entries = $derived.by(() => {
    if (!list) return [] as { mod: ModFile; requiredBy?: string }[];
    const inList = list.mods.map((id) => mods.get(id)).filter((m): m is ModFile => !!m);
    const ids = new Set(inList.map((m) => m.id));
    const extra: { mod: ModFile; requiredBy: string }[] = [];
    for (const m of inList)
      for (const dep of target ? depsAt(m, list.loader, target) : []) {
        const d = mods.get(dep);
        if (d && !ids.has(dep)) {
          ids.add(dep);
          extra.push({ mod: d, requiredBy: m.title });
        }
      }
    return [...inList.map((mod) => ({ mod })), ...extra];
  });
  const pending = $derived(list ? list.mods.filter((id) => !mods.has(id)).length : 0);

  const status = (m: ModFile): Status => (list && target ? cellAt(m, list.loader, target, src).status : 'unknown');
  const result = $derived(listReadiness(entries.map(({ mod }): ListItem => ({ slug: mod.slug, title: mod.title, env: mod.env, status: status(mod) })), opts));
  const bySlug = $derived(new Map([...mods.values()].map((m) => [m.slug, m])));

  // Search all of Modrinth (debounced).
  let timer: ReturnType<typeof setTimeout>;
  $effect(() => {
    const q = query.trim();
    const loader = list?.loader;
    clearTimeout(timer);
    if (q.length < 2 || !loader) {
      results = [];
      return;
    }
    timer = setTimeout(async () => {
      try {
        const r = await searchMods(q, loader);
        if (q === query.trim()) results = r.filter((x) => !list?.mods.includes(x.id));
      } catch {
        results = [];
      }
    }, 250);
  });

  function update(patch: Partial<ModList>) {
    lists = lists.map((l) => (l.id === currentId ? { ...l, ...patch } : l));
  }
  function add(r: SearchResult) {
    if (list && !list.mods.includes(r.id)) update({ mods: [...list.mods, r.id] });
    query = '';
    results = [];
  }
  function remove(id: string) {
    if (list) update({ mods: list.mods.filter((x) => x !== id) });
  }
  function newList() {
    const l = blank();
    l.name = `List ${lists.length + 1}`;
    lists = [...lists, l];
    currentId = l.id;
  }
  function deleteList() {
    if (!list || !confirm(`Delete "${list.name}"?`)) return;
    lists = lists.filter((l) => l.id !== currentId);
    if (!lists.length) lists = [blank()];
    currentId = lists[0].id;
  }
  async function importPasted() {
    if (!list) return;
    importMsg = 'Looking up…';
    const keys = parsePasted(pasted);
    try {
      const { found, notFound } = await resolveNames(keys, list.loader);
      const ids = [...found.values()].map((r) => r.id);
      update({ mods: [...new Set([...list.mods, ...ids])] });
      importMsg = `Added ${ids.length}.` + (notFound.length ? ` Couldn't find on Modrinth: ${notFound.slice(0, 10).join(', ')}${notFound.length > 10 ? '…' : ''}` : '');
      pasted = '';
    } catch {
      importMsg = "Couldn't reach Modrinth. Try again in a moment.";
    }
  }
  async function share() {
    if (!list) return;
    const url = `${location.origin}/list#${encodeList(list)}`;
    try {
      await navigator.clipboard.writeText(url);
      copied = true;
      setTimeout(() => (copied = false), 2000);
    } catch {
      prompt('Copy this link:', url);
    }
  }
  const sideLabel = (s: ('server' | 'client')[]) => (s.length === 2 ? 'server + client' : s[0]);
  const fmtDl = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n));
</script>

{#if list && target}
  <div class="layout">
    <aside class="card setup">
      <div class="row">
        <label class="sr-only" for="pick">Choose list</label>
        <select id="pick" bind:value={currentId}>
          {#each lists as l}<option value={l.id}>{l.name} ({l.mods.length})</option>{/each}
        </select>
        <button onclick={newList}>New</button>
        <button onclick={deleteList} aria-label="Delete this list">Delete</button>
      </div>
      <label>Name <input value={list.name} oninput={(e) => update({ name: e.currentTarget.value })} maxlength="80" /></label>
      <div class="tabs" role="group" aria-label="Mod loader">
        {#each loaders as l}
          <button aria-pressed={list.loader === l} onclick={() => update({ loader: l })}>{LOADER_LABEL[l]}</button>
        {/each}
      </div>
      <div class="field">
        <label for="target">Minecraft version</label>
        <TargetPicker {drops} {versions} {showSnapshots} value={list.target} onchange={(v) => update({ target: v })} id="target" />
      </div>
      <label class="check"><input type="checkbox" bind:checked={showSnapshots} /> Show snapshots in the version list</label>
      <label class="check">
        <input type="checkbox" checked={list.acceptPrerelease} onchange={(e) => update({ acceptPrerelease: e.currentTarget.checked })} />
        Count beta {upcoming ? 'and snapshot ' : ''}builds as ready
      </label>

      <div class="add">
        <label for="add">Add a mod</label>
        <input id="add" type="search" placeholder="Search all of Modrinth…" bind:value={query} autocomplete="off" />
        {#if results.length}
          <ul class="sugg" role="listbox">
            {#each results as r}
              <li>
                <button onclick={() => add(r)}>
                  {#if r.icon}<img class="mod-icon" src={r.icon} alt="" width="20" height="20" />{/if}
                  <span class="s-title">{r.title}</span><span class="small muted">{fmtDl(r.downloads)}</span>
                </button>
              </li>
            {/each}
          </ul>
        {/if}
      </div>
      <details>
        <summary>Paste a list</summary>
        <p class="small muted">One per line or comma-separated: Modrinth links, slugs, or mod names.</p>
        <textarea rows="5" bind:value={pasted} placeholder={'sodium\nhttps://modrinth.com/mod/lithium\nIris Shaders'}></textarea>
        <button onclick={importPasted} disabled={!pasted.trim()}>Add these</button>
      </details>
      {#if importMsg}<p class="small" role="status">{importMsg}</p>{/if}
      <button class="primary" onclick={share} disabled={!list.mods.length}>{copied ? 'Link copied ✓' : 'Copy shareable link'}</button>
      <p class="small muted">Lists are saved in this browser only. The share link contains the list itself; nothing is uploaded.</p>
    </aside>

    <section class="results">
      {#if !entries.length && !pending}
        <div class="card empty">
          <h2>Add your mods to see if they're ready for {target.label}</h2>
          <p class="muted">Search any {LOADER_LABEL[list.loader]} mod on Modrinth, or paste your list.</p>
        </div>
      {:else}
        <div class="card rings">
          <Ring label="Server" {...result.server} />
          <Ring label="Client" {...result.client} />
          <Ring label="Both" {...result.both} />
        </div>
        <p class="small muted">
          Checking against <strong>{target.label}</strong> on {LOADER_LABEL[list.loader]}. {DECLARED_NOTE}
          {#if loading || pending}<span role="status"> Loading {pending} mod(s)…</span>{/if}
        </p>

        {#if hostCta && result.server.ok && result.server.total > 0}
          <aside class="card cta">
            <p><strong>Your server list is ready for {target.label}.</strong> Need somewhere to run it?</p>
            <p><a class="btn" href="/go/host?from=list" rel="sponsored nofollow">{hostCta}</a> <span class="small muted">Affiliate link: we may earn a commission, at no cost to you.</span></p>
          </aside>
        {/if}

        {#if result.blockers.length}
          <section class="card">
            <h2>What's blocking you ({result.blockers.length})</h2>
            <ul class="blockers">
              {#each result.blockers as b}
                {@const m = bySlug.get(b.slug)!}
                {@const ad = altDrop(target)}
                {@const alts = (ad && m.alts?.[list.loader]?.[ad]) || []}
                <li>
                  <div class="b-head">
                    <a href="/mod/{b.slug}">{b.title}</a>
                    <Chip status={b.status} {upcoming} />
                    <span class="small muted">blocks {sideLabel(b.sides)}{b.envUnknown ? ' (side unknown, assumed both)' : ''}{b.optional ? ' (optional per side: you could leave it off one)' : ''}</span>
                  </div>
                  {#if alts.length}
                    <div class="small alts">
                      {alts.some((a) => a.curated) ? 'Known replacements:' : 'Similar mods that are ready:'}
                      {#each alts as a, i}
                        {i ? ', ' : ''}<a href="/mod/{a.slug}" title={a.note ?? ''}>{a.slug}</a>
                      {/each}
                      {#if !alts.some((a) => a.curated)}<span class="muted">(similar purpose; check features before switching)</span>{/if}
                    </div>
                  {/if}
                </li>
              {/each}
            </ul>
          </section>
        {/if}

        <section class="card">
          <h2>Your mods ({entries.length})</h2>
          <ul class="mods">
            {#each entries as { mod, requiredBy } (mod.id)}
              <li>
                {#if mod.icon}<img class="mod-icon" src={mod.icon} alt="" loading="lazy" width="28" height="28" />{:else}<span class="mod-icon"></span>{/if}
                <div class="m-main">
                  <a href="/mod/{mod.slug}">{mod.title}</a>
                  <div class="small muted">
                    {ENV[mod.env]}{requiredBy ? ` · required by ${requiredBy}` : ''}
                    · <a class="muted" href={modrinthUrl(mod.slug)} rel="noopener" title={mod.live ? 'Checked live on Modrinth just now' : undefined}>Modrinth</a>
                  </div>
                </div>
                <Chip status={status(mod)} {upcoming} />
                {#if !requiredBy}<button class="x" onclick={() => remove(mod.id)} aria-label="Remove {mod.title}">✕</button>{/if}
              </li>
            {/each}
          </ul>
        </section>
      {/if}
    </section>
  </div>
{/if}

<style>
  .layout { display: grid; gap: 16px; }
  @media (min-width: 860px) { .layout { grid-template-columns: 320px 1fr; align-items: start; } .setup { position: sticky; top: 16px; } }
  .setup { display: flex; flex-direction: column; gap: 12px; }
  .setup label, .field { display: flex; flex-direction: column; gap: 4px; font-size: 0.875rem; }
  .setup label.check { flex-direction: row; align-items: center; }
  .row { display: flex; gap: 6px; }
  .row select { flex: 1; min-width: 0; }
  .add { position: relative; display: flex; flex-direction: column; gap: 4px; font-size: 0.875rem; }
  .sugg { list-style: none; margin: 0; padding: 4px; position: absolute; top: 100%; left: 0; right: 0; z-index: 5; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; box-shadow: 0 6px 20px rgb(0 0 0 / 0.15); }
  .sugg button { width: 100%; border: 0; justify-content: flex-start; }
  .sugg .s-title { flex: 1; text-align: left; }
  .sugg .mod-icon { width: 20px; height: 20px; }
  textarea { width: 100%; }
  .results { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
  .rings { display: flex; justify-content: space-around; flex-wrap: wrap; gap: 16px; }
  .cta { border-color: var(--s-ready); }
  .cta p { margin: 4px 0; }
  ul { list-style: none; padding: 0; margin: 0; }
  .blockers li { padding: 10px 0; border-bottom: 1px solid var(--border); }
  .blockers li:last-child, .mods li:last-child { border: 0; }
  .b-head { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
  .b-head a, .m-main > a { font-weight: 600; color: var(--text); }
  .alts { margin-top: 4px; }
  .mods li { display: flex; gap: 10px; align-items: center; padding: 8px 0; border-bottom: 1px solid var(--border); }
  .m-main { flex: 1; min-width: 0; }
  .x { padding: 2px 8px; }
  .empty h2 { font-size: 1.25rem; }
</style>
