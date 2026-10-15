import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { SAVE_KEY, BACKUP_KEY } from '../../src/app/storage';
import { advance } from '../../src/game/engine';
import { decodeSave, encodeSave } from '../../src/game/saves';
import type { GameState } from '../../src/game/types';

const START = new Date('2026-10-14T08:00:00Z');
test('C01/FR-11: invalid report completions recover or reject import without a blank page', async ({ page }) => {
  const state = decodeSave(await readFile(new URL('../fixtures/v0.1-chapter.json', import.meta.url), 'utf8')).state;
  state.clock.lastAt = START.getTime();
  const valid = encodeSave(state, START.getTime()), broken = JSON.parse(valid), errors: string[] = [];
  broken.state.report.completed = ['district-9/build:dorm:1', 'public:unknown'];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(([primary, backup, text, recovery]) => {
    if (!localStorage.getItem(primary)) { localStorage.setItem(primary, text); localStorage.setItem(backup, recovery); }
  }, [SAVE_KEY, BACKUP_KEY, JSON.stringify(broken), valid]);
  await page.clock.install({ time: START }); await page.clock.pauseAt(START); await page.goto('/');
  await expect(page.getByTestId('save-status')).toHaveText('已保存');
  await expect(page.getByRole('alert')).toContainText('有效恢复副本');
  await expect(page.getByRole('region', { name: '返回报告' })).toContainText('修复旧站台');
  expect((await saved(page)).resources).toEqual(state.resources); expect((await saved(page)).report).toEqual(state.report);
  await click(page, '知道了'); await click(page, '设置');
  const primaryBefore = await page.evaluate(key => localStorage.getItem(key), SAVE_KEY);
  const backupBefore = await page.evaluate(key => localStorage.getItem(key), BACKUP_KEY);
  for (const key of ['district-9/build:dorm:1', 'public:unknown']) {
    broken.state.report.completed = [key];
    await page.getByLabel('存档文本').fill(JSON.stringify(broken)); await click(page, '检查存档');
    await expect(page.getByRole('alert')).toContainText('报告完工记录');
    await expect(page.getByRole('heading', { name: '检查通过 · 等待确认' })).not.toBeVisible();
    expect(await page.evaluate(key => localStorage.getItem(key), SAVE_KEY)).toBe(primaryBefore);
    expect(await page.evaluate(key => localStorage.getItem(key), BACKUP_KEY)).toBe(backupBefore);
  }
  expect(errors).toEqual([]);
});
async function saved(page: Page): Promise<GameState> { return page.evaluate(key => JSON.parse(localStorage.getItem(key)!).state, SAVE_KEY); }
async function click(page: Page, name: string) { await page.getByRole('button', { name, exact: true }).click(); }
async function wait(page: Page, seconds: number) {
  const before = await saved(page); await page.clock.fastForward(seconds * 1000);
  await expect.poll(async () => (await saved(page)).clock.seconds).toBe(before.clock.seconds + seconds);
  await expect(page.getByTestId('save-status')).toHaveText('已保存');
}
async function allocation(page: Page, operation: '增加' | '减少', type: '影子' | '回声', job: string) { await click(page, `${operation}${type}居民${job}`); }
async function lighting(page: Page, policy: string) { await click(page, `切换${policy}`); await click(page, '确认切换'); }
async function stockDoesNotOverflow(page: Page) { expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); }
async function legacy(page: Page) {
  const raw = JSON.parse(await readFile(new URL('../fixtures/v0.1-chapter.json', import.meta.url), 'utf8'));
  raw.savedAt = START.getTime(); raw.state.clock.lastAt = START.getTime();
  await page.addInitScript(([key, text]) => { if (!localStorage.getItem(key)) localStorage.setItem(key, text); }, [SAVE_KEY, JSON.stringify(raw)]);
  await page.clock.install({ time: START }); await page.clock.pauseAt(START); await page.goto('/');
  await expect(page.getByTestId('save-status')).toHaveText('已保存');
  await expect(page.getByRole('alert')).toContainText('V0.1存档已迁移'); await click(page, '知道了');
  return raw;
}
async function secondChapter(page: Page) {
  const start = (await saved(page)).clock.seconds, milestones: Record<string, number> = {};
  const mark = async (name: string) => { milestones[name] = (await saved(page)).clock.seconds - start; };
  await click(page, '安排测绘没有尽头的旧巷'); await wait(page, 380); await mark('alley');
  await click(page, '安排为信笺里补上门牌'); await wait(page, 10);
  await page.getByTestId('event-E06').getByRole('button', { name: '领取并归档' }).click();
  await wait(page, 450); await mark('letters'); await click(page, '共用一盏灯');
  expect((await saved(page)).events.E07?.choice).toBe('common');
  await click(page, '安排夜居民宿舍升级'); await click(page, '安排手摇发电机升级'); await wait(page, 250);
  await allocation(page, '增加', '影子', '发电工'); await wait(page, 120);
  await allocation(page, '增加', '回声', '维修工');

  await click(page, '经营旧巷'); await click(page, '安排夜居民宿舍建设'); await click(page, '安排回收棚建设'); await wait(page, 100);
  await lighting(page, '暗灯'); await click(page, '安排夜居民宿舍升级'); await click(page, '安排回收棚升级'); await wait(page, 110);
  await click(page, '经营信笺里'); await click(page, '安排夜居民宿舍建设'); await click(page, '安排回声信箱建设'); await wait(page, 120);
  await lighting(page, '明灯'); await click(page, '安排夜居民宿舍升级'); await click(page, '安排回声信箱升级'); await wait(page, 140);
  await wait(page, 400); await mark('housingAndResidents');
  expect((await saved(page)).city.districts['district-1']!.population.shadow).toBeGreaterThanOrEqual(2);
  expect((await saved(page)).city.districts['district-2']!.population.echo).toBeGreaterThanOrEqual(2);
  await allocation(page, '增加', '回声', '记录员'); await allocation(page, '增加', '回声', '记录员');
  await click(page, '经营旧巷'); await allocation(page, '增加', '影子', '回收工'); await allocation(page, '增加', '影子', '回收工');
  await page.getByLabel('模板名称').fill('旧巷回收班'); await click(page, '保存当前安排');
  await lighting(page, '常灯'); const beforeApply = await saved(page); await click(page, '应用模板旧巷回收班');
  const applied = await saved(page); expect(applied.resources.parts).toBe(beforeApply.resources.parts - 5000); expect(applied.city.districts['district-1']!.lighting).toBe('dim');
  await click(page, '夜城'); await expect(page.getByTestId('district-district-1')).toContainText('回收街区'); await expect(page.getByTestId('district-district-2')).toContainText('记录街区'); await stockDoesNotOverflow(page);
  // Move a spare resident through the actual map controls; keep specialists working.
  await click(page, '迁居回声居民至信笺里');
  expect((await saved(page)).city.districts['district-2']!.population.echo).toBeGreaterThanOrEqual(3);

  await click(page, '经营第0街区'); await click(page, '经营');
  await click(page, '安排建设配电亭'); await click(page, '安排建设门牌事务所'); await wait(page, 110);
  await page.getByTestId('event-E08').getByRole('button', { name: '领取并归档' }).click();
  await wait(page, 140); await mark('publicWorks');
  await expect(page.getByTestId('public-relay')).toContainText('供电运行'); await expect(page.getByTestId('public-registry')).toContainText('供电运行');
  await click(page, '档案'); await click(page, '安排巡检手册'); await wait(page, 150);
  await click(page, '安排地址索引'); await wait(page, 130); await mark('newStudies');
  await click(page, '经营'); await click(page, '开启本区自动巡检');
  await click(page, '工务'); await click(page, '安排编成夜城地址簿'); await wait(page, 310); await mark('addressBook');
  await click(page, '安排接通雨城联络线'); await wait(page, 10);
  await page.getByTestId('event-E09').getByRole('button', { name: '领取并归档' }).click();
  await wait(page, 390); await mark('externalLine');
  await page.getByTestId('event-E10').getByRole('button', { name: '读完并归档' }).click();
  let state = await saved(page); expect(state.completed).toEqual(expect.arrayContaining(['P04', 'P05', 'P06', 'P07', 'R03', 'R04']));
  expect(Object.values(state.events).every(e => e.status === 'claimed')).toBe(true);
  await wait(page, 900); await mark('automaticMaintenance'); state = await saved(page);
  expect(state.city.maintenance).toBeGreaterThanOrEqual(2); expect(state.report!.maintenance).toBeGreaterThanOrEqual(2);
  await click(page, '夜城'); await expect(page.getByRole('heading', { name: '第0街区 ── 雨城 · 已接通' })).toBeVisible(); await stockDoesNotOverflow(page);
  await page.reload(); await expect(page.getByTestId('save-status')).toHaveText('已保存');
  expect((await saved(page)).city.templates[0].name).toBe('旧巷回收班'); expect((await saved(page)).autoRepair).toBe(true);
  return { milestones, state: await saved(page) };
}
for (const [name, width, height] of [['desktop', 1440, 1000], ['mobile', 390, 844]] as const) {
  test(`C08: V0.1 migration to the complete second chapter through ${name} UI`, async ({ page }, info) => {
    await page.setViewportSize({ width, height }); const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
    const raw = await legacy(page);
    expect((await saved(page)).resources).toEqual({ ...raw.state.resources, component: 0 }); expect((await saved(page)).clock.seconds).toBe(raw.state.clock.seconds);
    const backup = await page.evaluate(key => localStorage.getItem(key)!, BACKUP_KEY); expect(JSON.parse(backup).schemaVersion).toBe(1); expect(decodeSave(backup).state.resources).toEqual({ ...raw.state.resources, component: 0 });
    const result = await secondChapter(page);
    await writeFile(info.outputPath(`${name}-v0.2-playtest.json`), JSON.stringify({ viewport: { width, height }, ...result }, null, 2));
    await click(page, '夜城');
    await page.screenshot({ path: info.outputPath(`${name}-v0.2-city.png`), fullPage: true, animations: 'disabled' });
    await click(page, '经营旧巷'); await click(page, '经营'); await stockDoesNotOverflow(page);
    await page.screenshot({ path: info.outputPath(`${name}-v0.2-specialty.png`), fullPage: true, animations: 'disabled' });
    expect(errors).toEqual([]);
  });
}
test('C05/07: offline public maintenance uses the same engine and saves the exact report', async ({ page }) => {
  await legacy(page); await secondChapter(page); const before = await saved(page);
  await page.clock.setSystemTime(new Date(before.clock.lastAt + 86400000)); await page.reload();
  await expect(page.getByTestId('save-status')).toHaveText('已保存');
  const after = await saved(page), expected = advance(before, 86400000);
  expect(after.resources).toEqual(expected.resources); expect(after.ledger).toEqual(expected.ledger); expect(after.city).toEqual(expected.city);
  expect(after.report!.maintenance).toBe(expected.city.maintenance - before.city.maintenance); expect(after.report!.seconds).toBe(86400);
});
