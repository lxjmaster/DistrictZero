import { defineConfig } from '@playwright/test';
import base from './playwright.config';

// Focused engine compatibility checks; viewport emulation is not real touch
// hardware, and Playwright WebKit is not the installed Safari application.
export default defineConfig({
  ...base,
  testMatch: ['game.spec.ts', 'covenants.spec.ts', 'settlement.spec.ts'],
  grep: /complete fresh-save chapter|BT-02\/03:|BT-04:|BT-05:|BT-07:|G01-10:|G03\/G07\/G09:|settlement:/,
  outputDir: './test-results/v06-compatibility',
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'test-results/v06-compatibility-report' }]],
  projects: [
    { name: 'firefox', use: { browserName: 'firefox' } },
    { name: 'webkit', use: { browserName: 'webkit' } }
  ],
  webServer: { ...base.webServer, command: 'npm run dev', url: 'http://127.0.0.1:5173', reuseExistingServer: false }
});
