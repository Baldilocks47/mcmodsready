<script lang="ts">
  import { dropCell, versionCell } from '../lib/core/status';
  import { contextFor } from '../lib/core/targets';
  import type { Drop, GameVersion, Loader, ModFile } from '../lib/core/types';
  import { DECLARED_NOTE, ENV, LOADER_LABEL, STATUS, fmtDownloads, modrinthUrl } from '../lib/ui/status';

  let {
    mod,
    drops,
    versions,
    popularLegacy,
    titles = {},
  }: { mod: ModFile; drops: Drop[]; versions: GameVersion[]; popularLegacy: Record<Loader, string[]>; titles?: Record<string, string> } = $props();

  const src = $derived({ drops, versions });
  const latest = $derived(drops.find((d) => !d.upcoming)!);
  const loaders = $derived(Object.keys(mod.loaders) as Loader[]);
  const ctx = $derived(contextFor(mod, src));
  const verdict = $derived(loaders.map((l) => ({ l, s: dropCell(mod.loaders[l], latest, ctx).status })));
  const readyOn = $derived(verdict.filter((v) => v.s === 'ready').map((v) => LOADER_LABEL[v.l]));
  const answer = $derived(
    readyOn.length
      ? `Yes: ${mod.title} has a release declared for ${latest.id} on ${readyOn.join(' and ')}.`
      : `Not yet: ${mod.title} has no release declared for ${latest.id}${verdict.some((v) => v.s === 'prerelease') ? ' (beta builds are available)' : ''}.`,
  );
  const legacyFor = (l: Loader) => (popularLegacy[l] ?? []).map((id) => versions.find((v) => v.id === id)).filter((v): v is GameVersion => !!v);
  const chip = (status: string, upcoming: boolean) => {
    const waiting = upcoming && status === 'not_yet';
    const s = waiting ? { icon: '…', label: 'Waiting' } : STATUS[status as keyof typeof STATUS];
    return { cls: waiting ? 'not_applicable' : status, ...s };
  };
</script>

<article>
  <header class="head">
    {#if mod.icon}<img class="icon" src={mod.icon} alt="" width="64" height="64" />{/if}
    <div>
      <h1>Is {mod.title} ready for {latest.id}?</h1>
      <p class="answer">{loaders.length ? answer : `${mod.title} isn't published for Fabric, NeoForge or Forge.`}</p>
      <p class="muted small">
        {fmtDownloads(mod.downloads)} downloads · {ENV[mod.env]} · <a href={modrinthUrl(mod.slug)} rel="noopener">View on Modrinth</a>
        {#if mod.live}· checked live just now{/if}
      </p>
    </div>
  </header>
  <p class="small muted">{mod.description}</p>

  <div class="grid grid-2">
    {#each loaders as l}
      {@const s = mod.loaders[l]}
      {@const alts = mod.alts?.[l]?.[latest.id] ?? []}
      <section class="card">
        <h2>{LOADER_LABEL[l]}</h2>
        <table>
          <tbody>
            {#each drops as d}
              {@const c = dropCell(s, d, ctx)}
              {@const ch = chip(c.status, d.upcoming)}
              <tr>
                <th scope="row">{d.id}{#if d.upcoming}<span class="muted small"> (upcoming)</span>{/if}</th>
                <td><span class="chip s-{ch.cls}"><span class="i" aria-hidden="true">{ch.icon}</span>{ch.label}</span></td>
                <td class="small muted">{c.lagDays != null ? (c.lagDays === 0 ? 'day one' : `+${c.lagDays} days`) : ''}{c.patches?.length ? ` · ${c.patches.join(', ')}` : ''}</td>
              </tr>
            {/each}
            {#each legacyFor(l) as v}
              {@const c = versionCell(s, v, ctx)}
              {@const ch = chip(c.status, false)}
              <tr class="legacy">
                <th scope="row">{v.id}</th>
                <td><span class="chip s-{ch.cls}"><span class="i" aria-hidden="true">{ch.icon}</span>{ch.label}</span></td>
                <td></td>
              </tr>
            {/each}
          </tbody>
        </table>
        {#if alts.length}
          <p class="small">
            {alts.some((a) => a.curated) ? 'Known replacements' : `Similar mods ready for ${latest.id}`}:
            {#each alts as a, i}{i ? ', ' : ''}<a href="/mod/{a.slug}" title={a.note ?? ''}>{a.title ?? titles[a.slug] ?? a.slug}</a>{/each}
            {#if !alts.some((a) => a.curated)}<span class="muted"> (similar purpose; check features before switching)</span>{/if}
          </p>
        {/if}
      </section>
    {/each}
  </div>

  <p><a class="btn primary" href="/list">Check your whole mod list →</a></p>
  <p class="small">Made {mod.title}? <a href="/badges?mod={encodeURIComponent(mod.slug)}&title={encodeURIComponent(mod.title)}">Get a readiness badge for your mod page</a>.</p>
  <p class="small muted">{DECLARED_NOTE} Any version, including snapshots, can be checked in the <a href="/list">list checker</a>.</p>
</article>

<style>
  .head { display: flex; gap: 16px; align-items: flex-start; }
  .icon { width: 64px; height: 64px; border-radius: 12px; flex: none; }
  h1 { font-size: 32px; }
  @media (max-width: 640px) { h1 { font-size: 24px; } }
  .answer { font-size: 1.15rem; }
  .grid { margin: 16px 0; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 6px 4px; border-bottom: 1px solid var(--border); }
  .legacy th { font-weight: normal; color: var(--muted); }
</style>
