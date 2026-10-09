import type { ManifestVersion } from '../src/lib/core/versions';

export const MANIFEST_URL = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';

export interface Manifest {
  latest: { release: string; snapshot: string };
  versions: ManifestVersion[];
}

export async function fetchManifest(): Promise<Manifest> {
  const res = await fetch(MANIFEST_URL);
  if (!res.ok) throw new Error(`Mojang manifest ${res.status}`);
  return (await res.json()) as Manifest;
}
