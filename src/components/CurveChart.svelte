<script lang="ts">
  import type { Loader } from '../lib/core/types';

  // One line per loader: % of the top 100 with a release build by day N after the drop.
  let { curves, drop }: { curves: { loader: Loader; points: number[] }[]; drop: string } = $props();

  const NAME: Record<Loader, string> = { fabric: 'Fabric', neoforge: 'NeoForge', forge: 'Forge' };
  // fixed slot per loader (categorical order: blue, orange, aqua; validated on both site surfaces)
  const SLOT: Record<Loader, number> = { fabric: 1, neoforge: 2, forge: 3 };

  const W = 640;
  const H = 300;
  const M = { top: 16, right: 118, bottom: 34, left: 40 };
  const days = $derived(Math.max(1, ...curves.map((c) => c.points.length - 1)));
  const x = (d: number) => M.left + (d / days) * (W - M.left - M.right);
  const y = (p: number) => M.top + (1 - p / 100) * (H - M.top - M.bottom);
  const path = (pts: number[]) => pts.map((p, d) => `${d ? 'L' : 'M'}${x(d).toFixed(1)},${y(p).toFixed(1)}`).join('');
  const xTicks = $derived([0, 7, 14, 21, 30].filter((d) => d <= days));
  // the table also shows day 1, the figure people quote most
  const tableDays = $derived([0, 1, 7, 14, 21, 30].filter((d) => d <= days));

  // direct labels at line ends, nudged apart so they never collide
  const labels = $derived.by(() => {
    const ls = curves.map((c) => ({ loader: c.loader, v: c.points[c.points.length - 1], ly: y(c.points[c.points.length - 1]) })).sort((a, b) => a.ly - b.ly);
    for (let i = 1; i < ls.length; i++) if (ls[i].ly - ls[i - 1].ly < 16) ls[i].ly = ls[i - 1].ly + 16;
    return ls;
  });

  let hover = $state<number | null>(null);
  function move(e: PointerEvent) {
    const svg = e.currentTarget as SVGSVGElement;
    const r = svg.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const d = Math.round(((px - M.left) / (W - M.left - M.right)) * days);
    hover = d >= 0 && d <= days ? d : null;
  }
</script>

<figure class="viz-root">
  <figcaption>
    <span class="legend">
      {#each curves as c}<span class="key"><span class="sw" style:background="var(--series-{SLOT[c.loader]})"></span>{NAME[c.loader]}</span>{/each}
    </span>
  </figcaption>
  <div class="wrap">
    <svg viewBox="0 0 {W} {H}" role="img" aria-label="Share of the top 100 mods per loader with a release build for {drop}, by days after release" onpointermove={move} onpointerleave={() => (hover = null)}>
      {#each [0, 25, 50, 75, 100] as g}
        <line class="grid" x1={M.left} x2={W - M.right} y1={y(g)} y2={y(g)} />
        <text class="tick" x={M.left - 8} y={y(g) + 4} text-anchor="end">{g}%</text>
      {/each}
      {#each xTicks as d}
        <text class="tick" x={x(d)} y={H - M.bottom + 18} text-anchor="middle">{d === 0 ? 'release day' : `day ${d}`}</text>
      {/each}
      {#each curves as c}
        <path d={path(c.points)} class="line" style:stroke="var(--series-{SLOT[c.loader]})" />
      {/each}
      {#each labels as l}
        <circle cx={x(days)} cy={y(l.v)} r="4" style:fill="var(--series-{SLOT[l.loader]})" class="end" />
        <text class="dl" x={x(days) + 10} y={l.ly + 4}>{NAME[l.loader]} {l.v}%</text>
      {/each}
      {#if hover !== null}
        <line class="cross" x1={x(hover)} x2={x(hover)} y1={M.top} y2={H - M.bottom} />
        {#each curves as c}
          {#if c.points[hover] !== undefined}<circle cx={x(hover)} cy={y(c.points[hover])} r="5" style:fill="var(--series-{SLOT[c.loader]})" class="end" />{/if}
        {/each}
      {/if}
      <!-- generous hit area for the hover layer -->
      <rect x={M.left} y={M.top} width={W - M.left - M.right} height={H - M.top - M.bottom} fill="transparent" />
    </svg>
    {#if hover !== null}
      <div class="tip" style:left="{(x(hover) / W) * 100}%">
        <strong>{hover === 0 ? 'Release day' : `Day ${hover}`}</strong>
        {#each [...curves].sort((a, b) => (b.points[hover!] ?? 0) - (a.points[hover!] ?? 0)) as c}
          <span><span class="sw" style:background="var(--series-{SLOT[c.loader]})"></span>{NAME[c.loader]} <b>{c.points[hover!]}%</b></span>
        {/each}
      </div>
    {/if}
  </div>
  <details>
    <summary class="small">Show as a table</summary>
    <table>
      <thead><tr><th scope="col">Day</th>{#each curves as c}<th scope="col">{NAME[c.loader]}</th>{/each}</tr></thead>
      <tbody>
        {#each tableDays as d}
          <tr><th scope="row">{d}</th>{#each curves as c}<td>{c.points[d]}%</td>{/each}</tr>
        {/each}
      </tbody>
    </table>
  </details>
</figure>

<style>
  .viz-root {
    --series-1: #2a78d6;
    --series-2: #eb6834;
    --series-3: #1baf7a;
    margin: 0;
  }
  @media (prefers-color-scheme: dark) {
    :global(:root:where(:not([data-theme='light']))) .viz-root { --series-1: #3987e5; --series-2: #d95926; --series-3: #199e70; }
  }
  :global(:root[data-theme='dark']) .viz-root { --series-1: #3987e5; --series-2: #d95926; --series-3: #199e70; }

  .legend { display: flex; gap: 16px; flex-wrap: wrap; font-size: 0.875rem; color: var(--muted); }
  .key { display: inline-flex; align-items: center; gap: 6px; }
  .sw { display: inline-block; width: 14px; height: 4px; border-radius: 2px; }
  .wrap { position: relative; }
  svg { width: 100%; height: auto; display: block; touch-action: pan-y; }
  .grid { stroke: var(--border); stroke-width: 1; }
  .tick { fill: var(--muted); font-size: 12px; }
  .line { fill: none; stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; }
  .end { stroke: var(--surface); stroke-width: 2; }
  .dl { fill: var(--text); font-size: 13px; font-weight: 700; }
  .cross { stroke: var(--muted); stroke-width: 1; stroke-dasharray: 3 3; }
  .tip {
    position: absolute;
    top: 0;
    transform: translateX(-50%);
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 6px 10px;
    font-size: 0.8125rem;
    white-space: nowrap;
    pointer-events: none;
    background: var(--surface);
    border: 2px solid var(--outline);
    border-radius: 3px;
  }
  .tip span { display: inline-flex; align-items: center; gap: 6px; }
  table { border-collapse: collapse; margin-top: 8px; font-variant-numeric: tabular-nums; }
  th, td { padding: 4px 12px; border-bottom: 1px solid var(--border); text-align: left; }
</style>
