import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { SAVE_KEY } from '../../src/app/storage';
import { advance, applyAction, chapterProofs } from '../../src/game/engine';
import { decodeSave, encodeSave } from '../../src/game/saves';
import type { Action, CommissionStage, FieldSite, GameState } from '../../src/game/types';

test.use({ actionTimeout: 10000 });

const START = new Date('2026-10-15T10:00:00Z');
const saved = (page: Page): Promise<GameState> => page.evaluate(key => JSON.parse(localStorage.getItem(key)!).state, SAVE_KEY);
const click = (page: Page, name: string) => page.getByRole('button', { name, exact: true }).click();
async function wait(page: Page, seconds: number) {
  const before = await saved(page); await page.clock.fastForward(seconds * 1000);
  await expect.poll(async () => (await saved(page)).clock.seconds, { timeout: 30000 }).toBe(before.clock.seconds + seconds);
  await expect(page.getByTestId('save-status')).toHaveText('已保存');
}
async function until(page: Page, condition: (s: GameState) => boolean, limit = 1800) {
  for (let elapsed = 0; elapsed < limit; elapsed += 30) { if (condition(await saved(page))) return; await wait(page, 30); }
  expect(condition(await saved(page)), 'route must reach its next real state').toBe(true);
}
async function load(page: Page, text: string) {
  await page.addInitScript(([key, raw]) => { if (!localStorage.getItem(key)) localStorage.setItem(key, raw); }, [SAVE_KEY, text]);
  await page.clock.install({ time: START }); await page.clock.pauseAt(START); await page.goto('/');
  await expect(page.getByTestId('save-status')).toHaveText('已保存');
}
async function legacy(page: Page, version = '0.3.1') {
  const raw = JSON.parse(await readFile(new URL(`../fixtures/v${version}-chapter.json`, import.meta.url), 'utf8'));
  raw.savedAt = START.getTime(); raw.state.clock.lastAt = START.getTime(); await load(page, JSON.stringify(raw));
  await click(page, '知道了'); if (raw.state.report) await click(page, '收好报告');
}
async function track(page: Page, id: CommissionStage) { if (!await page.getByTestId(`commission-${id}`).isVisible()) await click(page, '查看全部已开放委托'); await page.getByTestId(`commission-${id}`).getByRole('button', { name: '追踪这一阶段' }).click(); }
async function deliver(page: Page, id: CommissionStage) { await track(page, id); await page.getByTestId(`commission-${id}`).getByRole('button', { name: '交付这一阶段' }).click(); }
async function result(page: Page, site: FieldSite, branch?: string) {
  const box = page.getByTestId(`field-result-${site}`);
  await box.getByRole('button', { name: branch ? `确认${branch}` : '领取调查结果', exact: true }).click();
}
async function field(page: Page, site: FieldSite, seconds: number, branch?: string) {
  await page.getByTestId(`field-${site}`).getByRole('button', { name: branch ? '派人首访' : '调查有限线索', exact: true }).click(); await wait(page, seconds); await result(page, site, branch);
}
const stages = ['CM01-2', 'CM02-2', 'CM03-2'] as const;
for (const [device, width, height] of [['desktop', 1440, 1000], ['mobile', 390, 844]] as const) {
  test(`UX09-13/19/20: complete cooperative chapter, nine stages, four field clues, mailboxes and explicit delegation on ${device}`, async ({ page }, info) => {
    await page.setViewportSize({ width, height }); const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
    await legacy(page); const start = await saved(page), milestones: Record<string, GameState> = {};
    await click(page, '拆解收音机');
    for (const node of ['L01-3', 'L01-4']) await page.getByTestId(`story-${node}`).getByRole('button', { name: '读完住客回信' }).click();
    await click(page, '减少回声居民记录员'); await click(page, '增加回声居民装配工');
    await page.getByLabel('构件目标', { exact: true }).fill('12'); await click(page, '保存并启用装配');
    await click(page, '安排测绘没有尽头的旧巷'); await wait(page, 380);
    await click(page, '安排为信笺里补上门牌');
    await page.getByTestId('event-E06').getByRole('button', { name: '领取并归档' }).click(); await wait(page, 450);
    await click(page, device === 'mobile' ? '各留姓名' : '共用一盏灯');
    for (const node of ['L02-1', 'L02-2']) await page.getByTestId(`story-${node}`).getByRole('button', { name: '读完邮递员回访' }).click();
    await click(page, '暂停装配'); await click(page, '减少回声居民装配工'); await click(page, '增加回声居民记录员');
    await click(page, '安排夜居民宿舍升级'); await click(page, '安排手摇发电机升级'); await wait(page, 250);
    await click(page, '增加影子居民发电工'); await wait(page, 120); await click(page, '增加回声居民维修工');
    await click(page, '经营旧巷'); await click(page, '安排夜居民宿舍建设'); await wait(page, 60);
    await click(page, '经营信笺里'); await click(page, '安排夜居民宿舍建设'); await wait(page, 660);
    expect((await saved(page)).city.districts['district-1']!.population.shadow).toBeGreaterThan(0);
    await click(page, '经营第0街区'); await click(page, '安排建设配电亭'); await wait(page, 120);
    await click(page, '档案'); await click(page, '安排巡检手册'); await wait(page, 160);
    await click(page, '事项'); for (const id of ['CM01-1', 'CM02-1', 'CM03-1'] as CommissionStage[]) await deliver(page, id);
    await page.getByTestId('story-L02-3').getByRole('button', { name: '读完邮递员回访' }).click();
    let state = await saved(page); expect(chapterProofs(state)).toMatchObject({ cooperation: true, production: false }); milestones.proof = state;
    await click(page, '工务'); await expect(page.getByTestId('proof-cooperation')).toContainText('已满足'); await expect(page.getByTestId('proof-production')).toContainText('待安排');
    await click(page, '安排编成夜城地址簿'); await until(page, s => s.completed.includes('P06')); await click(page, '安排接通雨城联络线');
    await until(page, s => s.queue[0]?.definition === 'P07' && s.queue[0].status === 'running');
    await page.getByTestId('event-E09').getByRole('button', { name: '领取并归档' }).click(); await click(page, '减少回声居民记录员');
    await until(page, s => s.completed.includes('P07'));
    state = await saved(page); expect(state.completed).toContain('P07'); expect(state.publicWorks.registry.built).toBe(false); expect(chapterProofs(state).production).toBe(false); milestones.chapterComplete = state;
    await page.getByTestId('event-E10').getByRole('button', { name: '读完并归档' }).click();
    await page.getByTestId('story-L02-4').getByRole('button', { name: '读完邮递员回访' }).click();
    await click(page, '减少影子居民回收工');
    await click(page, '事项'); await page.getByLabel('外勤来源街区').selectOption('district-1');
    // The window's pure knowledge is useful before resource-returning visits;
    // making its tools also frees memory space for the later replies.
    await field(page, 'F04', 180, device === 'mobile' ? '听完窗后的话' : '整理投递规则');
    await click(page, '经营'); await click(page, '制作投递匣'); await wait(page, 50);
    if (device === 'desktop') {
      await click(page, '减少影子居民发电工'); await click(page, '减少影子居民发电工');
    }
    await click(page, '事项'); await field(page, 'F02', 120, device === 'mobile' ? '确认住户' : '画下电路'); await field(page, 'F02', 120);
    await click(page, '经营'); if (device === 'desktop') { await click(page, '增加影子居民发电工'); await click(page, '增加影子居民发电工'); }
    await click(page, '制作留声匣'); await wait(page, 50); await click(page, '启用留声匣');
    expect((await saved(page)).neighborhood.mailboxes['district-0'].active).toBe('voiceBox');
    await click(page, '启用投递匣'); await click(page, '事项');
    await field(page, 'F04', 180);
    await field(page, 'F01', 90, device === 'mobile' ? '对准旧调频' : '整理旧工具'); await field(page, 'F01', 90);
    await field(page, 'F03', 180, device === 'mobile' ? '留下通行的路' : '收好旧架'); await field(page, 'F03', 180);
    for (const id of stages) await track(page, id);
    for (const id of stages) await page.getByLabel(`代办${id}`, { exact: true }).check();
    await page.getByLabel('代办电量保留', { exact: true }).fill('10.001'); await click(page, '保存清单并启用代办');
    const confirmed = await saved(page); expect(confirmed.neighborhood.delegation.stages).toEqual(stages);
    await page.getByLabel('代办电量保留', { exact: true }).fill('');
    await expect(page.getByRole('button', { name: '保存清单并启用代办', exact: true })).toBeDisabled();
    await click(page, '暂停已保存的代办'); expect((await saved(page)).neighborhood.delegation.reserve.energy).toBe(10001);
    await page.getByLabel('代办电量保留', { exact: true }).fill('10.001'); await click(page, '保存清单并启用代办');
    await wait(page, 10); state = await saved(page); expect(state.neighborhood.delegation.deliveries).toBe(3); expect(state.neighborhood.delegation.stages).toEqual([]); expect(state.neighborhood.commissions.tracked).toEqual([]);
    for (const id of ['CM01-3', 'CM02-3', 'CM03-3'] as CommissionStage[]) await deliver(page, id);
    state = await saved(page); expect(state.neighborhood.commissions.completed).toHaveLength(9); expect(Object.entries(state.neighborhood.field.sites).filter(([id]) => id !== 'F05' && id !== 'F06').every(([, s]) => s.clue)).toBe(true); milestones.lifeComplete = state;
    await click(page, '经营旧巷'); await click(page, '经营'); await expect(page.getByTestId('street-life')).toContainText('晾衣绳下');
    await click(page, '经营信笺里'); await expect(page.getByTestId('street-life')).toContainText('两张回执');
    await expect(page.getByTestId('street-life')).toContainText(device === 'mobile' ? '各留姓名' : '今晚的灯');
    await page.getByTestId('street-scene').screenshot({ path: info.outputPath(`${device}-windows.png`) });
    await click(page, '档案'); await expect(page.getByRole('region', { name: '街巷档案', exact: true })).toContainText('CM03-3');
    await click(page, '事项'); await page.locator('.repeat-planner summary').click();
    for (const site of ['F01', 'F02', 'F03']) { await page.getByLabel('预排复访地点').selectOption(site); await click(page, '加入复访草稿'); }
    await click(page, '保存并预排复访'); await wait(page, 400);
    state = await saved(page); expect(state.neighborhood.field.pending).toHaveLength(3); expect(state.neighborhood.field.queue).toEqual([]);
    for (const site of ['F01', 'F02', 'F03'] as FieldSite[]) await result(page, site);
    await page.reload(); await expect(page.getByTestId('save-status')).toHaveText('已保存');
    state = await saved(page); expect(decodeSave(encodeSave(state, START.getTime())).state).toEqual(state); expect(state.neighborhood.commissions.completed).toHaveLength(9);
    await click(page, '事项'); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`${device}-matters.png`), fullPage: true, animations: 'disabled' });
    if (device === 'mobile') { await page.setViewportSize({ width: 320, height: 740 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); }
    await writeFile(info.outputPath('route.json'), JSON.stringify({ device, start, milestones, end: state }, null, 2)); expect(errors).toEqual([]);
  });
}

test('UX11/19/20: actual day offline executes only the confirmed delivery and keeps the field decision pending', async ({ page }) => {
  let state = decodeSave(await readFile(new URL('../fixtures/v0.2-chapter.json', import.meta.url), 'utf8')).state;
  for (const action of [
    { type: 'story', node: 'L01-1' }, { type: 'story', node: 'L01-2', choice: 'dismantle' },
    { type: 'assign', resident: 'echo', job: 'repair', delta: -1 }, { type: 'assign', resident: 'echo', job: 'assemble', delta: 1 },
    { type: 'assembly-plan', enabled: true, target: 12000, reserve: amountsForPlan() }
  ] as Action[]) { const r = applyAction(state, action); expect(r.error).toBeNull(); state = r.state; }
  state = advance(state, 600000);
  for (const action of [
    { type: 'assembly-plan', ...state.experience.assembly, enabled: false },
    { type: 'assign', resident: 'echo', job: 'assemble', delta: -1 }, { type: 'assign', resident: 'echo', job: 'repair', delta: 1 },
    { type: 'commission-track', stage: 'CM03-1' }, { type: 'commission-deliver', stage: 'CM03-1' }, { type: 'enqueue', definition: 'mailmod:dispatchBox' }
  ] as Action[]) { const r = applyAction(state, action); expect(r.error).toBeNull(); state = r.state; }
  state = advance(state, 60000);
  for (const action of [
    { type: 'mailbox-mod', district: 'district-0', mod: 'dispatchBox' },
    { type: 'commission-track', stage: 'CM01-1' }, { type: 'delegate-plan', district: 'district-0', stages: ['CM01-1'], reserve: amountsForPlan() },
    { type: 'field-start', site: 'F02', kind: 'first', district: 'district-1', resident: 'shadow' }
  ] as Action[]) { const r = applyAction(state, action); expect(r.error).toBeNull(); state = r.state; }
  state.clock.lastAt = START.getTime() - 86400000; state.report = null;
  const expected = advance(state, 86400000); await load(page, encodeSave(state, state.clock.lastAt));
  const after = await saved(page); expect(after.neighborhood).toEqual(expected.neighborhood); expect(after.resources).toEqual(expected.resources); expect(after.ledger).toEqual(expected.ledger);
  await expect(page.getByRole('region', { name: '返回报告' })).toContainText('投递匣实际交付 1 项');
  await expect(page.getByRole('region', { name: '返回报告' })).toContainText('待领 1 包（尚未入库）');
  expect(after.neighborhood.field.sites.F02.first).toBeNull(); expect(after.neighborhood.commissions.completed).toEqual(['CM03-1', 'CM01-1']);
  await click(page, '收好报告'); await click(page, '事项'); await expect(page.getByTestId('field-result-F02')).toBeVisible();
});

async function loadDelegationFixture(page: Page) {
  let state = decodeSave(await readFile(new URL('../fixtures/v0.3-chapter.json', import.meta.url), 'utf8')).state;
  state.resources.component = 6000;
  state.ledger.production.component = 6000;
  state.earned.component = 6000;
  const apply = (action: Action) => {
    const result = applyAction(state, action);
    expect(result.error, JSON.stringify(action)).toBeNull();
    state = result.state;
  };
  apply({ type: 'story', node: 'L01-1' });
  apply({ type: 'commission-track', stage: 'CM03-1' });
  apply({ type: 'commission-deliver', stage: 'CM03-1' });
  apply({ type: 'enqueue', definition: 'mailmod:dispatchBox' });
  state = advance(state, 90000);
  apply({ type: 'mailbox-mod', district: 'district-0', mod: 'dispatchBox' });
  state.clock.lastAt = START.getTime(); state.report = null;
  await load(page, encodeSave(state, START.getTime()));
  await click(page, '事项');
}

test('UX11: removing a tracked stage also removes it from the unsaved delegation draft', async ({ page }) => {
  await loadDelegationFixture(page);
  await expect(page.getByTestId('commission-CM01-1')).toBeVisible();
  await expect(page.getByTestId('commission-CM02-1')).toBeVisible();
  await track(page, 'CM01-1'); await track(page, 'CM02-1');
  await page.getByLabel('代办CM01-1', { exact: true }).check();
  await expect(page.locator('#delegation ol')).toContainText('CM01-1');
  await page.getByTestId('commission-CM01-1').getByRole('button', { name: '取消追踪', exact: true }).click();
  await expect(page.getByLabel('代办CM01-1', { exact: true })).toHaveCount(0);
  await expect(page.locator('#delegation ol')).toHaveCount(0);
  await page.getByLabel('代办CM02-1', { exact: true }).check();
  await expect(page.getByRole('button', { name: '保存清单并启用代办', exact: true })).toBeEnabled();
  await click(page, '保存清单并启用代办');
  await expect.poll(async () => (await saved(page)).neighborhood.delegation.stages).toEqual(['CM02-1']);
});

for (const removal of ['untracked', 'manually delivered', 'automatically delivered'] as const) {
  test(`UX11: delegation edits survive when a saved stage is ${removal}`, async ({ page }) => {
    await loadDelegationFixture(page);
    for (const id of ['CM01-1', 'CM02-1', 'CM03-2'] as const) await track(page, id);
    for (const id of ['CM01-1', 'CM03-2']) await page.getByLabel(`代办${id}`, { exact: true }).check();
    await click(page, '保存清单并启用代办');
    const confirmed = (await saved(page)).neighborhood.delegation;

    await page.getByLabel('代办CM03-2', { exact: true }).uncheck();
    await page.getByLabel('代办CM02-1', { exact: true }).check();
    await page.getByLabel('代办街区', { exact: true }).selectOption('district-1');
    const reserves = { 电量: '123.001', 零件: '24.002', 记忆: '8.003', 标准构件: '0.004' };
    for (const [name, value] of Object.entries(reserves)) await page.getByLabel(`代办${name}保留`, { exact: true }).fill(value);

    if (removal === 'automatically delivered') await wait(page, 10);
    else await page.getByTestId('commission-CM01-1').getByRole('button', { name: removal === 'untracked' ? '取消追踪' : '交付这一阶段', exact: true }).click();

    await expect(page.getByLabel('代办CM01-1', { exact: true })).toHaveCount(0);
    await expect(page.getByLabel('代办CM02-1', { exact: true })).toBeChecked();
    await expect(page.getByLabel('代办CM03-2', { exact: true })).not.toBeChecked();
    await expect(page.locator('#delegation ol li')).toHaveText(['CM02-1 把晾衣绳留在地图上']);
    await expect(page.getByLabel('代办街区', { exact: true })).toHaveValue('district-1');
    for (const [name, value] of Object.entries(reserves)) await expect(page.getByLabel(`代办${name}保留`, { exact: true })).toHaveValue(value);
    const after = await saved(page);
    expect(after.neighborhood.delegation).toEqual({ ...confirmed, stages: ['CM03-2'], deliveries: confirmed.deliveries + Number(removal === 'automatically delivered') });
    expect(after.neighborhood.commissions.completed).not.toContain('CM02-1');

    await page.getByLabel('代办街区', { exact: true }).selectOption('district-0');
    await expect(page.getByRole('button', { name: '保存清单并启用代办', exact: true })).toBeEnabled();
    await click(page, '保存清单并启用代办');
    expect((await saved(page)).neighborhood.delegation).toMatchObject({ stages: ['CM02-1'], district: 'district-0', reserve: { energy: 123001, parts: 24002, memory: 8003, component: 4 } });
    await page.reload(); await expect(page.getByTestId('save-status')).toHaveText('已保存'); await click(page, '事项');
    await expect(page.getByLabel('代办CM02-1', { exact: true })).toBeChecked();
    await expect(page.getByLabel('代办CM03-2', { exact: true })).not.toBeChecked();
    for (const [name, value] of Object.entries(reserves)) await expect(page.getByLabel(`代办${name}保留`, { exact: true })).toHaveValue(value);
  });
}
function amountsForPlan() { return { energy: 0, parts: 0, memory: 0, component: 0, rainFilm: 0, railCore: 0 }; }
