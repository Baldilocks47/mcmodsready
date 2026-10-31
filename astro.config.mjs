import { defineConfig } from 'astro/config';
import svelte from '@astrojs/svelte';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://mcmodsready.com',
  integrations: [
    svelte(),
    // /m is the live lookup page (noindex), /report only redirects to the latest report
    sitemap({ filter: (url) => !/\/(m|404|report)$/.test(url) }),
  ],
  trailingSlash: 'never',
  build: { format: 'file' },
});
