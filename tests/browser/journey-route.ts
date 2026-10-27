import { expect } from '@playwright/test';
import type { Page, TestInfo } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { SAVE_KEY } from '../../src/app/storage';
import { RESOURCES } from '../../src/game/config';
import { view } from '../../src/game/engine';
import { LEGACY_ARCHIVE_IDS, remainingSpecialtyUses } from '../../src/game/journey';
import { decodeSave } from '../../src/game/saves';
import type { CommissionStage, FieldSite, GameState, RouteId } from '../../src/game/types';

const saved = (page: Page): Promise<GameState> => page.evaluate(key => JSON.parse(localStorage.getItem(key)!).state, SAVE_KEY);
const click = (page: Page, name: string) => page.getByRole('button', { name, exact: true }).click();
async function wait(page: Page, seconds: number) {
  const before = await saved(page); await page.clock.fastForward(seconds * 1000);
  await expect.poll(async () => (await saved(page)).clock.seconds, { timeout: 30000 }).toBe(before.clock.seconds + seconds);
  await expect(page.getByTestId('save-status')).toHaveText('已保存');
}
async function until(page: Page, condition: (s: GameState) => boolean, label: string, limit = 5000) {
  for (let elapsed = 0; elapsed < limit; elapsed += 30) { if (condition(await saved(page))) return; await wait(page, 30); }
  throw new Error(`${label}: ${JSON.stringify(await saved(page))}`);
}
async function allMatters(page: Page) {
  await click(page, '事项'); const expand = page.getByRole('button', { name: '查看全部已开放委托', exact: true }); if (await expand.isVisible()) await expand.click();
}
async function deliver(page: Page, id: CommissionStage) {
  await allMatters(page); const card = page.getByTestId(`commission-${id}`);
  await card.getByRole('button', { name: '追踪这一阶段', exact: true }).click(); await card.getByRole('button', { name: '交付这一阶段', exact: true }).click();
}
async function visit(page: Page, site: FieldSite, kind: 'first' | 'clue' | 'supply', branch?: string) {
  await allMatters(page); await page.getByLabel('外勤来源街区').selectOption('district-1'); await page.getByLabel('外勤居民类型').selectOption('shadow');
  const button = kind === 'first' ? '派人首访' : kind === 'clue' ? '调查有限线索' : '普通物资复访';
  await page.getByTestId(`field-${site}`).getByRole('button', { name: button, exact: true }).click();
  const away = (await saved(page)).neighborhood.field.active!; expect(away.site).toBe(site); await wait(page, away.duration);
  const result = page.getByTestId(`field-result-${site}`); await expect(result).toBeVisible();
  await result.getByRole('button', { name: branch ? `确认${branch}` : '领取调查结果', exact: true }).click();
}
async function pauseNetwork(page: Page) {
  await click(page, '夜网');
  for (const city of ['雨城', '长站']) { const button = page.getByRole('button', { name: `暂停${city}供货合同`, exact: true }); if (await button.isVisible()) await button.click(); }
  await until(page, s => Object.values(s.network.routes).every(r => !r.trip), 'all paid cargo must arrive');
}
async function switchMode(page: Page, id: RouteId, specialty: boolean) {
  const name = id === 'rain' ? specialty ? '雨声封装' : '常规整理' : specialty ? '轨芯整备' : '旧轨回收';
  const before = await saved(page), mode = specialty ? 'specialty' : 'normal'; if (before.network.routes[id].node.mode === mode) return;
  await click(page, `切换为${name}`); expect((await saved(page)).network.routes[id].node.mode).toBe(before.network.routes[id].node.mode);
  await click(page, `确认切换${id === 'rain' ? '雨城' : '长站'}生产`); expect((await saved(page)).network.routes[id].node.mode).toBe(mode);
}
async function targets(page: Page, film: string, core: string) {
  await click(page, '夜网');
  for (const [id, city, resource, target] of [['rain', '雨城', '雨声胶片', film], ['station', '长站', '轨芯', core]] as const) {
    const card = page.getByTestId(`route-${id}`); await card.getByRole('button', { name: '取城市特产 · 建议6', exact: true }).click();
    await page.getByLabel(`${city}${resource}目标`, { exact: true }).fill(target); await click(page, `启用${city}供货合同`);
  }
  await until(page, s => s.resources.rainFilm >= Number(film) * 1000 && s.resources.railCore >= Number(core) * 1000, 'both real specialty imports');
  await pauseNetwork(page);
}

export async function completeJourneyContent(page: Page, info: TestInfo, device: 'desktop' | 'mobile') {
  const start = await saved(page), milestones: Record<string, GameState> = {}, observations: Record<string, unknown> = {};
  const mark = async (name: string) => { milestones[name] = await saved(page); };
  await pauseNetwork(page); await click(page, '读完装配纸条');
  for (const node of ['L03-1', 'L03-2', 'L03-3']) await page.getByTestId(`story-${node}`).getByRole('button', { name: '读完站务员回访' }).click();
  await click(page, '经营'); await click(page, '减少回声居民记录员');
  await click(page, '经营旧巷'); await click(page, '减少影子居民回收工'); await click(page, '减少影子居民回收工'); await click(page, '经营第0街区');
  await click(page, '减少回声居民维修工'); await click(page, '增加回声居民装配工');
  await page.getByLabel('构件目标', { exact: true }).fill('12'); await click(page, '保存并启用装配');
  await click(page, '夜网'); await switchMode(page, 'rain', true); await switchMode(page, 'station', true);
  await targets(page, '6', '8'); await mark('firstSpecialties');
  await deliver(page, 'CM04-1'); await visit(page, 'F02', 'first', '确认住户'); await visit(page, 'F02', 'clue');
  await click(page, '经营旧巷'); await click(page, '增加影子居民回收工'); await click(page, '增加影子居民回收工'); await click(page, '经营第0街区');
  await deliver(page, 'CM04-2'); await deliver(page, 'CM04-3');
  await deliver(page, 'CM05-1'); await visit(page, 'F05', 'first', device === 'desktop' ? '修好站棚' : '封存雨声'); await visit(page, 'F05', 'clue'); await deliver(page, 'CM05-2');
  await deliver(page, 'CM06-1'); await visit(page, 'F06', 'first', device === 'desktop' ? '更换旧接头' : '扩写运单'); await visit(page, 'F06', 'clue'); await mark('investigations');
  const preferred = device === 'desktop' ? '强化货架' : '护轨挂架', other = device === 'desktop' ? '护轨挂架' : '强化货架';
  await click(page, '夜网'); await click(page, `制作${preferred}`); await until(page, s => s.network.vehicle.built.length === 1, 'first vehicle modification');
  expect((await saved(page)).network.vehicle.active).toBeNull(); await click(page, `启用${preferred}`); await mark('firstVehicle');
  await deliver(page, 'CM06-2');
  await targets(page, '6', '6'); await mark('modifiedSupply');
  await click(page, '档案');
  for (const id of LEGACY_ARCHIVE_IDS) { const card = page.getByTestId(`archive-${id}`); await card.getByRole('button', { name: /^复原/ }).click(); await click(page, `确认复原${id}`); }
  await deliver(page, 'CM05-3');
  // Stand down collectors while preparing the mixed return and later field
  // rewards. Both decisions keep real whole-package destination space available.
  await click(page, '经营旧巷'); await click(page, '减少影子居民回收工'); await click(page, '减少影子居民回收工'); await click(page, '经营第0街区');
  await click(page, '夜网'); await switchMode(page, 'rain', false);
  await page.getByLabel('雨城补给包数', { exact: true }).fill('1'); await click(page, '发车补给雨城');
  await until(page, s => !s.network.routes.rain.trip && s.network.routes.rain.node.resources.memory >= 12000, 'normal rain package');
  await switchMode(page, 'rain', true); await page.getByLabel('雨城补给包数', { exact: true }).fill('1'); await click(page, '发车补给雨城');
  await until(page, s => !s.network.routes.rain.trip && s.network.routes.rain.node.resources.rainFilm >= 2000, 'specialty rain package');
  await page.getByLabel('雨城手动常规包数', { exact: true }).fill('1'); await page.getByLabel('雨城手动特产包数', { exact: true }).fill('1');
  await click(page, '发车取回雨城'); const mixed = await saved(page); expect(mixed.network.routes.rain.trip!.manifest).toEqual({ normal: 1, specialty: 1 });
  await expect(page.getByTestId('shipment-rain')).toContainText('目的地空间已预留');
  await expect(page.getByRole('button', { name: '使用普通车辆', exact: true })).toBeDisabled();
  await page.getByTestId('route-rain').screenshot({ path: info.outputPath(`${device}-mixed-reserved.png`), animations: 'disabled' });
  await wait(page, mixed.network.routes.rain.trip!.duration); await mark('mixedArrival');
  await click(page, `制作${other}`); await until(page, s => s.network.vehicle.built.length === 2, 'second vehicle modification');
  await click(page, `启用${other}`); await click(page, `启用${preferred}`);
  const revisitBefore = await saved(page); observations.revisit = { before: revisitBefore, actualLocalOutput: view(revisitBefore).output, note: '旧巷空闲影子外勤；占用全城唯一调查位。供给特产在复访奖励中返还同量，不能算成净产出。' };
  await visit(page, 'F05', 'supply'); await visit(page, 'F06', 'supply'); const revisitAfter = await saved(page);
  observations.revisit = { ...(observations.revisit as object), after: revisitAfter, elapsed: revisitAfter.clock.seconds - revisitBefore.clock.seconds };
  await page.getByTestId('story-L03-4').getByRole('button', { name: '读完站务员回访' }).click(); await deliver(page, 'CM06-3'); await mark('contentComplete');
  const end = await saved(page); expect(end.neighborhood.commissions.completed.filter(id => /^CM0[4-6]/.test(id))).toHaveLength(9);
  expect(end.experience.archives).toEqual(LEGACY_ARCHIVE_IDS); expect(remainingSpecialtyUses(end)).toEqual([]);
  await click(page, '经营第0街区'); await click(page, '经营'); await expect(page.getByTestId('night-platform')).toContainText('候车长椅已按班次转向');
  await expect(page.getByTestId('night-platform')).toContainText('听雨间已有雨声'); await expect(page.getByTestId('night-platform')).toContainText('修车棚留好了交班工具');
  await page.getByTestId('street-scene').screenshot({ path: info.outputPath(`${device}-night-street.png`), animations: 'disabled' });
  await click(page, '档案'); await expect(page.getByTestId('archive-A01')).toContainText('寄件人没有署名');
  await page.screenshot({ path: info.outputPath(`${device}-restored-archives.png`), fullPage: true, animations: 'disabled' });
  const text = await page.evaluate(key => localStorage.getItem(key)!, SAVE_KEY); expect(decodeSave(text).state).toEqual(end);
  await page.reload(); await expect(page.getByTestId('save-status')).toHaveText('已保存'); expect(await saved(page)).toEqual(end);
  await click(page, '夜网'); await expect(page.getByRole('button', { name: `${preferred}已启用`, exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.screenshot({ path: info.outputPath(`${device}-v033-network.png`), fullPage: true, animations: 'disabled' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  if (device === 'mobile') { await page.setViewportSize({ width: 320, height: 740 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await page.screenshot({ path: info.outputPath('320px-network.png'), fullPage: true }); }
  const flows = Object.fromEntries(Object.keys(end.ledger).map(flow => [flow, Object.fromEntries(RESOURCES.map(r => [r, end.ledger[flow as keyof typeof end.ledger][r] - start.ledger[flow as keyof typeof end.ledger][r]]))]));
  await writeFile(info.outputPath(`${device}-v033-playtest.json`), JSON.stringify({ device, preferred, start, milestones, end, flows, observations, elapsed: end.clock.seconds - start.clock.seconds }, null, 2));
  await writeFile(info.outputPath(`${device}-v033-save.json`), text);
}
