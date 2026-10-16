import { completeJourneyContent } from './journey-route';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { BACKUP_KEY, SAVE_KEY } from '../../src/app/storage';
import { advance, summarize } from '../../src/game/engine';
import { decodeSave } from '../../src/game/saves';
import type { GameState } from '../../src/game/types';

test.use({ actionTimeout: 10000 });

const START = new Date('2026-10-15T08:00:00Z');
async function saved(page: Page): Promise<GameState> { return page.evaluate(key => JSON.parse(localStorage.getItem(key)!).state, SAVE_KEY); }
async function click(page: Page, name: string) { await page.getByRole('button', { name, exact: true }).click(); }
async function wait(page: Page, seconds: number) {
  const before = await saved(page); await page.clock.fastForward(seconds * 1000);
  await expect.poll(async () => (await saved(page)).clock.seconds).toBe(before.clock.seconds + seconds);
  await expect(page.getByTestId('save-status')).toHaveText('已保存');
}
async function until(page: Page, ready: (s: GameState) => boolean, label: string, maxSeconds = 3600) {
  for (let i = 0; i < maxSeconds / 10; i++) {
    if (ready(await saved(page))) return;
    await wait(page, 10);
  }
  throw new Error(`${label} did not become ready: ${JSON.stringify(await saved(page))}`);
}
async function complete(page: Page, id: string) { await until(page, s => s.completed.includes(id), id); }
async function archive(page: Page, id: string) { await page.getByTestId(`event-${id}`).getByRole('button', { name: '读完并归档' }).click(); }
async function recorders(page: Page, operation: '增加' | '减少', homeOnly = false) {
  await click(page, '经营第0街区'); await click(page, `${operation}回声居民记录员`);
  if (!homeOnly) {
    await click(page, '经营信笺里');
    await click(page, `${operation}回声居民记录员`); await click(page, `${operation}回声居民记录员`);
    await click(page, '经营第0街区');
  }
}
async function collectors(page: Page, operation: '增加' | '减少') {
  await click(page, '经营旧巷');
  await click(page, `${operation}影子居民回收工`); await click(page, `${operation}影子居民回收工`);
  await click(page, '经营第0街区');
}
async function noOverflow(page: Page) { expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); }
async function legacy(page: Page) {
  const raw = JSON.parse(await readFile(new URL('../fixtures/v0.2-chapter.json', import.meta.url), 'utf8'));
  raw.savedAt = START.getTime(); raw.state.clock.lastAt = START.getTime();
  await page.addInitScript(([key, text]) => { if (!localStorage.getItem(key)) localStorage.setItem(key, text); }, [SAVE_KEY, JSON.stringify(raw)]);
  await page.clock.install({ time: START }); await page.clock.pauseAt(START); await page.goto('/');
  await expect(page.getByTestId('save-status')).toHaveText('已保存');
  await expect(page.getByRole('alert')).toContainText('V0.2存档已迁移'); await click(page, '知道了');
  expect((await saved(page)).resources).toEqual({ ...raw.state.resources, component: 0, rainFilm: 0, railCore: 0 });
  expect(JSON.parse(await page.evaluate(key => localStorage.getItem(key)!, BACKUP_KEY)).schemaVersion).toBe(2);
}

async function networkChapter(page: Page) {
  const raw = JSON.parse(await readFile(new URL('../fixtures/v0.3-chapter.json', import.meta.url), 'utf8'));
  raw.savedAt = START.getTime(); raw.state.clock.lastAt = START.getTime();
  await page.addInitScript(([key, text]) => { if (!localStorage.getItem(key)) localStorage.setItem(key, text); }, [SAVE_KEY, JSON.stringify(raw)]);
  await page.clock.install({ time: START }); await page.clock.pauseAt(START); await page.goto('/');
  await expect(page.getByTestId('save-status')).toHaveText('已保存');
  await click(page, '夜网');
  for (const id of ['rain', 'station']) await page.getByTestId(`route-${id}`).locator('details').filter({ hasText: '货单、优先装载与本城保留量' }).locator('summary').click();
}

test('N05: three-decimal reserves save exactly on both routes and survive reload', async ({ page }) => {
  await networkChapter(page);
  for (const [id, city] of [['rain', '雨城'], ['station', '长站']] as const) {
    const before = (await saved(page)).network.routes[id];
    for (const [values, expected] of [
      [['0', '1000000', '999999.999'], { energy: 0, parts: 1000000000, memory: 999999999 }],
      [['1.001', '8.001', '0.001'], { energy: 1001, parts: 8001, memory: 1 }]
    ] as const) {
      for (const [i, resource] of ['电量', '零件', '记忆'].entries()) await page.getByLabel(`${city}保留${resource}`).fill(values[i]);
      await expect(page.getByRole('button', { name: `保存${city}合同配置`, exact: true })).toBeEnabled();
      await click(page, `保存${city}合同配置`);
      await expect.poll(async () => (await saved(page)).network.routes[id].contract).toEqual({ ...before.contract, reserve: { ...expected, component: 0, rainFilm: 0, railCore: 0 } });
    }
  }
  await page.reload(); await expect(page.getByTestId('save-status')).toHaveText('已保存'); await click(page, '夜网');
  for (const city of ['雨城', '长站']) {
    await expect(page.getByLabel(`${city}保留电量`)).toHaveValue('1.001');
    await expect(page.getByLabel(`${city}保留零件`)).toHaveValue('8.001');
    await expect(page.getByLabel(`${city}保留记忆`)).toHaveValue('0.001');
  }
});

test('N05: invalid reserve drafts block saving and enabling but allow pausing', async ({ page }) => {
  await networkChapter(page);
  const before = (await saved(page)).network.routes.rain;
  await page.getByTestId('route-rain').getByRole('button', { name: '2份', exact: true }).click();
  for (const value of ['-0.001', '1.0001', '1000000.001', '']) {
    await page.getByLabel('雨城保留电量').fill(value);
    await expect(page.getByRole('button', { name: '保存雨城合同配置', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: '暂停雨城供货合同', exact: true })).toBeEnabled();
  }
  await click(page, '暂停雨城供货合同');
  await expect.poll(async () => (await saved(page)).network.routes.rain.contract).toEqual({ ...before.contract, enabled: false });
  expect((await saved(page)).network.routes.rain.trip).toEqual(before.trip);
  await expect(page.getByLabel('雨城保留电量')).toHaveValue('');
  await expect(page.getByRole('button', { name: '启用雨城供货合同', exact: true })).toBeDisabled();
  await page.getByLabel('雨城保留电量').fill('1.0001');
  await expect(page.getByRole('button', { name: '启用雨城供货合同', exact: true })).toBeDisabled();
  await page.getByLabel('雨城保留电量').fill('1.001');
  await expect(page.getByRole('button', { name: '启用雨城供货合同', exact: true })).toBeEnabled();
  await click(page, '启用雨城供货合同');
  await expect.poll(async () => (await saved(page)).network.routes.rain.contract).toEqual({ ...before.contract, enabled: true, loads: 2, manifest: { normal: 2, specialty: 0 }, reserve: { ...before.contract.reserve, energy: 1001 } });
});

test('N05: pausing preserves saved configuration and cargo while valid drafts remain unsaved', async ({ page }) => {
  await networkChapter(page);
  const before = (await saved(page)).network.routes.station;
  await page.getByTestId('route-station').getByRole('button', { name: '1份', exact: true }).click();
  await page.getByLabel('长站保留零件').fill('80');
  await click(page, '暂停长站供货合同');
  await expect.poll(async () => (await saved(page)).network.routes.station.contract).toEqual({ ...before.contract, enabled: false });
  expect((await saved(page)).network.routes.station.trip).toEqual(before.trip);
  await expect(page.getByLabel('长站保留零件')).toHaveValue('80');
  await expect(page.getByTestId('route-station').getByRole('button', { name: '1份', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.reload(); await expect(page.getByTestId('save-status')).toHaveText('已保存'); await click(page, '夜网');
  await expect(page.getByLabel('长站保留零件')).toHaveValue('30');
  await expect(page.getByTestId('route-station').getByRole('button', { name: '2份', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect((await saved(page)).network.routes.station.contract).toEqual({ ...before.contract, enabled: false });
});

for (const [name, width, height, choice] of [['desktop', 1440, 1000, 'reliable'], ['mobile', 390, 844, 'express']] as const) {
  test(`N08/UX14-17: genuine V0.2 migration through the third chapter and complete V0.3.3 on ${name}`, async ({ page }, info) => {
    test.setTimeout(180000);
    const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
    await page.setViewportSize({ width, height }); await legacy(page);
    const start = (await saved(page)).clock.seconds, milestones: Record<string, number> = {};
    const mark = async (label: string) => { milestones[label] = (await saved(page)).clock.seconds - start; };
    await click(page, '收好报告'); await recorders(page, '减少'); await click(page, '减少影子居民回收工');
    await click(page, '夜网'); await noOverflow(page);
    await click(page, '安排修复末班车厢'); await complete(page, 'P08'); await mark('carriage'); await archive(page, 'E11');
    await click(page, '外派影子居民至雨城'); await click(page, '发车补给雨城');
    const inTransit = await saved(page), checkpoint = await page.evaluate(key => localStorage.getItem(key)!, SAVE_KEY);
    await page.reload(); await expect(page.getByTestId('save-status')).toHaveText('已保存');
    expect(await saved(page)).toEqual(inTransit);
    await click(page, '设置'); await page.getByLabel('存档文本').fill(checkpoint); await click(page, '检查存档');
    await click(page, '确认导入并替换'); await expect(page.getByRole('alert')).toContainText('已导入存档'); await click(page, '知道了');
    expect(await saved(page)).toEqual(inTransit);
    await click(page, '夜网'); await wait(page, 120); await click(page, '发车取回雨城');
    // New shipments reserve the entire destination before producers refill it.
    await recorders(page, '增加'); await wait(page, 110);
    expect((await saved(page)).network.routes.rain.trip?.spaceReserved).toBe(true);
    expect((await saved(page)).resources.memory + 12000).toBeLessThanOrEqual(80000);
    await noOverflow(page); await page.screenshot({ path: info.outputPath(`${name}-protected-cargo.png`), fullPage: true, animations: 'disabled' });
    await wait(page, 10); expect((await saved(page)).network.routes.rain.trip).toBeNull();
    expect((await saved(page)).network.routes.rain.imports).toBe(1);
    await page.reload(); await expect(page.getByTestId('save-status')).toHaveText('已保存');
    await click(page, '安排后场仓库升级'); await until(page, s => s.facilities.warehouse === 2, 'warehouse upgrade'); await mark('firstRainReturn');
    await click(page, choice === 'reliable' ? '采用稳班' : '采用快班');
    expect((await saved(page)).events.E12?.choice).toBe(choice);
    await click(page, '收好报告');
    await click(page, '夜网'); await click(page, '安排恢复长站货台'); await complete(page, 'P09'); await mark('station'); await archive(page, 'E13');
    await click(page, '经营信笺里'); await click(page, '外派回声居民至长站'); await click(page, '经营第0街区');
    await click(page, '发车补给长站'); await click(page, '安排运单规范'); await complete(page, 'R05');
    await until(page, s => !s.network.routes.station.trip, 'station supply arrival');
    await collectors(page, '减少'); await click(page, '安排联运调度'); await wait(page, 10);
    await click(page, '发车取回长站'); await complete(page, 'R06'); await until(page, s => s.network.routes.station.imports === 1, 'first station import'); await mark('firstStationReturn');
    await collectors(page, '增加');
    await until(page, s => s.resources.parts >= 200000 && s.resources.memory >= 50000, 'timetable stock');
    await click(page, '安排编定联运时刻表'); await wait(page, 10); await recorders(page, '减少');
    // Configure the upgraded station batch and change shared-fleet priority via UI.
    await page.getByTestId('route-station').getByRole('button', { name: '2份', exact: true }).click();
    for (const [id, city] of [['rain', '雨城'], ['station', '长站']] as const) {
      await page.getByTestId(`route-${id}`).locator('summary').filter({ hasText: '货单、优先装载与本城保留量' }).click();
      await page.getByLabel(`${city}保留电量`).fill('50'); await page.getByLabel(`${city}保留零件`).fill('30'); await page.getByLabel(`${city}保留记忆`).fill('10');
      await click(page, `保存${city}合同配置`); await click(page, `启用${city}供货合同`); await click(page, `开启${city}自动维护`);
    }
    await click(page, '提高长站线路优先级'); expect((await saved(page)).network.priority).toEqual(['station', 'rain']);
    await complete(page, 'P10'); await mark('timetable'); await archive(page, 'E14');
    await collectors(page, '减少');
    await click(page, '安排维护雨城线路'); await until(page, s => s.network.maintenance >= 1, 'manual route maintenance');
    await recorders(page, '增加', true);
    await until(page, s => s.network.routes.rain.imports >= 2 && s.network.routes.station.imports >= 2, 'second returns'); await mark('secondReturns');
    await collectors(page, '增加');
    await until(page, s => s.resources.parts >= 240000 && s.resources.energy >= 140000 && s.resources.memory >= 60000, 'daily train stock');
    await click(page, '安排让末班车每天抵达'); await complete(page, 'P11'); await mark('chapterEnd'); await archive(page, 'E15');
    expect((await saved(page)).completed).toEqual(expect.arrayContaining(['P08', 'P09', 'P10', 'P11', 'R05', 'R06']));
    expect(Object.values((await saved(page)).events).every(e => e.status === 'claimed')).toBe(true);
    await page.reload(); await expect(page.getByTestId('save-status')).toHaveText('已保存'); await click(page, '夜网'); await noOverflow(page);
    const text = await page.evaluate(key => localStorage.getItem(key)!, SAVE_KEY), state = decodeSave(text).state;
    expect(state.network.routes.station.contract.loads).toBe(2); expect(state.network.routes.rain.autoRepair).toBe(true);
    await writeFile(info.outputPath(`${name}-v0.3-playtest.json`), JSON.stringify({ viewport: { width, height }, choice, milestones, state }, null, 2));
    await writeFile(info.outputPath(`${name}-v0.3-save.json`), text);
    await page.screenshot({ path: info.outputPath(`${name}-v0.3-network.png`), fullPage: true, animations: 'disabled' });
    await page.getByTestId('route-rain').screenshot({ path: info.outputPath(`${name}-rain-controls.png`), animations: 'disabled' });
    await completeJourneyContent(page, info, name);
    expect(errors).toEqual([]);
  });
}

test('N07: a day offline preserves both city ledgers, cargo and the exact transport report', async ({ page }, info) => {
  const raw = JSON.parse(await readFile(new URL('../fixtures/v0.3-chapter.json', import.meta.url), 'utf8'));
  raw.savedAt = START.getTime(); raw.state.clock.lastAt = START.getTime();
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(([key, text]) => { if (!localStorage.getItem(key)) localStorage.setItem(key, text); }, [SAVE_KEY, JSON.stringify(raw)]);
  await page.clock.install({ time: START }); await page.clock.pauseAt(START); await page.goto('/');
  await expect(page.getByTestId('save-status')).toHaveText('已保存');
  const before = await saved(page); expect(before.network.routes.rain.trip).not.toBeNull();
  await page.clock.setSystemTime(new Date(before.clock.lastAt + 86400000)); await page.reload();
  await expect(page.getByTestId('save-status')).toHaveText('已保存');
  const after = await saved(page), expected = advance(before, 86400000);
  expected.clock.lastAt = before.clock.lastAt + 86400000; expected.report = summarize(before, expected, 86400000);
  expect(after).toEqual(expected); expect(decodeSave(await page.evaluate(key => localStorage.getItem(key)!, SAVE_KEY)).state).toEqual(after);
  expect(after.report!.transport.departures).toBeGreaterThan(0); expect(after.report!.transport.deliveries).toBeGreaterThan(0);
  await expect(page.getByRole('region', { name: '返回报告' })).toContainText(`列车发车 ${after.report!.transport.departures} 次，到货 ${after.report!.transport.deliveries} 次`);
  await writeFile(info.outputPath('v0.3-offline-report.json'), JSON.stringify(after.report, null, 2));
  await page.reload(); await expect(page.getByTestId('save-status')).toHaveText('已保存'); expect(await saved(page)).toEqual(after);
  expect(errors).toEqual([]);
});
