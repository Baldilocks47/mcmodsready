<script lang="ts">
  import { onMount } from 'svelte';
  import { listReadiness, type ListItem } from '../lib/core/readiness';
  import { decodeList, encodeList, parsePasted, type ModList } from '../lib/core/share';
  import type { Drop, Loader, Status } from '../lib/core/types';
  import type { MatrixFile, MatrixMod } from '../lib/data-schema';
  import { loadMatrix } from '../lib/ui/data';
  import { DECLARED_NOTE, ENV, LOADER_LABEL, STATUS, modrinthUrl } from '../lib/ui/status';
  import Chip from './Chip.svelte';
  import Ring from './Ring.svelte';

  let { drops, loaders, hostCta }: { drops: Drop[]; loaders: Loader[]; hostCta: string | null } = $props();

  const KEY = 'mmr.lists.v1';
  const latest = drops.find((d) => !d.upcoming)!.id;
  const newId = () => Math.random().toString(36).slice(2, 10);
  const blank = (): ModList => ({ id: newId(), name: 'My mods', loader: 'fabric', drop: latest, acceptPrerelease: false, mods: [] });

  let lists = $state<ModList[]>([]);
  let currentId = $state('');
  let data = $state<MatrixFile | null>(null);
  let query = $state('');
  let pasted = $state('');
  let importMsg = $state('');
  let copied = $state(false);
  let ready = $state(false);

  onMount(() => {
    try {
      lists = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    } catch {
      lists = [];
    }
    if (location.hash.length > 1) {
      const shared = decodeList(location.hash, newId);
      if (shared) {
        if (!drops.some((d) => d.id === shared.drop)) shared.drop = latest;
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
    for (const l of lists) if (!drops.some((d) => d.id === l.drop)) l.drop = latest;
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

  $effect(() => {
    const l = list?.loader;
    if (!l) return;
    data = null;
    loadMatrix(l).then((m) => {
      if (list?.loader === l) data = m;
    });
  });

  const byId = $derived(new Map((data?.mods ?? []).map((m) => [m.id, m])));
  const drop = $derived(drops.find((d) => d.id === list?.drop) ?? drops[0]);
  const opts = $derived({ acceptPrerelease: list?.acceptPrerelease });

  /** list mods plus required dependencies not already in the list */
  const entries = $derived.by(() => {
    if (!list || !data) return [] as { mod: MatrixMod; requiredBy?: string }[];
    const inList = list.mods.map((id) => byId.get(id)).filter((m): m is MatrixMod => !!m);
    const ids = new Set(inList.map((m) => m.id));
    const extra: { mod: MatrixMod; requiredBy: string }[] = [];
    for (const m of inList)
      for (const dep of m.deps) {
        const d = byId.get(dep);
        if (d && !ids.has(dep)) {
          ids.add(dep);
          extra.push({ mod: d, requiredBy: m.title });
        }
      }
    return [...inList.map((mod) => ({ mod })), ...extra];
  });
  const missing = $derived(list && data ? list.mods.filter((id) => !byId.has(id)).length : 0);

  const status = (m: MatrixMod): Status => m.cells[drop.id]?.status ?? 'unknown';
  const result = $derived(
    listReadiness(
      entries.map(({ mod }): ListItem => ({ slug: mod.slug, title: mod.title, env: mod.env, status: status(mod) })),
      opts,
    ),
  );
  const bySlug = $derived(new Map((data?.mods ?? []).map((m) => [m.slug, m])));

  const suggestions = $derived.by(() => {
    const q = query.trim().toLowerCase();
    if (!q || !data || !list) return [];
    return data.mods.filter((m) => !list.mods.includes(m.id) && (m.title.toLowerCase().includes(q) || m.slug.includes(q))).slice(0, 8);
  });

  function update(patch: Partial<ModList>) {
    lists = lists.map((l) => (l.id === currentId ? { ...l, ...patch } : l));
  }
  function add(m: MatrixMod) {
    if (list && !list.mods.includes(m.id)) update({ mods: [...list.mods, m.id] });
    query = '';
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
  function importPasted() {
    if (!data || !list) return;
    const byTitle = new Map(data.mods.map((m) => [m.title.toLowerCase(), m]));
    const found: string[] = [];
    const notFound: string[] = [];
    for (const key of parsePasted(pasted)) {
      const m = bySlug.get(key) ?? byTitle.get(key) ?? data.mods.find((x) => x.id.toLowerCase() === key);
      if (m) found.push(m.id);
      else notFound.push(key);
    }
    update({ mods: [...new Set([...list.mods, ...found])] });
    importMsg = `Added ${found.length}.` + (notFound.length ? ` Not found in the tracked top mods: ${notFound.slice(0, 10).join(', ')}${notFound.length > 10 ? '…' : ''}` : '');
    pasted = '';
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
</script>

{#if list}
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
      <label>
        Target version
        <select value={list.drop} onchange={(e) => update({ drop: e.currentTarget.value })}>
          {#each drops as d}<option value={d.id}>{d.id}{d.upcoming ? ' (upcoming)' : ''}</option>{/each}
        </select>
      </label>
      <label class="check">
        <input type="checkbox" checked={list.acceptPrerelease} onchange={(e) => update({ acceptPrerelease: e.currentTarget.checked })} />
        Count beta {drop.upcoming ? 'and snapshot ' : ''}builds as ready
      </label>

      <div class="add">
        <label for="add">Add a mod</label>
        <input id="add" type="search" placeholder={data ? 'Search top mods…' : 'Loading…'} bind:value={query} disabled={!data} autocomplete="off" />
        {#if suggestions.length}
          <ul class="sugg" role="listbox">
            {#each suggestions as m}
              <li><button onclick={() => add(m)}>{#if m.icon}<img class="mod-icon" src={m.icon} alt="" width="20" height="20" />{/if}{m.title}</button></li>
            {/each}
          </ul>
        {/if}
      </div>
      <details>
        <summary>Paste a list</summary>
        <p class="small muted">One per line or comma-separated: Modrinth links, slugs, or mod names.</p>
        <textarea rows="5" bind:value={pasted} placeholder={'sodium\nhttps://modrinth.com/mod/lithium\nIris Shaders'}></textarea>
        <button onclick={importPasted} disabled={!pasted.trim() || !data}>Add these</button>
      </details>
      {#if importMsg}<p class="small" role="status">{importMsg}</p>{/if}
      <button class="primary" onclick={share} disabled={!list.mods.length}>{copied ? 'Link copied ✓' : 'Copy shareable link'}</button>
      <p class="small muted">Lists are saved in this browser only. The share link contains the list itself; nothing is uploaded.</p>
    </aside>

    <section class="results">
      {#if !data}
        <p class="muted">Loading…</p>
      {:else if !entries.length}
        <div class="card empty">
          <h2>Add your mods to see if they're ready for {drop.id}</h2>
          <p class="muted">Search on the left, or paste your list. We track the top 500 {LOADER_LABEL[list.loader]} mods on Modrinth.</p>
        </div>
      {:else}
        <div class="card rings">
          <Ring label="Server" {...result.server} />
          <Ring label="Client" {...result.client} />
          <Ring label="Both" {...result.both} />
        </div>
        <p class="small muted">{DECLARED_NOTE}{missing ? ` ${missing} saved mod(s) aren't in the current ${LOADER_LABEL[list.loader]} data.` : ''}</p>

        {#if hostCta && result.server.ok && result.server.total > 0}
          <aside class="card cta">
            <p><strong>Your server list is ready for {drop.id}.</strong> Need somewhere to run it?</p>
            <p><a class="btn" href="/go/host" rel="sponsored nofollow">{hostCta}</a> <span class="small muted">Affiliate link: we may earn a commission, at no cost to you.</span></p>
          </aside>
        {/if}

        {#if result.blockers.length}
          <section class="card">
            <h2>What's blocking you ({result.blockers.length})</h2>
            <ul class="blockers">
              {#each result.blockers as b}
                {@const m = bySlug.get(b.slug)!}
                {@const alts = m.alts[drop.id] ?? []}
                <li>
                  <div class="b-head">
                    <a href="/mod/{b.slug}">{b.title}</a>
                    <Chip status={b.status} upcoming={drop.upcoming} />
                    <span class="small muted">blocks {sideLabel(b.sides)}{b.envUnknown ? ' (side unknown, assumed both)' : ''}{b.optional ? ' (optional per side: you could leave it off one)' : ''}</span>
                  </div>
                  {#if alts.length}
                    <div class="small alts">
                      {alts.some((a) => a.curated) ? 'Known replacements:' : 'Similar mods that are ready:'}
                      {#each alts as a, i}
                        {@const am = bySlug.get(a.slug)}
                        {i ? ', ' : ''}<a href={modrinthUrl(a.slug)} rel="noopener" title={a.note ?? ''}>{am?.title ?? a.slug}</a>
                      {/each}
                      {#if !alts.some((a) => a.curated)}<span class="muted">(similar category; check features before switching)</span>{/if}
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
                  <div class="small muted">{ENV[mod.env]}{requiredBy ? ` · required by ${requiredBy}` : ''}</div>
                </div>
                <Chip status={status(mod)} upcoming={drop.upcoming} />
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
  .setup label { display: flex; flex-direction: column; gap: 4px; font-size: 0.875rem; }
  .setup label.check { flex-direction: row; align-items: center; }
  .row { display: flex; gap: 6px; }
  .row select { flex: 1; min-width: 0; }
  .add { position: relative; display: flex; flex-direction: column; gap: 4px; font-size: 0.875rem; }
  .sugg { list-style: none; margin: 0; padding: 4px; position: absolute; top: 100%; left: 0; right: 0; z-index: 5; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; box-shadow: 0 6px 20px rgb(0 0 0 / 0.15); }
  .sugg button { width: 100%; border: 0; justify-content: flex-start; }
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
  .b-head a, .m-main a { font-weight: 600; color: var(--text); }
  .alts { margin-top: 4px; }
  .mods li { display: flex; gap: 10px; align-items: center; padding: 8px 0; border-bottom: 1px solid var(--border); }
  .m-main { flex: 1; min-width: 0; }
  .x { padding: 2px 8px; }
  .empty h2 { font-size: 1.25rem; }
</style>
