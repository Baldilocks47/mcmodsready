<script lang="ts">
  import { onMount } from 'svelte';
  import type { Loader } from '../lib/core/types';
  import type { FeedEvent, MetaFile, StatsFile } from '../lib/data-schema';
  import { DATA_BASE, LOADER_LABEL, timeAgo } from '../lib/ui/status';

  let {
    meta: initialMeta,
    stats: initialStats,
    feed: initialFeed,
  }: { meta: MetaFile; stats: Record<Loader, StatsFile>; feed: FeedEvent[] } = $props();

  let meta = $state(initialMeta);
  let stats = $state(initialStats);
  let feed = $state(initialFeed);
  let loader = $state<Loader>('fabric');

  // Pre-rendered numbers come from the nightly build; refresh from the live data host.
  onMount(async () => {
    try {
      const get = (f: string) => fetch(`${DATA_BASE}/${f}`).then((r) => (r.ok ? r.json() : Promise.reject(r.status)));
      const [m, fd, ...ss] = await Promise.all([get('meta.json'), get('feed.json'), ...initialMeta.loaders.map((l) => get(`stats-${l}.json`))]);
      meta = m;
      stats = Object.fromEntries(initialMeta.loaders.map((l, i) => [l, ss[i]])) as Record<Loader, StatsFile>;
      feed = fd.events;
    } catch {
      // keep pre-rendered data
    }
  });

  const latest = $derived(meta.drops.find((d) => !d.upcoming)!);
  const upcoming = $derived(meta.drops.find((d) => d.upcoming));
  const s = $derived(stats[loader]);
  const w = $derived(s.window.find((x) => x.drop === latest.id)!);
  const up = $derived(upcoming ? s.window.find((x) => x.drop === upcoming.id) : undefined);
  const total = $derived(Object.values(w.top100).reduce((a, b) => a + b, 0));
  const ready = $derived(w.top100.ready ?? 0);
  const pre = $derived(w.top100.prerelease ?? 0);
  const recent = $derived(feed.filter((e) => e.loader === loader).slice(0, 8));
  const daysSince = $derived(Math.floor((Date.now() - Date.parse(latest.releasedAt!)) / 86_400_000));
  const pct = (n: number) => `${(100 * n) / Math.max(1, total)}%`;
</script>

<section class="hero">
  <div class="tabs" role="group" aria-label="Mod loader">
    {#each meta.loaders as l}
      <button aria-pressed={loader === l} onclick={() => (loader = l)}>{LOADER_LABEL[l]}</button>
    {/each}
  </div>
  <h1>Are the top {LOADER_LABEL[loader]} mods ready for {latest.id}?</h1>
  <p class="big"><strong>{ready}</strong> of the top {total} are ready{#if pre}, plus <strong>{pre}</strong> in beta{/if}.</p>
  <div class="bar" role="img" aria-label="{ready} ready, {pre} beta only, out of {total}">
    <span class="b-ready" style:width={pct(ready)}></span>
    <span class="b-prerelease" style:width={pct(pre)}></span>
  </div>
  <p class="muted small">
    {latest.id} was released {daysSince} days ago. Ranked by Modrinth downloads; "ready" means a release build is declared compatible.
  </p>
  <p><a class="btn primary" href="/list">Check my mod list →</a> <a class="btn" href="/mods?loader={loader}">See all mods</a></p>
</section>

<div class="grid grid-2">
  {#if upcoming && up}
    <section class="card">
      <h2>Next up: {upcoming.id}</h2>
      <p>
        {upcoming.id} is in testing (latest: <code>{meta.latestSnapshot}</code>).
        <strong>{up.top100.snapshot ?? 0}</strong> of the top 100 {LOADER_LABEL[loader]} mods already have snapshot builds.
      </p>
      <p class="muted small">Most mods wait for the full release. This page switches to a live counter on release day.</p>
    </section>
  {/if}
  <section class="card">
    <h2>Newly ready for {latest.id}</h2>
    {#if recent.length}
      <ul class="feed">
        {#each recent as e}
          <li><a href="/mod/{e.slug}">{e.title}</a> <span class="muted small">{timeAgo(e.at)}</span></li>
        {/each}
      </ul>
    {:else}
      <p class="muted">No new {LOADER_LABEL[loader]} releases for {latest.id} in the last 7 days.</p>
    {/if}
  </section>
</div>

<section class="card history">
  <h2>How fast do mods update?</h2>
  <p class="muted small">Share of the top 100 {LOADER_LABEL[loader]} mods with a release build, by days after each drop.</p>
  <table>
    <thead><tr><th scope="col">Drop</th><th scope="col">Day 1</th><th scope="col">Day 7</th><th scope="col">Day 30</th><th scope="col">Now</th></tr></thead>
    <tbody>
      {#each s.lag as l}
        <tr>
          <th scope="row">{l.drop}</th>
          {#each [l.readyBy[1], l.readyBy[7], l.readyBy[30], l.readyCount] as n}
            <td><span class="mini"><span style:width="{(100 * n) / l.of}%"></span></span> {Math.round((100 * n) / l.of)}%</td>
          {/each}
        </tr>
      {/each}
    </tbody>
  </table>
</section>

<style>
  .hero { margin-bottom: 24px; }
  h1 { font-size: clamp(1.6rem, 4vw, 2.6rem); margin-top: 16px; }
  .big { font-size: 1.25rem; }
  .bar { height: 18px; margin: 12px 0; }
  .grid { margin-bottom: 16px; }
  .feed { list-style: none; padding: 0; margin: 0; }
  .feed li { padding: 4px 0; border-bottom: 1px solid var(--border); }
  .feed li:last-child { border: 0; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 6px 4px; border-bottom: 1px solid var(--border); font-variant-numeric: tabular-nums; white-space: nowrap; }
  .mini { display: inline-block; width: 48px; height: 8px; background: var(--surface-2); border-radius: 4px; overflow: hidden; vertical-align: middle; }
  .mini > span { display: block; height: 100%; background: var(--s-ready); }
  @media (max-width: 520px) { .mini { display: none; } }
</style>
