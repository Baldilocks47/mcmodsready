<script lang="ts">
  import type { Status } from '../lib/core/types';
  import { STATUS } from '../lib/ui/status';

  let {
    status,
    short = false,
    title = '',
    upcoming = false,
  }: { status: Status; short?: boolean; title?: string; upcoming?: boolean } = $props();

  // Before a drop is released, "not yet" is the normal state: show it neutrally.
  const waiting = $derived(upcoming && status === 'not_yet');
  const s = $derived(waiting ? { icon: '…', label: 'Waiting', short: 'Waiting', hint: 'Not released yet; no snapshot build declared' } : STATUS[status]);
</script>

<span class="chip s-{waiting ? 'not_applicable' : status}" title={title || s.hint}><span class="i" aria-hidden="true">{s.icon}</span>{short ? s.short : s.label}</span>
