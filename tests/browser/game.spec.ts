import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { advance, applyAction, capacities, createGame, summarize } from '../../src/game/engine';
import { decodeSave, encodeSave } from '../../src/game/saves';
import { BACKUP_KEY, SAVE_KEY } from '../../src/app/storage';
import type { GameState } from '../../src/game/types';

const START = new Date('2026-10-14T08:00:00Z');
async function fresh(page: Page) {
  await page.clock.install({ time: START }); await page.clock.pauseAt(START);
  await page.goto('/'); await expect(page.getByTestId('save-status')).toHaveText('已保存');
}
async function saved(page: Page): Promise<GameState> {
  return page.evaluate(key => JSON.parse(localStorage.getItem(key)!).state, SAVE_KEY);
}
async function wait(page: Page, seconds: number) {
  const before = await saved(page);
  await page.clock.fastForward(seconds * 1000);
  await expect.poll(async () => (await saved(page)).clock.seconds).toBe(before.clock.seconds + seconds);
  await expect(page.getByTestId('save-status')).toHaveText('已保存');
}
async function click(page: Page, name: string) { await page.getByRole('button', { name, exact: true }).click(); }
async function allocation(page: Page, operation: '增加' | '减少', type: '影子' | '回声', job: string) { await click(page, `${operation}${type}居民${job}`); }
async function noOverflow(page: Page) { expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); }
async function journey(page: Page) {
  const milestones: Record<string, number> = {};
  const mark = async (name: string) => { milestones[name] = (await saved(page)).clock.seconds; };
  await click(page, '安排让临时路灯亮起'); await wait(page, 25);
  await allocation(page, '减少', '影子', '回收工'); await allocation(page, '增加', '影子', '维修工');
  await wait(page, 60); await expect(page.getByTestId('event-E01')).toBeVisible(); await mark('firstLight');
  await page.getByTestId('event-E01').getByRole('button', { name: '领取并归档' }).click();
  await allocation(page, '减少', '影子', '维修工'); await allocation(page, '增加', '影子', '回收工');
  await wait(page, 130); await click(page, '安排夜居民宿舍建设');
  await allocation(page, '减少', '影子', '回收工'); await allocation(page, '增加', '影子', '维修工');
  await wait(page, 120); expect((await saved(page)).facilities.dorm).toBe(1); await mark('dorm');
  await allocation(page, '减少', '影子', '维修工'); await allocation(page, '增加', '影子', '回收工');
  await wait(page, 120); await click(page, '选择明灯'); await mark('lightingChoice');
  await allocation(page, '增加', '回声', '维修工'); await click(page, '安排给站牌写上“0”');
  await wait(page, 120); await mark('stationSign');
  await page.getByTestId('event-E02').getByRole('button', { name: '领取并归档' }).click();
  await allocation(page, '增加', '回声', '回收工');
  await click(page, '安排后场仓库建设'); await click(page, '安排回声信箱建设');
  await click(page, '工务');
  await expect(page.getByRole('region', { name: '工务队列' })).toContainText('后场仓库');
  await wait(page, 400); expect((await saved(page)).facilities.mailbox).toBe(1); await mark('mailbox');
  await allocation(page, '减少', '回声', '回收工'); await allocation(page, '增加', '回声', '记录员');
  await wait(page, 100); await page.getByTestId('event-E04').getByRole('button', { name: '读完并归档' }).click();
  await wait(page, 300); await click(page, '档案');
  await click(page, '安排工具规范'); await click(page, '安排回声整理');
  await click(page, '工务'); await click(page, '安排修复旧站台');
  await wait(page, 300); expect((await saved(page)).completed).toContain('R01'); await mark('firstResearch');
  await wait(page, 250); expect((await saved(page)).completed).toContain('R02'); await mark('secondResearch');
  await wait(page, 900); expect((await saved(page)).address).toBe('0-001'); await mark('chapterCompleteObserved');
  await page.getByTestId('event-E05').getByRole('button', { name: '读完并归档' }).click();
  const state = await saved(page);
  milestones.chapterCompleteExact = state.history.find(h => h.text === '完工：修复旧站台')!.second;
  expect(Object.values(state.events).every(e => e.status === 'claimed')).toBe(true);
  expect(state.completed).toEqual(expect.arrayContaining(['P01', 'P02', 'P03', 'R01', 'R02']));
  await click(page, '档案'); await expect(page.getByRole('heading', { name: '第0街区 · 0-001' })).toBeVisible();
  await noOverflow(page);
  return { milestones, state };
}
for (const [name, width, height] of [['desktop', 1440, 1000], ['mobile', 390, 844]] as const) {
  test(`BT-01/07/FR-07/14: complete fresh-save chapter through ${name} UI`, async ({ page }, info) => {
    await page.setViewportSize({ width, height }); const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message)); await fresh(page);
    await page.screenshot({ path: info.outputPath(`${name}-initial.png`), fullPage: true, animations: 'disabled' });
    const result = await journey(page);
    await writeFile(info.outputPath(`${name}-playtest.json`), JSON.stringify({ viewport: { width, height }, ...result }, null, 2));
    await page.screenshot({ path: info.outputPath(`${name}-chapter.png`), fullPage: true, animations: 'disabled' });
    await page.reload(); await expect(page.getByTestId('save-status')).toHaveText('已保存');
    expect((await saved(page)).address).toBe('0-001'); expect(Object.values((await saved(page)).events).every(e => e.status === 'claimed')).toBe(true);
    await click(page, '经营'); await click(page, '安排手摇发电机升级'); await wait(page, 120);
    expect((await saved(page)).facilities.generator).toBe(2);
    await wait(page, 3600);
    const full = await saved(page);
    expect(full.resources).toEqual({ ...capacities(full), component: 0, rainFilm: 0, railCore: 0 });
    await expect(page.getByTestId('energy-stock')).toHaveText('300 / 300');
    await expect(page.getByTestId('parts-stock')).toHaveText('250 / 250');
    await expect(page.getByTestId('memory-stock')).toHaveText('80 / 80');
    expect(await page.locator('.resources .meter > span').evaluateAll(elements => elements.map(element => (element as HTMLElement).style.width))).toEqual(['100%', '100%', '100%']);
    await click(page, '设置'); await click(page, '纸色主题'); await noOverflow(page);
    await page.screenshot({ path: info.outputPath(`${name}-light.png`), fullPage: true, animations: 'disabled' });
    expect(errors).toEqual([]);
  });
}
test('BT-03/08: an existing save at 199.95 reaches 200 and survives reopening', async ({ page }) => {
  const old = advance(createGame(START.getTime()), 600000);
  old.resources.energy -= 50; old.ledger.operating.energy += 50;
  const raw = encodeSave(old, START.getTime());
  await page.addInitScript(([key, text]) => { if (!localStorage.getItem(key)) localStorage.setItem(key, text); }, [SAVE_KEY, raw]);
  await fresh(page); await expect(page.getByTestId('energy-stock')).toHaveText('199.95 / 200');
  await wait(page, 10);
  await expect(page.getByTestId('energy-stock')).toHaveText('200 / 200');
  expect((await saved(page)).resources.energy).toBe(200000);
  expect(await page.locator('.resources .meter > span').first().evaluate(element => (element as HTMLElement).style.width)).toBe('100%');
  await page.reload(); await expect(page.getByTestId('save-status')).toHaveText('已保存');
  await expect(page.getByTestId('energy-stock')).toHaveText('200 / 200');
});
test('BT-02/03: background catch-up and reopening match the engine and exact report', async ({ page }) => {
  await fresh(page); const before = await saved(page); await wait(page, 300);
  const after = await saved(page), expected = advance(before, 300000);
  expect(after.resources).toEqual(expected.resources); expect(after.ledger).toEqual(expected.ledger);
  expect(after.report).toEqual(summarize(before, expected, 300000));
  await click(page, '收好报告'); const stored = await saved(page);
  await page.clock.setSystemTime(new Date(START.getTime() + 3600000)); await page.reload();
  await expect(page.getByRole('region', { name: '返回报告' })).toBeVisible();
  const reopened = await saved(page), offline = advance(stored, 3300000);
  expect(reopened.resources).toEqual(offline.resources); expect(reopened.ledger).toEqual(offline.ledger);
  expect(reopened.report!.seconds).toBe(3300); expect(reopened.report!.reasons.join()).toContain('满仓');
});
test('BT-04: import/export requires validated preview and retains the previous recovery copy', async ({ page }) => {
  await fresh(page); await click(page, '设置');
  const downloadPromise = page.waitForEvent('download'); await click(page, '导出存档'); const download = await downloadPromise;
  const stream = await download.createReadStream(); const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk)); const exported = Buffer.concat(chunks).toString('utf8');
  expect(decodeSave(exported).state.clock.seconds).toBe(0);
  await wait(page, 60); const before = await saved(page), rawBefore = await page.evaluate(key => localStorage.getItem(key), SAVE_KEY);
  await page.getByLabel('存档文本').fill('{broken'); await click(page, '检查存档');
  await expect(page.getByRole('alert')).toContainText('无法解析'); expect(await page.evaluate(key => localStorage.getItem(key), SAVE_KEY)).toBe(rawBefore);
  const future = JSON.parse(exported); future.schemaVersion = 99;
  await page.getByLabel('存档文本').fill(JSON.stringify(future)); await click(page, '检查存档'); await expect(page.getByRole('alert')).toContainText('版本不兼容');
  await page.getByLabel('选择存档文件', { exact: true }).setInputFiles({ name: 'round-trip.json', mimeType: 'application/json', buffer: Buffer.from(exported) });
  await expect(page.getByLabel('存档文本')).toHaveValue(exported); await click(page, '检查存档');
  await expect(page.getByRole('heading', { name: '检查通过 · 等待确认' })).toBeVisible();
  expect(await page.evaluate(key => localStorage.getItem(key), SAVE_KEY)).toBe(rawBefore);
  await click(page, '确认导入并替换'); await expect(page.getByRole('alert')).toContainText('已导入存档');
  const backup = await page.evaluate(key => localStorage.getItem(key), BACKUP_KEY);
  expect(decodeSave(backup!).state).toEqual(before); expect((await saved(page)).clock.seconds).toBe(60);
  await click(page, '读取恢复副本'); await expect(page.getByRole('alert')).toContainText('已读取有效恢复副本');
  expect((await saved(page)).resources).toEqual(before.resources);
});
test('BT-05: one browser writer, read-only follower, and takeover after closing the owner', async ({ page, context }) => {
  await page.goto('/'); await expect(page.getByTestId('save-status')).toHaveText('已保存');
  await click(page, '安排让临时路灯亮起'); const before = await saved(page);
  const follower = await context.newPage(); await follower.goto('/');
  await expect(follower.getByRole('status').filter({ hasText: '另一页面正在运行' })).toBeVisible();
  await expect(follower.getByRole('button', { name: '安排让临时路灯亮起', exact: true })).toBeDisabled();
  await follower.getByRole('button', { name: '设置', exact: true }).click();
  await expect(follower.getByRole('button', { name: '立即保存', exact: true })).toBeDisabled();
  await expect(follower.getByRole('button', { name: '导出存档', exact: true })).toBeDisabled();
  const locks = await follower.evaluate(async () => navigator.locks.query());
  expect(locks.held!.filter(l => l.name === 'districtzero.writer.v1')).toHaveLength(1);
  expect(locks.pending!.filter(l => l.name === 'districtzero.writer.v1')).toHaveLength(1);
  await page.close(); await expect(follower.getByTestId('save-status')).toHaveText('已保存');
  await expect(follower.getByRole('button', { name: '立即保存', exact: true })).toBeEnabled();
  await expect(follower.getByRole('button', { name: '导出存档', exact: true })).toBeEnabled();
  expect((await saved(follower)).queue[0].uid).toBe(before.queue[0].uid);
  const afterLocks = await follower.evaluate(async () => navigator.locks.query());
  expect(afterLocks.held!.filter(l => l.name === 'districtzero.writer.v1')).toHaveLength(1);
});
test('BT-06: storage failure is visible and current valid progress can still be exported', async ({ page }) => {
  await page.addInitScript(() => { Storage.prototype.setItem = function(key) { if (key.startsWith('districtzero.')) throw new DOMException('Quota exceeded', 'QuotaExceededError'); }; });
  await page.clock.install({ time: START }); await page.clock.pauseAt(START); await page.goto('/');
  await expect(page.getByTestId('save-status')).toContainText('保存失败');
  await page.clock.fastForward(60000); await expect(page.getByTestId('parts-stock')).toContainText('24.4');
  await click(page, '设置'); const downloadPromise = page.waitForEvent('download'); await click(page, '导出存档'); const download = await downloadPromise;
  const stream = await download.createReadStream(), chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  expect(decodeSave(Buffer.concat(chunks).toString('utf8')).state.clock.seconds).toBe(60);
});
test('BT-03/06: corrupt primary recovers; both corrupt slots wait for explicit reset', async ({ page }) => {
  await fresh(page); await wait(page, 60);
  await page.addInitScript(([primary]) => localStorage.setItem(primary, '{broken'), [SAVE_KEY]);
  await page.reload(); await expect(page.getByRole('alert')).toContainText('有效恢复副本');
  await expect(page.getByTestId('save-status')).toHaveText('已保存'); expect((await saved(page)).clock.seconds).toBe(60);
  await page.addInitScript(([primary, backup]) => { localStorage.setItem(primary, '{broken'); localStorage.setItem(backup, '{broken'); }, [SAVE_KEY, BACKUP_KEY]);
  await page.reload(); await expect(page.getByTestId('save-status')).toContainText('原始存档保留');
  await page.clock.fastForward(60000); expect(await page.evaluate(key => localStorage.getItem(key), SAVE_KEY)).toBe('{broken');
  await click(page, '设置'); await click(page, '重置本地进度'); await expect(page.getByRole('dialog')).toContainText('这两个');
  await click(page, '返回'); expect(await page.evaluate(key => localStorage.getItem(key), SAVE_KEY)).toBe('{broken');
  await click(page, '重置本地进度'); await click(page, '确认重置这两个存档');
  await expect(page.getByTestId('save-status')).toHaveText('已保存'); expect((await saved(page)).clock.seconds).toBe(0);
});
for (const [version, resolution] of [
  [{ schemaVersion: 4, balanceVersion: '0.4.0' }, 'import'],
  [{ schemaVersion: 2, balanceVersion: '0.2.1' }, 'reset']
] as const) {
  test(`BT-03/04/06: incompatible save ${JSON.stringify(version)} stays intact until confirmed ${resolution}`, async ({ page }) => {
    const backup = encodeSave(advance(createGame(START.getTime()), 60000), START.getTime());
    const primary = JSON.stringify({ ...JSON.parse(backup), ...version });
    await page.addInitScript(([primaryKey, backupKey, rawPrimary, rawBackup]) => {
      if (!localStorage.getItem(primaryKey)) { localStorage.setItem(primaryKey, rawPrimary); localStorage.setItem(backupKey, rawBackup); }
    }, [SAVE_KEY, BACKUP_KEY, primary, backup]);
    await page.clock.install({ time: START }); await page.clock.pauseAt(START); await page.goto('/');
    await expect(page.getByRole('alert')).toContainText('版本不兼容');
    await expect(page.getByTestId('save-status')).toContainText('原始存档保留');
    await page.clock.fastForward(60000); await expect(page.getByTestId('parts-stock')).toContainText('24.4');
    await click(page, '设置'); await expect(page.getByRole('button', { name: '读取恢复副本', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: '导出存档', exact: true })).toBeDisabled();
    await click(page, '立即保存'); await click(page, '纸色主题');
    expect(await page.evaluate(key => localStorage.getItem(key), SAVE_KEY)).toBe(primary);
    expect(await page.evaluate(key => localStorage.getItem(key), BACKUP_KEY)).toBe(backup);
    await page.reload(); await expect(page.getByTestId('save-status')).toContainText('原始存档保留');
    expect(await page.evaluate(key => localStorage.getItem(key), SAVE_KEY)).toBe(primary);
    expect(await page.evaluate(key => localStorage.getItem(key), BACKUP_KEY)).toBe(backup);
    await click(page, '设置');
    if (resolution === 'import') {
      const replacement = encodeSave(createGame(START.getTime() - 60000), START.getTime() - 60000);
      await page.getByLabel('存档文本').fill(replacement); await click(page, '检查存档');
      await expect(page.getByRole('heading', { name: '检查通过 · 等待确认' })).toBeVisible();
      expect(await page.evaluate(key => localStorage.getItem(key), SAVE_KEY)).toBe(primary);
      expect(await page.evaluate(key => localStorage.getItem(key), BACKUP_KEY)).toBe(backup);
      await click(page, '确认导入并替换'); await expect(page.getByTestId('save-status')).toHaveText('已保存');
      expect((await saved(page)).clock.seconds).toBe(120);
    } else {
      await click(page, '重置本地进度'); await click(page, '返回');
      expect(await page.evaluate(key => localStorage.getItem(key), SAVE_KEY)).toBe(primary);
      await click(page, '重置本地进度'); await click(page, '确认重置这两个存档');
      await expect(page.getByTestId('save-status')).toHaveText('已保存'); expect((await saved(page)).clock.seconds).toBe(0);
    }
    await page.reload(); await expect(page.getByTestId('save-status')).toHaveText('已保存');
    await click(page, '设置'); await expect(page.getByRole('button', { name: '导出存档', exact: true })).toBeEnabled();
    const resolved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), SAVE_KEY);
    expect(resolved.schemaVersion).toBe(10); expect(resolved.balanceVersion).toBe('0.6.1');
  });
}
test('BT-08/FR-05/06: full storage, no repair worker, power exhaustion and recovery have visible reasons', async ({ page }) => {
  await fresh(page); await wait(page, 600); await expect(page.getByText('零件满仓，回收工停止或减产', { exact: true })).toBeVisible();
  await click(page, '安排让临时路灯亮起'); await click(page, '工务');
  await expect(page.getByTestId('queue-reason-P01')).toContainText('未分配维修工');
  await allocation(page, '减少', '影子', '发电工'); await allocation(page, '增加', '影子', '维修工'); await wait(page, 4000);
  await expect(page.getByTestId('energy-stock')).toHaveText('0 / 200');
  await expect(page.getByText('照明供电不足，加成暂时失效', { exact: true })).toBeVisible();
  await allocation(page, '减少', '影子', '维修工'); await allocation(page, '增加', '影子', '发电工'); await wait(page, 60);
  expect((await saved(page)).resources.energy).toBeGreaterThan(0);
  await allocation(page, '减少', '影子', '回收工'); await allocation(page, '增加', '影子', '维修工');
  await click(page, '安排给站牌写上“0”'); await wait(page, 30);
  await page.getByTestId('queue-P02').getByRole('button', { name: '暂停', exact: true }).click();
  const paused = (await saved(page)).queue[0].progress; await wait(page, 30); expect((await saved(page)).queue[0].progress).toBe(paused);
  await page.getByTestId('queue-P02').getByRole('button', { name: '继续', exact: true }).click();
  await page.getByTestId('queue-P02').getByRole('button', { name: '取消项目', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('实际入库'); await click(page, '确认取消');
  expect((await saved(page)).queue).toHaveLength(0);
});
test('BT-07: keyboard confirmation, narrow viewport, and 200 percent text remain usable', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 }); await fresh(page);
  await noOverflow(page); await click(page, '设置'); await page.getByRole('button', { name: '纸色主题', exact: true }).focus(); await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: '纸色主题', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await click(page, '重置本地进度'); await page.keyboard.press('Escape'); await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.addStyleTag({ content: 'body { font-size: 28px; }' }); await noOverflow(page);
});
test('BT-02/FR-09: seven-day browser catch-up completes without different economy rules', async ({ page }) => {
  const state = createGame(START.getTime() - 604800000);
  const planned = applyAction(state, { type: 'enqueue', definition: 'P01' }).state;
  const raw = encodeSave(planned, state.clock.lastAt);
  await page.addInitScript(([key, text]) => localStorage.setItem(key, text), [SAVE_KEY, raw]);
  await fresh(page); const actual = await saved(page), expected = advance(planned, 604800000);
  expect(actual.resources).toEqual(expected.resources); expect(actual.ledger).toEqual(expected.ledger);
  expect(actual.report!.seconds).toBe(604800); expect(actual.queue[0].status).toBe('waiting');
});
