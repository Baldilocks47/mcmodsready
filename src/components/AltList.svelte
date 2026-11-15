<script lang="ts">
  import type { AltRef } from '../lib/core/types';
  import { ALT_REASON, altNeedsCaveat } from '../lib/ui/status';

  let { alts, titleOf = () => undefined }: { alts: AltRef[]; titleOf?: (slug: string) => string | undefined } = $props();
</script>

{#each alts as a, i}
  {i ? ', ' : ''}<a href="/mod/{a.slug}" title={a.note ?? ''}>{a.title ?? titleOf(a.slug) ?? a.slug}</a> <span class="muted">({ALT_REASON[a.reason ?? (a.curated ? 'curated' : 'similar')]})</span>
{/each}
{#if altNeedsCaveat(alts)}<span class="muted"> Check features before switching.</span>{/if}
