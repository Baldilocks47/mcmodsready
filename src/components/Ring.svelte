<script lang="ts">
  let {
    label,
    ready,
    total,
    ok,
    description,
    blockers = [],
  }: {
    label: string;
    ready: number;
    total: number;
    ok: boolean;
    /** what this side means, shown on hover/focus/tap */
    description: string;
    /** mods blocking this side: "Name (status)" */
    blockers?: string[];
  } = $props();
  const R = 34;
  const C = 2 * Math.PI * R;
  const frac = $derived(total ? ready / total : 1);
  const id = `ring-tip-${Math.random().toString(36).slice(2, 8)}`;
</script>

<!-- tabindex makes the tip reachable by keyboard and by tap on touch screens -->
<figure class="ring" class:ok={ok && total > 0} class:empty={total === 0} tabindex="0" aria-describedby={id}>
  <svg viewBox="0 0 80 80" width="96" height="96" aria-hidden="true">
    <circle cx="40" cy="40" r={R} class="track" />
    <circle cx="40" cy="40" r={R} class="val" stroke-dasharray="{C * frac} {C}" transform="rotate(-90 40 40)" />
    <text x="40" y="45" text-anchor="middle">{total === 0 ? '0' : ok ? '✓' : `${ready}/${total}`}</text>
  </svg>
  <figcaption>
    <strong>{label} <span class="info" aria-hidden="true">ⓘ</span></strong>
    <span class="small">{total === 0 ? 'None in your list' : ok ? 'Ready' : `${total - ready} blocking`}</span>
  </figcaption>
  <div class="tip" role="tooltip" {id}>
    <p>{description}</p>
    {#if blockers.length}
      <p class="tip-h">Blocking {label.toLowerCase()}:</p>
      <ul>
        {#each blockers.slice(0, 8) as b}<li>{b}</li>{/each}
        {#if blockers.length > 8}<li>…and {blockers.length - 8} more</li>{/if}
      </ul>
    {:else if total}
      <p class="tip-ok">Nothing blocking: every mod here has a ready build.</p>
    {/if}
  </div>
</figure>

<style>
  .ring { position: relative; margin: 0; display: flex; flex-direction: column; align-items: center; gap: 4px; text-align: center; cursor: help; outline: none; }
  .ring:focus-visible { outline: 3px solid var(--s-snap); outline-offset: 4px; }
  .track { fill: none; stroke: var(--surface-2); stroke-width: 10; }
  .val { fill: none; stroke: var(--s-not); stroke-width: 10; stroke-linecap: butt; }
  .ok .val { stroke: var(--s-ready); }
  text { font: 400 16px var(--pixel); fill: var(--text); }
  figcaption { display: flex; flex-direction: column; }
  .info { font-size: 0.8em; color: var(--muted); }
  .ok figcaption .small { color: var(--s-ready); }
  figcaption .small { color: var(--s-not); }
  .empty .val { stroke: transparent; }
  .empty figcaption .small, .empty text { color: var(--muted); fill: var(--muted); }

  .tip {
    position: absolute;
    top: 100%;
    left: 50%;
    z-index: 10;
    width: min(280px, 80vw);
    margin-top: 8px;
    padding: 10px 12px;
    text-align: left;
    font-size: 0.875rem;
    background: var(--surface);
    border: 2px solid var(--outline);
    border-radius: 3px;
    box-shadow: inset 2px 2px 0 var(--bevel-hi), 0 6px 18px rgb(0 0 0 / 0.3);
    opacity: 0;
    visibility: hidden;
    transform: translate(-50%, 4px);
    transition: opacity 0.12s, transform 0.12s, visibility 0.12s;
  }
  /* hover (mobile browsers apply :hover on tap) or keyboard focus; plain focus would leave tips stuck open */
  .ring:hover .tip,
  .ring:focus-visible .tip { opacity: 1; visibility: visible; transform: translate(-50%, 0); }
  /* keep the outer rings' tips on screen */
  .ring:first-child .tip { left: 0; transform: translate(0, 4px); }
  .ring:first-child:hover .tip,
  .ring:first-child:focus-visible .tip { transform: translate(0, 0); }
  .ring:last-child .tip { left: auto; right: 0; transform: translate(0, 4px); }
  .ring:last-child:hover .tip,
  .ring:last-child:focus-visible .tip { transform: translate(0, 0); }
  .tip p { margin: 0 0 6px; }
  .tip-h { font-weight: 700; }
  .tip-ok { color: var(--s-ready); }
  .tip ul { margin: 0; padding-left: 18px; }
  @media (prefers-reduced-motion: reduce) { .tip { transition: none; } }
</style>
