<script lang="ts">
  import type { Drop, GameVersion } from '../lib/core/types';

  let {
    drops,
    versions,
    value,
    onchange,
    id = 'target',
    showSnapshots = false,
  }: { drops: Drop[]; versions: GameVersion[]; value: string; onchange: (v: string) => void; id?: string; showSnapshots?: boolean } = $props();

  const windowIds = $derived(new Set(drops.map((d) => d.id)));
  const releases = $derived(versions.filter((v) => v.type === 'release'));
  const recent = $derived(releases.filter((v) => v.drop && windowIds.has(v.drop)));
  const legacy = $derived(releases.filter((v) => !(v.drop && windowIds.has(v.drop))));
  const snapshots = $derived(versions.filter((v) => v.type === 'snapshot'));
  // keep the selected snapshot visible even when snapshots are hidden
  const selectedSnapshot = $derived(snapshots.find((v) => `v:${v.id}` === value));
</script>

<select {id} {value} onchange={(e) => onchange(e.currentTarget.value)}>
  <optgroup label="Minecraft drops (any patch)">
    {#each drops as d}<option value="d:{d.id}">{d.id}{d.upcoming ? ' (upcoming)' : ''}</option>{/each}
  </optgroup>
  <optgroup label="Exact version">
    {#each recent as v}<option value="v:{v.id}">{v.id}</option>{/each}
  </optgroup>
  <optgroup label="Older versions">
    {#each legacy as v}<option value="v:{v.id}">{v.id}</option>{/each}
  </optgroup>
  {#if showSnapshots}
    <optgroup label="Snapshots, pre-releases, RCs">
      {#each snapshots as v}<option value="v:{v.id}">{v.id}</option>{/each}
    </optgroup>
  {:else if selectedSnapshot}
    <option value="v:{selectedSnapshot.id}">{selectedSnapshot.id}</option>
  {/if}
</select>
