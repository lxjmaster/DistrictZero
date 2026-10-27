import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { ARCHIVES } from '../../src/game/journey';
import { advance, summarize } from '../../src/game/engine';
import { assertInvariants, decodeSave } from '../../src/game/saves';
import { BACKUP_KEY, SAVE_KEY } from '../../src/app/storage';
import { RESOURCES } from '../../src/game/config';
import type { GameState, Resource } from '../../src/game/types';

const NOW = Date.parse('2026-10-27T06:00:00Z');
const click = (page: Page, name: string) => page.getByRole('button', { name, exact: true }).click();
const saved = (page: Page): Promise<GameState> => page.evaluate(key => JSON.parse(localStorage.getItem(key)!).state, SAVE_KEY);
async function seed(page: Page, name: string, elapsed = 0, change?: (state: GameState) => void) {
  const source = JSON.parse(await readFile(new URL(`../fixtures/v0.6-${name}.json`, import.meta.url), 'utf8'));
  if (change) change(source.state);
  source.savedAt = source.state.clock.lastAt = NOW - elapsed;
  const text = JSON.stringify(source);
  decodeSave(text);
  await page.clock.install({ time: new Date(NOW) }); await page.clock.pauseAt(new Date(NOW));
  await page.addInitScript(({ key, text }) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, text);
    (window as any).__epilogueClicks = 0;
    document.addEventListener('click', () => (window as any).__epilogueClicks++);
  }, { key: SAVE_KEY, text });
  return text;
}
async function wait(page: Page, seconds: number) {
  const before = await saved(page); await page.clock.fastForward(seconds * 1000);
  await expect.poll(async () => (await saved(page)).clock.seconds).toBe(before.clock.seconds + seconds);
}

for (const [resource, label, available] of [
  ['memory', '记忆', '3.999'],
  ['component', '标准构件', '0.999'],
  ['rainFilm', '雨声胶片', '1.999'],
  ['railCore', '轨芯', '1.999']
] as [Resource, string, string][]) {
  test(`T02/T08: A04 displays the smallest missing ${label} unit accurately`, async ({ page }) => {
    // Keep conservation valid while making this one material short by 0.001.
    await seed(page, 'ready', 0, state => {
      const left = ARCHIVES.A04.cost[resource] - 1;
      state.ledger.operating[resource] += state.resources[resource] - left;
      state.resources[resource] = left;
    });
    await page.goto('/'); await expect(page.getByTestId('save-status')).toHaveText('已保存');
    await click(page, '档案'); const card = page.getByTestId('archive-A04');
    await expect(card).toContainText(`${available} ${label}`);
    await expect(card).toContainText(`缺少 0.001 ${label}`);
    await expect(card.getByRole('button', { name: '交接并收藏', exact: true })).toBeDisabled();
    if (resource === 'memory') {
      await page.clock.fastForward(1000);
      await expect(card.getByRole('button', { name: '交接并收藏', exact: true })).toBeEnabled();
      await expect(card).not.toContainText('缺少 0.001 记忆');
    }
  });
}

for (const mobile of [false, true]) for (const route of ['ordinary', 'inventory'] as const) {
  test(`T01-08: ${route} A04 handoff, recovery and reopening on ${mobile ? '320px' : 'desktop'}`, async ({ browser }, info) => {
    const context = await browser.newContext({ viewport: mobile ? { width: 320, height: 740 } : { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
    const page = await context.newPage(), errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    const original = await seed(page, route === 'ordinary' ? 'chapter' : 'ready');
    await page.goto('/'); await expect(page.getByTestId('save-status')).toHaveText('已保存');
    expect(await page.evaluate(key => localStorage.getItem(key), BACKUP_KEY)).toBe(original);
    await click(page, '档案'); const card = page.getByTestId('archive-A04');
    await expect(card).toContainText('可选尾声'); await expect(card).toContainText('无数值收益或后续维护');
    await expect(card).toContainText('旧城可用：'); await expect(page.getByTestId('archive-A01')).toHaveCount(0);
    if (route === 'ordinary') {
      await expect(card.getByRole('button', { name: '交接并收藏', exact: true })).toBeDisabled();
      await expect(card).toContainText('雨声胶片'); await expect(card).toContainText('轨芯');
      await click(page, '夜网');
      for (const [id, name, recipe] of [['rain', '雨城', '雨声封装'], ['station', '长站', '轨芯整备']]) {
        const line = page.getByTestId(`route-${id}`);
        await line.getByRole('button', { name: `切换为${recipe}`, exact: true }).click(); await click(page, `确认切换${name}生产`);
        await page.getByLabel(`${name}补给包数`, { exact: true }).fill('1'); await click(page, `发车补给${name}`);
      }
      await wait(page, 120);
      await page.getByLabel('雨城手动常规包数', { exact: true }).fill('0'); await page.getByLabel('雨城手动特产包数', { exact: true }).fill('1'); await click(page, '发车取回雨城');
      await wait(page, 60);
      await page.getByLabel('长站手动常规包数', { exact: true }).fill('0'); await page.getByLabel('长站手动特产包数', { exact: true }).fill('1'); await click(page, '发车取回长站');
      await wait(page, 180); await click(page, '档案');
    }
    const before = await saved(page); expect(before.resources.rainFilm).toBeGreaterThanOrEqual(2000); expect(before.resources.railCore).toBeGreaterThanOrEqual(2000);
    await card.getByRole('button', { name: '交接并收藏', exact: true }).click(); await card.getByRole('button', { name: '暂时收好材料', exact: true }).click();
    expect(await saved(page)).toEqual(before);
    await card.getByRole('button', { name: '交接并收藏', exact: true }).click();
    const confirm = card.getByRole('button', { name: '确认交接A04', exact: true });
    await confirm.focus(); await page.keyboard.press('Enter');
    await expect(card).toContainText(ARCHIVES.A04.text); await expect(card.getByRole('button')).toHaveCount(0);
    const completed = await saved(page); assertInvariants(completed);
    for (const r of RESOURCES) { expect(before.resources[r] - completed.resources[r]).toBe(ARCHIVES.A04.cost[r]); expect(completed.ledger.fulfillment[r] - before.ledger.fulfillment[r]).toBe(ARCHIVES.A04.cost[r]); }
    expect(completed.earned).toEqual(before.earned); expect(completed.clock).toEqual(before.clock);
    expect(completed.network).toEqual(before.network); expect(completed.calendar).toEqual(before.calendar); expect(completed.covenants).toEqual(before.covenants);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('仍有下一页');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`${route}-${mobile ? 'mobile' : 'desktop'}-a04.png`), fullPage: true, animations: 'disabled' });
    const clicks = await page.evaluate(() => (window as any).__epilogueClicks);
    await writeFile(info.outputPath('route.json'), JSON.stringify({ mobile, route, clicksThroughHandoff: clicks, state: completed }, null, 2));
    await click(page, '设置'); await expect(page.getByText('DistrictZero V0.6.1', { exact: false })).toContainText('存档结构版本 10');
    const download = page.waitForEvent('download'); await click(page, '导出存档');
    const stream = await (await download).createReadStream(), chunks: Buffer[] = []; for await (const part of stream!) chunks.push(Buffer.from(part));
    const text = Buffer.concat(chunks).toString(); expect(JSON.parse(text)).toMatchObject({ schemaVersion: 10, balanceVersion: '0.6.1' }); expect(decodeSave(text).state).toEqual(completed);
    await writeFile(info.outputPath('completed-save.json'), text);
    // Restore the actual pre-handoff recovery copy, then use the explicit import UI.
    await click(page, '读取恢复副本'); await expect.poll(async () => (await saved(page)).experience.archives.includes('A04')).toBe(false);
    await page.getByLabel('存档文本', { exact: true }).fill(text); await click(page, '检查存档'); await click(page, '确认导入并替换');
    expect(await saved(page)).toEqual(completed);
    const bad = JSON.parse(text); bad.state.experience.archives.push('A04');
    await page.getByLabel('存档文本', { exact: true }).fill(JSON.stringify(bad)); await click(page, '检查存档'); await expect(page.getByRole('alert').filter({ hasText: '存档无效' })).toBeVisible(); expect(await saved(page)).toEqual(completed);
    await page.reload(); await expect(page.getByTestId('save-status')).toHaveText('已保存'); await click(page, '档案');
    await expect(page.getByTestId('archive-A04')).toContainText(ARCHIVES.A04.text); expect(await saved(page)).toEqual(completed);
    expect(errors).toEqual([]); await context.close();
  });
}

test('T03/T06/T08: genuine held/in-transit/dual-covenant old interval and original recovery bytes', async ({ page }) => {
  const elapsed = 86400517, original = await seed(page, 'boundary', elapsed), before = decodeSave(original).state;
  const expected = advance(before, elapsed); expected.clock.lastAt = NOW; expected.report = summarize(before, expected, elapsed);
  await page.addInitScript(key => {
    const write = Storage.prototype.setItem; (window as any).__a04Writes = [];
    Storage.prototype.setItem = function(k, value) { if (k === key) (window as any).__a04Writes.push(value); return write.call(this, k, value); };
  }, SAVE_KEY);
  await page.goto('/'); await expect(page.getByTestId('save-status')).toHaveText('已保存');
  expect(await saved(page)).toEqual(expected); expect(await page.evaluate(key => localStorage.getItem(key), BACKUP_KEY)).toBe(original);
  expect(await page.evaluate(() => (window as any).__a04Writes.length)).toBe(1);
  await click(page, '档案'); await expect(page.getByTestId('archive-A04').getByRole('button', { name: '交接并收藏' })).toBeDisabled();
});

test('T08: follower cannot expose a second handoff and takeover reads the completed A04', async ({ browser }) => {
  const context = await browser.newContext(), owner = await context.newPage(); await seed(owner, 'ready');
  await owner.goto('/'); await expect(owner.getByTestId('save-status')).toHaveText('已保存');
  const follower = await context.newPage(); await follower.clock.install({ time: new Date(NOW) }); await follower.clock.pauseAt(new Date(NOW));
  await follower.goto('/'); await expect(follower.getByText('另一页面正在运行，或正在取得会话。此页暂不推进、不写入；关闭主页面后会自动接管。', { exact: true })).toBeVisible();
  await click(follower, '档案'); await expect(follower.getByTestId('archive-A04')).toHaveCount(0);
  const before = await saved(owner); expect(await saved(follower)).toEqual(before);
  await click(owner, '档案'); await click(owner, '交接并收藏'); await click(owner, '确认交接A04');
  const completed = await saved(owner); await owner.close(); await expect(follower.getByTestId('save-status')).toHaveText('已保存');
  await expect(follower.getByTestId('archive-A04')).toContainText(ARCHIVES.A04.text); expect(await saved(follower)).toEqual(completed);
  await context.close();
});

test('T08: real settlement disables A04 until the complete interval has finished', async ({ page }) => {
  await seed(page, 'ready'); await page.goto('/'); await expect(page.getByTestId('save-status')).toHaveText('已保存');
  await click(page, '档案'); const button = page.getByTestId('archive-A04').getByRole('button', { name: '交接并收藏', exact: true });
  await expect(button).toBeEnabled(); const before = await saved(page);
  // Hold the controller's first task yield after React has initialized its own
  // scheduler. This pauses work delivery, without changing game rules or stock.
  await page.evaluate(() => {
    const Native = window.MessageChannel;
    window.MessageChannel = class extends Native {
      constructor() {
        super(); const post = this.port2.postMessage.bind(this.port2);
        this.port2.postMessage = (message: unknown) => { (window as any).__releaseA04Settlement = () => { window.MessageChannel = Native; post(message); }; };
      }
    };
  });
  await page.clock.setSystemTime(new Date(NOW + 2_000_000));
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(page.getByText(/正在整理离开期间的交接记录/)).toBeVisible(); await expect(button).toBeDisabled();
  expect(await saved(page)).toEqual(before);
  await page.evaluate(() => (window as any).__releaseA04Settlement());
  await expect(page.getByText(/正在整理离开期间的交接记录/)).toHaveCount(0); await expect(button).toBeEnabled();
  await click(page, '设置'); await click(page, '立即保存'); const after = await saved(page);
  expect(after.clock.seconds).toBe(before.clock.seconds + 2000); expect(after.ledger.fulfillment).toEqual(before.ledger.fulfillment); expect(after.experience.archives).toEqual([]);
});
