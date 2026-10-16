import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { BACKUP_KEY, SAVE_KEY } from '../../src/app/storage';
import { activateNetworkRules, advance, summarize } from '../../src/game/engine';
import { decodeSave } from '../../src/game/saves';
import type { GameState } from '../../src/game/types';

const START = new Date('2026-10-16T10:00:00Z');
const saved = (page: Page): Promise<GameState> => page.evaluate(key => JSON.parse(localStorage.getItem(key)!).state, SAVE_KEY);
const click = (page: Page, name: string) => page.getByRole('button', { name, exact: true }).click();
async function seed(page: Page, elapsed = 0) {
  const raw = JSON.parse(await readFile(new URL('../fixtures/v0.3.2-chapter.json', import.meta.url), 'utf8'));
  raw.savedAt = START.getTime() - elapsed; raw.state.clock.lastAt = raw.savedAt;
  await page.addInitScript(([key, text]) => { if (!localStorage.getItem(key)) localStorage.setItem(key, text); }, [SAVE_KEY, JSON.stringify(raw)]);
  await page.clock.install({ time: START }); await page.clock.pauseAt(START); return raw;
}
function expected(raw: unknown, elapsed: number) {
  const before = decodeSave(JSON.stringify(raw)).state, after = activateNetworkRules(advance(before, elapsed), START.getTime());
  after.clock.lastAt = START.getTime(); if (elapsed) after.report = summarize(before, after, elapsed); return after;
}

test('UX15/19: six-resource reserves and all target drafts validate without changing a paused saved contract on 320px', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 }); await seed(page); await page.goto('/'); await expect(page.getByTestId('save-status')).toHaveText('已保存');
  await click(page, '夜网'); const route = page.getByTestId('route-rain'); await route.locator('summary').filter({ hasText: '货单、优先装载与本城保留量' }).click();
  for (const [name, value] of [['标准构件', '1.001'], ['雨声胶片', '2.002'], ['轨芯', '3.003']]) await page.getByLabel(`雨城保留${name}`, { exact: true }).fill(value);
  await page.getByLabel('雨城记忆目标', { exact: true }).fill('50.001'); await page.getByLabel('雨城雨声胶片目标', { exact: true }).fill('6.002');
  await page.getByLabel('雨城合同特产包数', { exact: true }).fill('3'); await page.getByLabel('雨城优先装载', { exact: true }).selectOption('specialty');
  await click(page, '保存雨城合同配置'); const before = await saved(page);
  expect(before.network.routes.rain.contract).toMatchObject({ targets: { memory: 50001, rainFilm: 6002 }, reserve: { component: 1001, rainFilm: 2002, railCore: 3003 }, manifest: { normal: 1, specialty: 3 }, order: ['specialty', 'normal'] });
  for (const [label, bad, good] of [['雨城雨声胶片目标', '6.0001', '6.002'], ['雨城缓冲周期', '0', '2'], ['雨城缓冲周期', '2.2', '2'], ['雨城合同特产包数', '33', '3']]) {
    await page.getByLabel(label, { exact: true }).fill(bad); await expect(page.getByRole('button', { name: '保存雨城合同配置', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: '暂停雨城供货合同', exact: true })).toBeEnabled(); await page.getByLabel(label, { exact: true }).fill(good);
  }
  await page.getByLabel('雨城缓冲周期', { exact: true }).fill(''); await click(page, '暂停雨城供货合同');
  expect((await saved(page)).network.routes.rain.contract).toEqual({ ...before.network.routes.rain.contract, enabled: false });
  expect((await saved(page)).network.routes.rain.trip).toEqual(before.network.routes.rain.trip); await expect(page.getByLabel('雨城缓冲周期', { exact: true })).toHaveValue('');
  await expect(page.getByRole('button', { name: '启用雨城供货合同', exact: true })).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

for (const width of [1440, 320]) test(`UX15/19: saved zero targets survive reopening and unrelated edits on ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 }); await seed(page); await page.goto('/');
  await expect(page.getByTestId('save-status')).toHaveText('已保存'); await click(page, '夜网');
  await page.getByLabel('雨城记忆目标', { exact: true }).fill('0');
  await page.getByLabel('雨城雨声胶片目标', { exact: true }).fill('0'); await click(page, '保存雨城合同配置');
  const zero = (await saved(page)).network.routes.rain.contract;
  expect(zero.enabled).toBe(true); expect(Object.values(zero.targets).every(n => n === 0)).toBe(true);
  await click(page, '工务'); await click(page, '夜网');
  await expect(page.getByLabel('雨城记忆目标', { exact: true })).toHaveValue('0');
  await expect(page.getByLabel('雨城雨声胶片目标', { exact: true })).toHaveValue('0');
  await page.getByLabel('雨城缓冲周期', { exact: true }).fill('3'); await click(page, '保存雨城合同配置');
  expect((await saved(page)).network.routes.rain.contract).toEqual({ ...zero, buffer: 3 });
  await page.reload(); await expect(page.getByTestId('save-status')).toHaveText('已保存'); await click(page, '夜网');
  await expect(page.getByLabel('雨城记忆目标', { exact: true })).toHaveValue('0');
  await click(page, '保存雨城合同配置'); expect((await saved(page)).network.routes.rain.contract).toEqual({ ...zero, buffer: 3 });
});

test('UX18/19/20: genuine schema 5 offline load, import and recovery use the old rules up to the captured time', async ({ page }, info) => {
  const elapsed = 7200517, raw = await seed(page, elapsed), wanted = expected(raw, elapsed); await page.goto('/');
  await expect(page.getByTestId('save-status')).toHaveText('已保存'); expect(await saved(page)).toEqual(wanted);
  expect(JSON.parse(await page.evaluate(key => localStorage.getItem(key)!, BACKUP_KEY)).schemaVersion).toBe(5);
  await expect(page.getByRole('alert')).toContainText('V0.3.2存档已迁移'); await click(page, '知道了');
  await click(page, '设置'); await click(page, '读取恢复副本'); await expect(page.getByRole('alert')).toContainText('已读取有效恢复副本'); expect(await saved(page)).toEqual(wanted);
  await click(page, '知道了'); await page.getByLabel('存档文本').fill(JSON.stringify(raw)); await click(page, '检查存档'); await click(page, '确认导入并替换');
  await expect(page.getByRole('alert')).toContainText('已导入存档'); expect(await saved(page)).toEqual(wanted);
  await page.reload(); await expect(page.getByTestId('save-status')).toHaveText('已保存'); expect(await saved(page)).toEqual(wanted);
  await writeFile(info.outputPath('schema5-offline-bridge.json'), JSON.stringify(wanted, null, 2));
});

test('UX18/19: interrupted old-rule settlement reloads from the original valid state and activates only after the whole interval', async ({ page }, info) => {
  const elapsed = 86400517, raw = await seed(page, elapsed), wanted = expected(raw, elapsed);
  // Fault injection holds one controller yield; it does not replace or change
  // any simulation rule. Reload exercises pagehide saving and writer handover.
  await page.addInitScript(() => {
    const Original = window.MessageChannel;
    window.MessageChannel = class extends Original {
      constructor() {
        super(); const post = this.port2.postMessage.bind(this.port2);
        this.port2.postMessage = ((value: unknown) => {
          // React also posts null through MessageChannel. Hold only the
          // controller's settlement yield so rendering remains available.
          if (value === null && new Error().stack?.includes('/src/app/controller.ts') && !sessionStorage.getItem('districtzero.test.settlement-interrupted')) {
            sessionStorage.setItem('districtzero.test.settlement-interrupted', 'yes'); (window as any).__settlementYieldHeld = true; return;
          }
          post(value);
        }) as typeof this.port2.postMessage;
      }
    };
  });
  await page.goto('/'); await page.waitForFunction(() => (window as any).__settlementYieldHeld === true);
  const inStorage = JSON.parse(await page.evaluate(key => localStorage.getItem(key)!, SAVE_KEY)); expect(inStorage.state.clock.lastAt).toBe(raw.state.clock.lastAt);
  await page.reload(); await expect(page.getByTestId('save-status')).toHaveText('已保存', { timeout: 30000 });
  const after = await saved(page); expect(after).toEqual(wanted); expect(after.network.legacyPending).toBe(false); expect(after.network.rulesSince).toBe(START.getTime());
  await writeFile(info.outputPath('interrupted-bridge.json'), JSON.stringify({ originalLastAt: raw.state.clock.lastAt, storedBeforeReload: inStorage.schemaVersion, final: after }, null, 2));
});
