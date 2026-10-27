import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  // Playwright clears this directory before a run. Keep reproducible analyses
  // and publication evidence outside the disposable browser-test subtree.
  outputDir: './test-results/browser',
  timeout: 90000,
  expect: { timeout: 10000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL: 'http://127.0.0.1:5173', browserName: 'chromium', trace: 'retain-on-failure' },
  webServer: { command: 'npm run dev', url: 'http://127.0.0.1:5173', reuseExistingServer: !process.env.CI }
});
