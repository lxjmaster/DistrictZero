import { expect, test } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { COVENANTS, COVENANT_IDS, covenantProof } from '../../src/game/covenants';
import { advance, definitionFor, summarize } from '../../src/game/engine';
import { assertInvariants, decodeSave } from '../../src/game/saves';
import { RESOURCES } from '../../src/game/config';
import { SAVE_KEY, BACKUP_KEY } from '../../src/app/storage';
import type { CovenantId, DefinitionId, GameState } from '../../src/game/types';
import type { Page } from '@playwright/test';

test.setTimeout(180000);
const START = Date.parse('2026-10-25T06:00:00Z');
const saved = (page: Page): Promise<GameState> => page.evaluate(key => JSON.parse(localStorage.getItem(key)!).state, SAVE_KEY);
const click = (page: Page, name: string) => page.getByRole('button', { name, exact: true }).click();
async function wait(page: Page, seconds: number) {
  const before = await saved(page); await page.clock.fastForward(seconds * 1000);
  if (seconds < 10) {
    // Automatic persistence runs every ten seconds; explicitly save the real
    // one-second state through the UI before inspecting its serialized result.
    await click(page, '设置'); await click(page, '立即保存'); await click(page, '公约');
  }
  await expect.poll(async () => (await saved(page)).clock.seconds).toBe(before.clock.seconds + seconds);
  await expect(page.getByTestId('save-status')).toHaveText('已保存');
}
async function story(page: Page, id: string) { await page.getByTestId(`story-${id}`).getByRole('button', { name: '读完公约来信', exact: true }).click(); }
async function project(page: Page, id: DefinitionId) {
  const before = await saved(page), quote = definitionFor(before, id);
  await click(page, `安排${quote.name}`);
  for (let i = 0; i < 30 && !(await saved(page)).completed.includes(id); i++) await wait(page, 60);
  const after = await saved(page); expect(after.completed).toContain(id);
  for (const r of RESOURCES) expect(after.ledger.reserved[r] - before.ledger.reserved[r]).toBe(quote.cost[r]); assertInvariants(after);
}
async function select(page: Page, ids: CovenantId[]) {
  for (const id of COVENANT_IDS) await page.getByLabel(COVENANTS[id].name, { exact: true }).setChecked(ids.includes(id));
  const before = await saved(page);
  await click(page, '预览并确认公约'); const dialog = page.getByRole('dialog', { name: '确认城市公约', exact: true });
  await expect(dialog).toContainText('本次：'); await expect(dialog).toContainText('下');
  await dialog.getByRole('button', { name: '支付调整费并确认', exact: true }).focus(); await page.keyboard.press('Enter');
  const after = await saved(page); expect(after.covenants.selected).toEqual(COVENANT_IDS.filter(id => ids.includes(id))); expect(after.covenants.paidSecond).toBeNull();
  expect(after.resources.energy).toBe(before.resources.energy - 6000); expect(after.resources.parts).toBe(before.resources.parts - 4000); expect(after.resources.memory).toBe(before.resources.memory - 2000);
  assertInvariants(after);
}

for (const mobile of [false, true]) test(`G01-10: genuine V0.5 migration, all directions and combinations, complete chapter on ${mobile ? 'mobile' : 'desktop'}`, async ({ browser }, info) => {
  const context = await browser.newContext({ viewport: mobile ? { width: 320, height: 740 } : { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  let page = await context.newPage(); const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.clock.install({ time: new Date(START) }); await page.clock.pauseAt(new Date(START));
  const source = JSON.parse(await readFile(new URL('../fixtures/v0.5-chapter.json', import.meta.url), 'utf8'));
  source.savedAt = START; source.state.clock.lastAt = START; // Clock metadata only; every economic value is genuine.
  await page.addInitScript(({ key, text }) => localStorage.setItem(key, text), { key: SAVE_KEY, text: JSON.stringify(source) });
  await page.goto('/'); await expect(page.getByTestId('save-status')).toHaveText('已保存');
  expect((await saved(page)).covenants.selected).toEqual([]);
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).schemaVersion, BACKUP_KEY)).toBe(8);
  await story(page, 'L06-1'); await click(page, '公约'); await project(page, 'P17'); await story(page, 'L06-2');
  const beforeDraft = await saved(page);
  await page.getByLabel(COVENANTS.preserve.name, { exact: true }).check(); await click(page, '预览并确认公约'); await page.keyboard.press('Escape');
  expect((await saved(page)).covenants).toEqual(beforeDraft.covenants);
  await select(page, ['preserve']); await wait(page, 60); expect(covenantProof(await saved(page), 'preserve')).toBe(true);
  const preserved = await saved(page);
  await page.getByLabel('公约电量保留', { exact: true }).fill('bad'); await expect(page.getByRole('button', { name: '预览并确认公约', exact: true })).toBeDisabled();
  await click(page, '免费暂停全部公约'); expect((await saved(page)).resources).toEqual(preserved.resources);
  await expect(page.getByTestId('covenant-status')).toContainText('已暂停');
  await select(page, ['extend']);
  // P18 is real work, and supplies the first actual accelerated-work evidence.
  await project(page, 'P18'); await story(page, 'L06-3'); expect(covenantProof(await saved(page), 'extend')).toBe(true);
  await select(page, ['coexist']); await wait(page, 60); expect(covenantProof(await saved(page), 'coexist')).toBe(false);
  await click(page, '夜网'); const beforeTrain = await saved(page);
  await page.getByLabel('雨城补给包数', { exact: true }).fill('1'); await click(page, '发车补给雨城');
  const train = (await saved(page)).network.routes.rain.trip!; expect(train.fee).toBe(4800); expect(train.spaceReserved).toBe(true);
  expect((await saved(page)).covenants.feeSaved - beforeTrain.covenants.feeSaved).toBe(1200);
  await click(page, '公约');
  await select(page, ['preserve', 'extend']); expect((await saved(page)).network.routes.rain.trip).toEqual(train); await wait(page, 60);
  await select(page, ['preserve', 'coexist']); await wait(page, 60);
  await select(page, ['extend', 'coexist']); await wait(page, 60);
  for (const id of COVENANT_IDS) expect(covenantProof(await saved(page), id)).toBe(true);
  await page.getByLabel(COVENANTS.preserve.name, { exact: true }).check(); await expect(page.getByRole('button', { name: '预览并确认公约', exact: true })).toBeDisabled();
  await page.getByLabel(COVENANTS.preserve.name, { exact: true }).uncheck();
  await project(page, 'P19'); await story(page, 'L06-4');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('仍有下一页');
  const complete = await saved(page); assertInvariants(complete);
  await click(page, '设置'); const download = page.waitForEvent('download'); await click(page, '导出存档');
  const stream = await (await download).createReadStream(), chunks: Buffer[] = []; for await (const part of stream!) chunks.push(Buffer.from(part));
  const exported = Buffer.concat(chunks).toString(); expect(JSON.parse(exported)).toMatchObject({ schemaVersion: 9, balanceVersion: '0.6.0' }); expect(decodeSave(exported).state).toEqual(complete);
  await writeFile(info.outputPath(`${mobile ? 'mobile' : 'desktop'}-v06-save.json`), exported);
  const forged = JSON.parse(exported); forged.state.covenants.paid.extend++;
  await page.getByLabel('存档文本', { exact: true }).fill(JSON.stringify(forged)); await click(page, '检查存档'); await expect(page.getByRole('alert')).toBeVisible();
  expect(await saved(page)).toEqual(complete);
  await click(page, '公约');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath(`${mobile ? 'mobile' : 'desktop'}-v06.png`), fullPage: true });
  const now = await page.evaluate(() => Date.now()); await page.close(); page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
  await page.clock.install({ time: new Date(now + 900517) }); await page.clock.pauseAt(new Date(now + 900517)); await page.goto('/');
  await expect(page.getByTestId('save-status')).toHaveText('已保存'); const after = await saved(page), expected = advance(complete, 900517); expected.clock.lastAt = now + 900517; expected.report = summarize(complete, expected, 900517);
  expect(after).toEqual(expected); await expect(page.getByTestId('covenant-report')).toContainText('实际付费与成果');
  await expect(page.getByTestId('covenant-report')).toContainText(`当前确认：${COVENANTS.extend.name}＋${COVENANTS.coexist.name}`);
  await click(page, '公约'); await click(page, '免费暂停全部公约'); expect((await saved(page)).covenants.selected).toEqual([]);
  expect(errors).toEqual([]); await context.close();
});

test('G03/G07/G09: actual shortage is visible, next-second recovery works, and only one tab can change covenants', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 320, height: 740 } }), page = await context.newPage();
  await page.clock.install({ time: new Date(START) }); await page.clock.pauseAt(new Date(START));
  const source = JSON.parse(await readFile(new URL('../fixtures/v0.5-chapter.json', import.meta.url), 'utf8'));
  source.savedAt = START; source.state.clock.lastAt = START;
  await page.addInitScript(({ key, text }) => localStorage.setItem(key, text), { key: SAVE_KEY, text: JSON.stringify(source) });
  await page.goto('/'); await expect(page.getByTestId('save-status')).toHaveText('已保存');
  await story(page, 'L06-1'); await click(page, '公约'); await project(page, 'P17'); await story(page, 'L06-2');
  const initial = await saved(page);
  await page.getByLabel('公约电量保留', { exact: true }).fill(String((initial.resources.energy - 6000) / 1000));
  await select(page, ['preserve']); const before = await saved(page); await wait(page, 1);
  const blocked = await saved(page); expect(blocked.covenants.blocked).toBe(before.covenants.blocked + 1); expect(blocked.covenants.upkeep).toEqual(before.covenants.upkeep);
  await expect(page.getByTestId('covenant-status')).toContainText('本秒维护材料或保留库存不足');
  await wait(page, 1); await expect(page.getByTestId('covenant-status')).toContainText('本秒已付费生效');
  const follower = await context.newPage(); const now = await page.evaluate(() => Date.now());
  await follower.clock.install({ time: new Date(now) }); await follower.clock.pauseAt(new Date(now)); await follower.goto('/');
  await follower.getByText('另一页面正在运行，或正在取得会话。此页暂不推进、不写入；关闭主页面后会自动接管。', { exact: true }).waitFor();
  // A follower starts with an empty in-memory view until it owns the lock; it
  // cannot mutate the owner's save or get a second simulation interval.
  const checkpoint = await saved(page); expect(await saved(follower)).toEqual(checkpoint);
  await page.close(); await expect(follower.getByTestId('save-status')).toHaveText('已保存');
  await click(follower, '公约'); await expect(follower.getByRole('button', { name: '免费暂停全部公约', exact: true })).toBeEnabled();
  await follower.getByLabel('公约电量保留', { exact: true }).fill('bad'); await click(follower, '免费暂停全部公约');
  expect((await saved(follower)).covenants.selected).toEqual([]); assertInvariants(await saved(follower)); await context.close();
});
