import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { SAVE_KEY } from '../../src/app/storage';
import { advance, applyAction } from '../../src/game/engine';
import { decodeSave, encodeSave } from '../../src/game/saves';
import type { GameState, RadioChoice } from '../../src/game/types';

const START = new Date('2026-10-15T10:00:00Z');
async function saved(page: Page): Promise<GameState> { return page.evaluate(key => JSON.parse(localStorage.getItem(key)!).state, SAVE_KEY); }
async function click(page: Page, name: string) { await page.getByRole('button', { name, exact: true }).click(); }
async function wait(page: Page, seconds: number) {
  const before = await saved(page); await page.clock.fastForward(seconds * 1000);
  await expect.poll(async () => (await saved(page)).clock.seconds).toBe(before.clock.seconds + seconds);
  await expect(page.getByTestId('save-status')).toHaveText('已保存');
}
async function load(page: Page, text?: string) {
  if (text) await page.addInitScript(([key, raw]) => { if (!localStorage.getItem(key)) localStorage.setItem(key, raw); }, [SAVE_KEY, text]);
  await page.clock.install({ time: START }); await page.clock.pauseAt(START); await page.goto('/');
  await expect(page.getByTestId('save-status')).toHaveText('已保存');
}
async function legacy(page: Page, version: 1 | 2 = 1) {
  const raw = JSON.parse(await readFile(new URL(`../fixtures/v0.${version}-chapter.json`, import.meta.url), 'utf8'));
  raw.savedAt = START.getTime(); raw.state.clock.lastAt = START.getTime();
  await load(page, JSON.stringify(raw)); await click(page, '知道了'); await click(page, '收好报告');
}
async function plan(page: Page, target: string) {
  await page.getByLabel('构件目标', { exact: true }).fill(target);
  await page.getByLabel('零件保留', { exact: true }).fill('20');
  await page.getByLabel('电量保留', { exact: true }).fill('10');
  await click(page, '保存并启用装配');
}
async function noOverflow(page: Page) { expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); }

for (const [device, width, height] of [['desktop', 1440, 1000], ['mobile', 390, 844]] as const) {
  for (const choice of ['dismantle', 'restore'] as RadioChoice[]) {
    test(`UX03/04/06/07/21: ${choice} story, assembly, modification and prefabrication through ${device} UI`, async ({ page }, info) => {
      await page.setViewportSize({ width, height }); const errors: string[] = [];
      page.on('pageerror', e => errors.push(e.message)); await legacy(page);
      const start = await saved(page), stages: Record<string, GameState> = {};
      await expect(page.getByTestId('component-stock')).toHaveCount(0);
      await click(page, '读完装配纸条');
      await expect(page.getByTestId('component-stock')).toHaveText('0 / 40');
      expect((await saved(page)).experience.assembly.enabled).toBe(false);
      if (device === 'mobile') {
        await click(page, '安排人手'); await expect(page.locator('#workers')).toBeFocused();
        await page.getByRole('button', { name: /^待处理/ }).click(); await expect(page.locator('#pending-matters')).toBeFocused();
      }
      await click(page, '减少回声居民记录员'); await click(page, '增加回声居民装配工');
      await expect(page.getByRole('button', { name: '增加影子居民维修工', exact: true })).toBeDisabled();
      await plan(page, '5');
      if (choice === 'restore') { await wait(page, 50); await click(page, '修复收音机'); }
      else await click(page, '拆解收音机');
      for (const node of ['L01-3', 'L01-4']) await page.getByTestId(`story-${node}`).getByRole('button', { name: '读完住客回信' }).click();
      await wait(page, choice === 'restore' ? 250 : 150);
      expect((await saved(page)).resources.component).toBe(5000); stages.ready = await saved(page);
      await expect(page.getByRole('region', { name: '构件装配', exact: true })).toContainText('达到构件目标');
      await expect(page.getByTestId('street-scene')).toContainText(choice === 'restore' ? '窗边收音机' : '工具盒');
      await expect(page.getByTestId('street-scene').getByRole('img')).toHaveAttribute('aria-label', new RegExp(choice === 'restore' ? '声音留了下来' : '工具盒'));
      await click(page, '暂停装配');
      const mod = choice === 'dismantle' ? '快速夹具' : '节料台面';
      await click(page, `制作${mod}`); await wait(page, 50); stages.modBuilt = await saved(page);
      await click(page, `启用${mod}`); await plan(page, '4'); await wait(page, 10); await click(page, '暂停装配');
      stages.modUsed = await saved(page);
      expect(stages.modUsed.resources.component - stages.modBuilt.resources.component).toBe(choice === 'dismantle' ? 300 : 150);
      await page.getByLabel('测绘没有尽头的旧巷预制份数').selectOption('3');
      const quote = page.getByTestId('project-P04');
      await expect(quote).toContainText('76 零件'); await expect(quote).toContainText('270 点工程');
      await click(page, '安排测绘没有尽头的旧巷');
      expect((await saved(page)).resources.component).toBe(stages.modUsed.resources.component);
      await click(page, '工务'); await wait(page, 10);
      let s = await saved(page); expect(s.queue[0].prefab).toBe(3); expect(s.queue[0].reserved.component).toBe(3000);
      await expect(page.getByTestId('street-scene')).toContainText('施工中'); await click(page, '暂停');
      const paused = (await saved(page)).queue;
      await page.reload(); await expect(page.getByTestId('save-status')).toHaveText('已保存');
      await click(page, '工务'); await wait(page, 20); expect((await saved(page)).queue).toEqual(paused);
      await click(page, '继续'); await wait(page, 220); s = await saved(page); stages.prefabComplete = s;
      expect(s.completed).toContain('P04'); expect(s.queue).toHaveLength(0);
      await expect(page.locator('.completed-projects')).not.toHaveAttribute('open', '');
      await click(page, '查看旧物：' + (choice === 'restore' ? '窗边收音机' : '外壳有新用途'));
      await expect(page.getByRole('region', { name: '住客档案', exact: true })).toContainText(choice === 'restore' ? '未登记的半层' : '站台储物柜');
      await click(page, '经营'); await noOverflow(page);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      expect(await page.locator('.street-scene svg').evaluate(el => getComputedStyle(el).animationName)).toBe('none');
      await page.screenshot({ path: info.outputPath(`${device}-${choice}.png`), fullPage: true, animations: 'disabled' });
      await page.getByTestId('street-scene').screenshot({ path: info.outputPath('street-scene.png') });
      await page.getByRole('region', { name: '构件装配', exact: true }).screenshot({ path: info.outputPath('assembly.png') });
      if (device === 'mobile') {
        expect(await page.locator('.stepper button,.scene-destinations button,.mobile-actions button').evaluateAll(elements => elements.every(el => el.getBoundingClientRect().height >= 44))).toBe(true);
        await page.setViewportSize({ width: 320, height: 740 }); await noOverflow(page);
      }
      await writeFile(info.outputPath('route.json'), JSON.stringify({ device, choice, start, stages }, null, 2));
      expect(errors).toEqual([]);
    });
  }
}

test('UX06/07: fresh-save paper waits for E01 and streetscape changes with real construction', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await load(page);
  await expect(page.getByTestId('street-scene')).toContainText('待修复');
  await expect(page.getByRole('region', { name: '构件装配', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '增加影子居民装配工', exact: true })).toHaveCount(0);
  await click(page, '安排让临时路灯亮起'); await wait(page, 25);
  await click(page, '减少影子居民回收工'); await click(page, '增加影子居民维修工'); await wait(page, 60);
  await expect(page.getByTestId('street-scene')).toContainText('亮着');
  await expect(page.getByTestId('story-L01-1')).toHaveCount(0);
  await page.getByTestId('event-E01').getByRole('button', { name: '领取并归档' }).click();
  await click(page, '读完装配纸条'); await expect(page.getByTestId('story-L01-2')).toBeVisible();
  await expect(page.getByRole('button', { name: '修复收音机', exact: true })).toBeDisabled();
  await noOverflow(page);
});

test('UX08/20: offline report leads with actual assembly outcome and keeps story decisions pending', async ({ page }) => {
  let s = decodeSave(await readFile(new URL('../fixtures/v0.1-chapter.json', import.meta.url), 'utf8')).state;
  // Preparation uses public engine actions; the browser still performs offline settlement.
  for (const action of [
    { type: 'story', node: 'L01-1' }, { type: 'assign', resident: 'echo', job: 'record', delta: -1 },
    { type: 'assign', resident: 'echo', job: 'assemble', delta: 1 },
    { type: 'assembly-plan', enabled: true, target: 5000, reserve: { energy: 10000, parts: 20000, memory: 0, component: 0, rainFilm: 0, railCore: 0 } }
  ] as const) { const result = applyAction(s, action); expect(result.error).toBeNull(); s = result.state; }
  s.clock.lastAt = START.getTime() - 900000; s.report = null;
  const expected = advance(s, 900000); await load(page, encodeSave(s, s.clock.lastAt));
  expect((await saved(page)).resources).toEqual(expected.resources);
  const report = page.getByRole('region', { name: '返回报告', exact: true });
  await expect(report.locator('.report-highlights')).toContainText('备好了 5 构件');
  await expect(report).toContainText('住客还留了新的话');
  await expect(report.locator('details')).not.toHaveAttribute('open', '');
  expect((await saved(page)).experience.story['L01-2']).toBeUndefined();
  await report.getByText('展开详细账本与完工记录', { exact: true }).click();
  await expect(report.locator('.report-resources')).toContainText('标准构件');
  await click(page, '收好报告'); await page.reload();
  await expect(page.getByTestId('save-status')).toHaveText('已保存');
  expect((await saved(page)).resources.component).toBe(5000);
  expect((await saved(page)).experience.story['L01-2']).toBeUndefined();
});

test('UX02/06: decimal plans save precisely and pausing preserves the last valid configuration', async ({ page }) => {
  await legacy(page); await click(page, '读完装配纸条');
  await page.getByLabel('构件目标', { exact: true }).fill('1.001');
  await page.getByLabel('零件保留', { exact: true }).fill('8.001');
  await page.getByLabel('电量保留', { exact: true }).fill('0.001');
  await click(page, '保存并启用装配');
  const expected = { enabled: true, target: 1001, reserve: { energy: 1, parts: 8001, memory: 0, component: 0, rainFilm: 0, railCore: 0 } };
  expect((await saved(page)).experience.assembly).toEqual(expected);
  await page.getByLabel('构件目标', { exact: true }).fill('');
  await expect(page.getByRole('button', { name: '保存并启用装配', exact: true })).toBeDisabled();
  await click(page, '暂停装配'); expect((await saved(page)).experience.assembly).toEqual({ ...expected, enabled: false });
  await page.reload(); await expect(page.getByTestId('save-status')).toHaveText('已保存');
  await expect(page.getByLabel('构件目标', { exact: true })).toHaveValue('1.001');
  await expect(page.getByLabel('零件保留', { exact: true })).toHaveValue('8.001');
  await expect(page.getByLabel('电量保留', { exact: true })).toHaveValue('0.001');
});

test('UX06/21: prefab choices reset across districts and upgrade levels while queued choices stay fixed', async ({ page }) => {
  await legacy(page, 2); await click(page, '读完装配纸条'); await click(page, '拆解收音机');
  const dorm = page.getByLabel('夜居民宿舍 · 3级预制份数', { exact: true });
  await dorm.selectOption('1'); await click(page, '经营旧巷'); await expect(dorm).toHaveValue('0');
  await dorm.selectOption('1'); await click(page, '经营第0街区'); await expect(dorm).toHaveValue('0');
  await click(page, '经营旧巷'); await expect(dorm).toHaveValue('0');
  await dorm.selectOption('1'); await click(page, '安排夜居民宿舍升级');
  await expect.poll(async () => (await saved(page)).queue[0]?.prefab).toBe(1);
  await click(page, '经营第0街区'); await expect(dorm).toHaveValue('0');
  expect((await saved(page)).queue[0]).toMatchObject({ district: 'district-1', definition: 'build:dorm', prefab: 1 });
  await wait(page, 50);
  await page.getByLabel('维修台 · 2级预制份数', { exact: true }).selectOption('1');
  await click(page, '安排维修台升级'); await wait(page, 50);
  expect((await saved(page)).facilities.workbench).toBe(2);
  await expect(page.getByLabel('维修台 · 3级预制份数', { exact: true })).toHaveValue('0');
  await click(page, '安排维修台升级');
  await expect.poll(async () => (await saved(page)).queue[0]?.prefab).toBe(0);
  await page.reload(); await expect(page.getByTestId('save-status')).toHaveText('已保存');
  expect((await saved(page)).queue[0]).toMatchObject({ district: 'district-0', definition: 'build:workbench', targetLevel: 3, prefab: 0 });
});

test('UX01/04/19: a paused modification blocks workbench removal and cancelling safely releases it', async ({ page }) => {
  let s = decodeSave(await readFile(new URL('../fixtures/v0.2-chapter.json', import.meta.url), 'utf8')).state;
  for (const action of [
    { type: 'story', node: 'L01-1' }, { type: 'story', node: 'L01-2', choice: 'dismantle' },
    { type: 'enqueue', definition: 'build:workbench', district: 'district-1' }
  ] as const) { const result = applyAction(s, action); expect(result.error).toBeNull(); s = result.state; }
  s = advance(s, 50000);
  const enqueued = applyAction(s, { type: 'enqueue', definition: 'mod:quickJig', district: 'district-1' });
  expect(enqueued.error).toBeNull(); s = advance(enqueued.state, 1000);
  const paused = applyAction(s, { type: 'pause', uid: s.queue[0].uid }); expect(paused.error).toBeNull(); s = paused.state;
  s.clock.lastAt = START.getTime(); s.report = null;
  await load(page, encodeSave(s, s.clock.lastAt)); await click(page, '经营旧巷');
  await expect(page.getByRole('button', { name: '拆除闲置维修台', exact: true })).toBeDisabled();
  await click(page, '工务'); await page.getByTestId('queue-mod:quickJig').getByRole('button', { name: '取消项目', exact: true }).click();
  await click(page, '确认取消'); await click(page, '经营');
  await click(page, '拆除闲置维修台'); await click(page, '确认拆除');
  await expect.poll(async () => (await saved(page)).city.districts['district-1']!.facilities.workbench).toBe(0);
  await expect(page.getByTestId('save-status')).toHaveText('已保存');
  await page.reload(); await expect(page.getByTestId('save-status')).toHaveText('已保存');
  const reopened = await saved(page);
  expect(reopened.city.districts['district-1']!.facilities.workbench).toBe(0); expect(reopened.queue).toHaveLength(0);
  expect(() => decodeSave(encodeSave(reopened, START.getTime()))).not.toThrow();
});
