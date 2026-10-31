import { defineConfig } from '@playwright/test';

// Runs against the built site with fixture data: npm run build:fixtures && npm run e2e
export default defineConfig({
  testDir: 'e2e',
  retries: process.env.CI ? 1 : 0,
  use: { baseURL: 'http://localhost:4322' },
  webServer: { command: 'node e2e/serve.mjs', url: 'http://localhost:4322', reuseExistingServer: false },
});
