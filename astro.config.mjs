import { defineConfig } from 'astro/config';
import svelte from '@astrojs/svelte';

export default defineConfig({
  // TODO: confirm once the domain is bought
  site: 'https://mcmodsready.com',
  integrations: [svelte()],
  trailingSlash: 'never',
  build: { format: 'file' },
});
