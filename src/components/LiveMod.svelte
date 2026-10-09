<script lang="ts">
  import { onMount } from 'svelte';
  import type { Drop, GameVersion, Loader, ModFile } from '../lib/core/types';
  import { loadMods, liveMods } from '../lib/ui/data';
  import ModView from './ModView.svelte';

  let { drops, versions, popularLegacy }: { drops: Drop[]; versions: GameVersion[]; popularLegacy: Record<Loader, string[]> } = $props();

  let mod = $state<ModFile | null>(null);
  let missing = $state('');

  onMount(async () => {
    const key = new URLSearchParams(location.search).get('p')?.trim() ?? '';
    if (!key) return (missing = 'No mod given.');
    try {
      // slug or id: find the project on Modrinth, then prefer our precomputed copy if we have one
      const live = (await liveMods([key])).get(key);
      if (!live) return (missing = `Couldn't find "${key}" on Modrinth.`);
      mod = (await loadMods([live.id])).get(live.id) ?? live;
      document.title = `Is ${mod.title} updated for the latest Minecraft?`;
    } catch {
      missing = "Couldn't reach Modrinth. Try again in a moment.";
    }
  });
</script>

{#if mod}
  <ModView {mod} {drops} {versions} {popularLegacy} />
{:else if missing}
  <h1>Mod not found</h1>
  <p>{missing} Try <a href="/list">searching in the list checker</a>.</p>
{:else}
  <p class="muted">Looking up this mod on Modrinth…</p>
{/if}
