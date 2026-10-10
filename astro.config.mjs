import { defineConfig } from 'astro/config';
import svelte from '@astrojs/svelte';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://mcmodsready.com',
  integrations: [
    svelte(),
    // /m is the live lookup page (noindex); 404 is not a page
    sitemap({ filter: (url) => !/\/(m|404)$/.test(url) }),
  ],
  trailingSlash: 'never',
  build: { format: 'file' },
});
