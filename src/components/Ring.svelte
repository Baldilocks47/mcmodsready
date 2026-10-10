<script lang="ts">
  let { label, ready, total, ok }: { label: string; ready: number; total: number; ok: boolean } = $props();
  const R = 34;
  const C = 2 * Math.PI * R;
  const frac = $derived(total ? ready / total : 1);
</script>

<figure class="ring" class:ok>
  <svg viewBox="0 0 80 80" width="96" height="96" aria-hidden="true">
    <circle cx="40" cy="40" r={R} class="track" />
    <circle cx="40" cy="40" r={R} class="val" stroke-dasharray="{C * frac} {C}" transform="rotate(-90 40 40)" />
    <text x="40" y="45" text-anchor="middle">{ok ? '✓' : `${ready}/${total}`}</text>
  </svg>
  <figcaption>
    <strong>{label}</strong>
    <span class="small">{ok ? (total ? 'Ready' : 'Nothing needed') : `${total - ready} blocking`}</span>
  </figcaption>
</figure>

<style>
  .ring { margin: 0; display: flex; flex-direction: column; align-items: center; gap: 4px; text-align: center; }
  .track { fill: none; stroke: var(--surface-2); stroke-width: 10; }
  .val { fill: none; stroke: var(--s-not); stroke-width: 10; stroke-linecap: butt; }
  .ok .val { stroke: var(--s-ready); }
  text { font: 400 16px var(--pixel); fill: var(--text); }
  figcaption { display: flex; flex-direction: column; }
  .ok figcaption .small { color: var(--s-ready); }
  figcaption .small { color: var(--s-not); }
</style>
