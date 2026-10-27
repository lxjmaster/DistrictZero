// Verify an already running local production preview using isolated browsers.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';

const baseURL = 'http://127.0.0.1:4173/DistrictZero/';
const root = fileURLToPath(new URL('../', import.meta.url));
const resultsDirectory = join(root, 'test-results');
await mkdir(resultsDirectory, { recursive: true });
// Never overwrite a previous preview, including an incomplete earlier run.
const runDirectory = process.argv[2] ? resolve(process.argv[2]) : await mkdtemp(join(resultsDirectory, 'v061-preview-run-'));
if (process.argv[2]) await mkdir(runDirectory);
const directory = pathToFileURL(runDirectory + sep);
console.log(`Preview evidence directory: ${runDirectory}`);

// Check the server's actual HTML and referenced assets against this build.
// Schema and balance alone do not identify the JavaScript being exercised.
const html = await readFile(join(root, 'dist', 'index.html'));
const markup = html.toString('utf8');
const script = markup.match(/<script\b[^>]*\bsrc="([^"]+)"/)?.[1];
const stylesheet = markup.match(/<link\b(?=[^>]*\brel="stylesheet")[^>]*\bhref="([^"]+)"/)?.[1];
const icon = markup.match(/<link\b(?=[^>]*\brel="icon")[^>]*\bhref="([^"]+)"/)?.[1];
assert(script && stylesheet && icon, 'Production HTML must reference JavaScript, stylesheet and icon');
const resources = [];
for (const [name, path] of [['index.html', baseURL], ['javascript', script], ['stylesheet', stylesheet], ['icon', icon]]) {
  const url = new URL(path, baseURL);
  assert.equal(url.origin, new URL(baseURL).origin);
  assert(url.pathname.startsWith('/DistrictZero/') && !url.search && !url.hash, `Unexpected build resource ${url}`);
  const relative = name === 'index.html' ? 'index.html' : decodeURIComponent(url.pathname.slice('/DistrictZero/'.length));
  const local = name === 'index.html' ? html : await readFile(join(root, 'dist', relative));
  const response = await fetch(url, { cache: 'no-store' });
  assert.equal(response.status, 200, `Preview returned ${response.status} for ${url}`);
  assert.equal(response.url, url.href, `Unexpected preview redirect for ${url}`);
  const served = Buffer.from(await response.arrayBuffer());
  assert(served.equals(local), `Preview resource does not match dist: ${url}`);
  resources.push({ name, path: url.pathname, sha256: createHash('sha256').update(served).digest('hex'), bytes: served.length });
}
const now = Date.parse('2026-10-27T06:00:00Z'), key = 'districtzero.save.v1';
const results = [], browser = await chromium.launch();
try {
  for (const mobile of [false, true]) for (const kind of ['new', 'ready']) {
    const context = await browser.newContext({ viewport: mobile ? { width: 320, height: 740 } : { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
    try {
      const page = await context.newPage(), errors = [];
      page.on('pageerror', e => errors.push(e.message));
      page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
      await page.clock.install({ time: new Date(now) }); await page.clock.pauseAt(new Date(now));
      if (kind === 'ready') {
        const raw = JSON.parse(await readFile(new URL('../tests/fixtures/v0.6-ready.json', import.meta.url), 'utf8'));
        raw.savedAt = raw.state.clock.lastAt = now;
        await page.addInitScript(({ key, raw }) => { if (!localStorage.getItem(key)) localStorage.setItem(key, raw); }, { key, raw: JSON.stringify(raw) });
      }
      await page.goto(baseURL); await page.getByTestId('save-status').filter({ hasText: /^已保存$/ }).waitFor();
      const before = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), key);
      assert.equal(before.schemaVersion, 10); assert.equal(before.balanceVersion, '0.6.1');
      if (kind === 'ready') {
        await page.getByRole('button', { name: '档案', exact: true }).click();
        const card = page.getByTestId('archive-A04');
        await card.getByRole('button', { name: '交接并收藏', exact: true }).click();
        await card.getByRole('button', { name: '确认交接A04', exact: true }).focus(); await page.keyboard.press('Enter');
        assert((await card.textContent()).includes('回执会一直留在这里。'));
        const after = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), key);
        const expected = structuredClone(before.state);
        for (const [resource, amount] of Object.entries({ memory: 4000, component: 1000, rainFilm: 2000, railCore: 2000 })) { expected.resources[resource] -= amount; expected.ledger.fulfillment[resource] += amount; }
        expected.experience.archives.push('A04'); expected.history = after.state.history;
        assert.deepEqual(after.state, expected);
        await card.screenshot({ path: fileURLToPath(new URL(`${mobile ? 'mobile' : 'desktop'}-a04.png`, directory)) });
        await page.reload(); await page.getByTestId('save-status').filter({ hasText: /^已保存$/ }).waitFor();
        assert.deepEqual(await page.evaluate(key => JSON.parse(localStorage.getItem(key)).state, key), after.state);
      }
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      assert.deepEqual(errors, []); results.push({ mobile, kind, schema: before.schemaVersion, balance: before.balanceVersion, pass: true });
    } finally { await context.close(); }
  }
  await writeFile(new URL('results.json', directory), JSON.stringify({ baseURL, resources, results }, null, 2), { flag: 'wx' });
  console.log(JSON.stringify({ resources, results }));
} finally { await browser.close(); }
