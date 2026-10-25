import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { BACKUP_KEY, SAVE_KEY } from '../../src/app/storage';
import { JOBS, RESOURCES, jobNames, residentNames } from '../../src/game/config';
import { advance, freeResidents, summarize } from '../../src/game/engine';
import { OUTPOSTS, outpostAssemblyRecipe, outpostDefinition } from '../../src/game/outposts';
import { assertInvariants, decodeSave, encodeSave } from '../../src/game/saves';
import type { DefinitionId, GameState, Job, OutpostId, OutpostProof, Resident } from '../../src/game/types';

test.use({ actionTimeout: 10000 });
test.setTimeout(180000);
const START = new Date('2026-10-23T10:00:00Z');
const saved = (page: Page): Promise<GameState> => page.evaluate(key => JSON.parse(localStorage.getItem(key)!).state, SAVE_KEY);
const click = (page: Page, name: string) => page.getByRole('button', { name, exact: true }).click();

// This route starts from a genuine released save and uses only visible player
// actions. Time is accelerated; neither inventory nor completions are injected.
class Route {
  readonly actions: { second: number; action: string; active: OutpostId | null }[] = [];
  readonly milestones: Record<string, GameState> = {};
  readonly awayPersonSeconds: Record<OutpostId, number> = { O01: 0, O02: 0 };
  constructor(readonly page: Page) {}
  async mark(name: string) { this.milestones[name] = await saved(this.page); }
  async note(action: string) {
    const state = await saved(this.page);
    this.actions.push({ second: state.clock.seconds, action, active: state.outposts.active });
  }
  async press(name: string) { await this.note(name); await click(this.page, name); }
  async wait(seconds: number) {
    const before = await saved(this.page);
    if (before.outposts.active) this.awayPersonSeconds[before.outposts.active] += before.outposts.crew.length * seconds;
    await this.page.clock.fastForward(seconds * 1000);
    await expect.poll(async () => (await saved(this.page)).clock.seconds, { timeout: 30000 }).toBe(before.clock.seconds + seconds);
    await expect(this.page.getByTestId('save-status')).toHaveText('已保存');
  }
  async until(condition: (state: GameState) => boolean, label: string, limit = 2400) {
    for (let elapsed = 0; elapsed < limit; elapsed += 60) {
      if (condition(await saved(this.page))) return;
      await this.wait(60);
    }
    expect(condition(await saved(this.page)), label).toBe(true);
  }
  async story(node: string) {
    await this.note(`read ${node}`);
    await this.page.getByTestId(`story-${node}`).getByRole('button', { name: '读完分所来信', exact: true }).click();
  }
  async assign(id: OutpostId, resident: Resident, job: Job | null) {
    const site = (await saved(this.page)).outposts.sites[id]!;
    for (const previous of JOBS) if (previous !== job) {
      for (let n = 0; n < site.assignments[resident][previous]; n++) await this.press(`${OUTPOSTS[id].name}减少${residentNames[resident]}${jobNames[previous]}`);
    }
    if (job && !site.assignments[resident][job]) await this.press(`${OUTPOSTS[id].name}增加${residentNames[resident]}${jobNames[job]}`);
  }
  async parts(id: OutpostId, target: number) {
    if ((await saved(this.page)).outposts.sites[id]!.resources.parts >= target) return;
    await this.assign(id, 'echo', 'salvage');
    await this.until(state => state.outposts.sites[id]!.resources.parts >= target, `${id} genuinely recovers ${target} parts`);
  }
  async prepare(id: OutpostId, definition: DefinitionId, prefab = 0) {
    await this.assign(id, 'shadow', 'power');
    let state = await saved(this.page);
    const quote = outpostDefinition(state, id, definition, undefined, prefab);
    if (state.outposts.sites[id]!.resources.memory < quote.cost.memory) {
      // Deliberately keep a small raw-material cushion while the recorder works.
      // It is produced through the ordinary recycler, not granted by the test.
      await this.parts(id, Math.max(10000, (quote.cost.memory - state.outposts.sites[id]!.resources.memory) * 2));
      await this.assign(id, 'echo', 'record');
      await this.until(current => current.outposts.sites[id]!.resources.memory >= quote.cost.memory, `${id} genuinely records project memory`);
    }
    state = await saved(this.page);
    const componentShortage = quote.cost.component - state.outposts.sites[id]!.resources.component;
    if (componentShortage > 0) {
      const recipe = outpostAssemblyRecipe(state, id);
      await this.parts(id, Math.ceil(componentShortage * recipe.parts) + 10000);
      await this.page.getByLabel(`${OUTPOSTS[id].name}构件目标`, { exact: true }).fill(String(quote.cost.component / 1000));
      await this.page.getByLabel(`${OUTPOSTS[id].name}零件保留`, { exact: true }).fill('10');
      await this.page.getByLabel(`${OUTPOSTS[id].name}电量保留`, { exact: true }).fill('10');
      await this.press('保存并启用本地装配'); await this.assign(id, 'echo', 'assemble');
      await this.until(current => current.outposts.sites[id]!.resources.component >= quote.cost.component, `${id} genuinely assembles project components`);
      await this.press('暂停本地装配');
    }
    await this.parts(id, quote.cost.parts);
    await this.assign(id, 'echo', null);
    await this.until(current => current.outposts.sites[id]!.resources.energy >= quote.cost.energy, `${id} genuinely generates project energy`);
    return quote;
  }
  async project(id: OutpostId, definition: DefinitionId, prefab = 0, proof: OutpostProof = 'local') {
    const quote = await this.prepare(id, definition, prefab);
    const before = await saved(this.page), base = outpostDefinition(before, id, definition);
    if (prefab) await this.page.getByLabel(`${OUTPOSTS[id].name}${base.name}预制份数`, { exact: true }).selectOption(String(prefab));
    if (definition === 'O02-2') await this.page.getByTestId('outpost-project-O02-2').getByRole('radio', { name: proof === 'local' ? /^本地值守/ : /^旧城接力/ }).check();
    await this.assign(id, 'echo', 'repair'); await this.press(`安排${OUTPOSTS[id].name}${base.name}`);
    if (definition === 'O02-2') {
      const card = this.page.getByTestId('outpost-project-O02-2');
      const selected = card.getByRole('radio', { name: proof === 'local' ? /^本地值守/ : /^旧城接力/ });
      const alternative = card.getByRole('radio', { name: proof === 'local' ? /^旧城接力/ : /^本地值守/ });
      await this.press('工务'); await this.press('分所');
      await expect(selected).toBeChecked(); await expect(alternative).not.toBeChecked(); await expect(selected).toBeDisabled();
      await this.page.reload(); await expect(this.page.getByTestId('save-status')).toHaveText('已保存'); await this.press('分所');
      await expect(selected).toBeChecked(); await expect(alternative).not.toBeChecked(); await expect(alternative).toBeDisabled();
      expect((await saved(this.page)).queue.find(project => project.definition === definition && project.outpost === id)!.proof).toBe(proof);
      // Cancelling releases the choice; verify the other proof can actually be
      // queued, then restore this route's intended proof before advancing time.
      for (const nextProof of [proof === 'local' ? 'relay' : 'local', proof] as const) {
        await this.note(`cancel ${definition} and select ${nextProof}`);
        await this.page.getByTestId(`queue-${definition}`).getByRole('button', { name: '取消项目', exact: true }).click();
        await this.page.getByRole('dialog', { name: '取消这张维修单', exact: true }).getByRole('button', { name: '确认取消', exact: true }).click();
        const choice = card.getByRole('radio', { name: nextProof === 'local' ? /^本地值守/ : /^旧城接力/ });
        await expect(choice).toBeEnabled(); await choice.check(); await this.press(`安排${OUTPOSTS[id].name}${base.name}`);
        expect((await saved(this.page)).queue.find(project => project.definition === definition && project.outpost === id)!.proof).toBe(nextProof);
      }
    }
    const queued = (await saved(this.page)).queue.find(project => project.definition === definition && project.outpost === id)!;
    expect(queued.outpost).toBe(id); expect(queued.prefab).toBe(prefab);
    if (definition === 'O02-2') expect(queued.proof).toBe(proof);
    await expect(this.page.getByTestId(`queue-${definition}`)).toContainText(OUTPOSTS[id].name);
    await this.until(state => !state.queue.some(project => project.uid === queued.uid), `${definition} completes with local workers`);
    const after = await saved(this.page), key = definition.startsWith('build:') ? `${definition}:${queued.targetLevel}` : definition;
    expect(after.outposts.sites[id]!.completed).toContain(key);
    for (const resource of RESOURCES) expect(after.outposts.sites[id]!.ledger.reserved[resource] - before.outposts.sites[id]!.ledger.reserved[resource]).toBe(quote.cost[resource]);
    assertInvariants(after); await this.mark(`${id}/${key}`);
  }
  async open(id: OutpostId, reopening = false) {
    await this.press(`查看${OUTPOSTS[id].name}`);
    const before = await saved(this.page), shadowFree = freeResidents(before, 'shadow', 'district-1'), echoFree = freeResidents(before, 'echo', 'district-2');
    await this.page.getByLabel(`${OUTPOSTS[id].name}第1位派驻者`, { exact: true }).selectOption('district-1/shadow');
    await this.page.getByLabel(`${OUTPOSTS[id].name}第2位派驻者`, { exact: true }).selectOption('district-2/echo');
    await expect(this.page.getByLabel(`${OUTPOSTS[id].name}派驻预览`, { exact: true })).toContainText(`选择1，派出后空闲${shadowFree - 1}`);
    await this.press(`${reopening ? '重新入驻' : '确认开设'}${OUTPOSTS[id].name}`);
    const after = await saved(this.page);
    expect(after.outposts.active).toBe(id); expect(after.outposts.crew).toHaveLength(2);
    expect(freeResidents(after, 'shadow', 'district-1')).toBe(shadowFree - 1); expect(freeResidents(after, 'echo', 'district-2')).toBe(echoFree - 1);
    expect(after.city.districts['district-1']!.population).toEqual(before.city.districts['district-1']!.population);
    expect(after.city.districts['district-2']!.population).toEqual(before.city.districts['district-2']!.population);
    if (reopening) {
      expect(after.outposts.sites[id]).toEqual(before.outposts.sites[id]);
      expect(after.resources).toEqual(before.resources); expect(after.ledger.supportSent).toEqual(before.ledger.supportSent);
    } else {
      expect(after.outposts.sites[id]!.resources).toMatchObject({ energy: 20000, parts: 20000, memory: 8000, component: 0 });
      expect(after.outposts.sites[id]!.assembly.enabled).toBe(false);
    }
    await this.mark(`${id}/${reopening ? 'reopened' : 'opened'}`);
  }
  async seal(id: OutpostId) {
    await this.press(`查看封存${OUTPOSTS[id].name}影响`);
    const group = this.page.getByRole('group', { name: `确认封存${OUTPOSTS[id].name}`, exact: true });
    await expect(group).toBeFocused();
    if ((await saved(this.page)).outposts.support.queue.length) {
      await expect(group.getByRole('button', { name: `确认封存${OUTPOSTS[id].name}`, exact: true })).toBeDisabled();
      await group.getByRole('checkbox').check();
    }
    await this.press(`确认封存${OUTPOSTS[id].name}`);
    const state = await saved(this.page); expect(state.outposts.active).toBeNull(); expect(state.outposts.crew).toEqual([]);
    expect(state.outposts.support).toMatchObject({ enabled: false, queue: [], trip: null });
    for (const resident of ['shadow', 'echo'] as const) expect(Object.values(state.outposts.sites[id]!.assignments[resident]).every(n => n === 0)).toBe(true);
    await this.mark(`${id}/sealed`);
  }
  async offlineReport(seconds: number, id: OutpostId) {
    const before = await saved(this.page);
    this.awayPersonSeconds[id] += before.outposts.crew.length * seconds;
    await this.page.clock.setSystemTime(new Date(before.clock.lastAt + seconds * 1000)); await this.page.reload();
    await expect(this.page.getByTestId('save-status')).toHaveText('已保存');
    const after = await saved(this.page), entry = after.report!.outposts!.find(item => item.id === id)!;
    expect(after.clock.seconds).toBe(before.clock.seconds + seconds); expect(entry.pending.join()).toContain('交接');
    await this.page.getByRole('region', { name: '返回报告', exact: true }).getByText('展开详细账本与完工记录', { exact: true }).click();
    const report = this.page.getByRole('region', { name: '分所返回记录', exact: true });
    await expect(report).toContainText('追加额度'); await expect(report).toContainText('在途'); await expect(report).toContainText('待处理');
    await this.mark(`${id}/offline-report`); await this.press('收好报告'); await this.press('分所');
  }
}

async function start(page: Page, route: Route) {
  const raw = JSON.parse(await readFile(new URL('../fixtures/v0.3.3-chapter.json', import.meta.url), 'utf8'));
  raw.savedAt = START.getTime(); raw.state.clock.lastAt = START.getTime();
  await page.addInitScript(([key, text]) => { if (!localStorage.getItem(key)) localStorage.setItem(key, text); }, [SAVE_KEY, JSON.stringify(raw)]);
  await page.clock.install({ time: START }); await page.clock.pauseAt(START); await page.goto('/');
  await expect(page.getByTestId('save-status')).toHaveText('已保存'); await expect(page.getByRole('alert')).toContainText('V0.3.3存档已迁移');
  expect(JSON.parse(await page.evaluate(key => localStorage.getItem(key)!, BACKUP_KEY)).schemaVersion).toBe(6);
  await route.press('知道了'); if (raw.state.report) await route.press('收好报告');
  await route.mark('migrated'); expect((await saved(page)).outposts.sites).toEqual({});
  await expect(page.getByRole('button', { name: '分所', exact: true })).toHaveCount(0);
  // These explicit ordinary UI choices prevent old automatic work from taking
  // the sole queue while preserving the old city's actual production model.
  await route.press('关闭本区自动巡检'); await route.press('夜网');
  for (const city of ['雨城', '长站']) {
    const pause = page.getByRole('button', { name: `暂停${city}供货合同`, exact: true });
    if (await pause.isVisible()) await route.press(`暂停${city}供货合同`);
    await route.press(`关闭${city}自动维护`);
  }
  await route.story('L04-1'); await route.press('分所');
  await expect(page.getByRole('button', { name: '安排设立分所登记台', exact: true })).toHaveCount(1);
  await route.press('安排设立分所登记台'); await route.until(state => state.completed.includes('P12'), 'P12 uses genuine home stock and home workers');
  await route.mark('P12'); await route.story('L04-2');
}

async function invalidDrafts(page: Page, route: Route, id: OutpostId) {
  const label = `${OUTPOSTS[id].name}构件目标`;
  await page.getByLabel(label, { exact: true }).fill('0'); await route.press('保存并启用本地装配');
  const before = (await saved(page)).outposts.sites[id]!.assembly;
  await page.getByLabel(label, { exact: true }).fill('0.0001');
  await expect(page.getByRole('button', { name: '保存并启用本地装配', exact: true })).toBeDisabled();
  await route.press('暂停本地装配'); expect((await saved(page)).outposts.sites[id]!.assembly).toEqual({ ...before, enabled: false });
  await expect(page.getByLabel(label, { exact: true })).toHaveValue('0.0001');
  await page.reload(); await expect(page.getByTestId('save-status')).toHaveText('已保存'); await route.press('分所');
  await expect(page.getByLabel(label, { exact: true })).toHaveValue('0');
}

async function relaySupport(page: Page, route: Route) {
  await route.assign('O02', 'echo', 'salvage');
  for (let index = 0; index < 2; index++) {
    await route.press('草稿加入光包'); await route.press('保存并启用支援'); await route.wait(10);
    const launched = await saved(page); expect(launched.outposts.sites.O02!.sent.light).toBe(index + 1);
    expect(launched.outposts.support.trip?.cargo.energy).toBe(40000); await expect(page.getByTestId('outpost-support-trip')).toContainText('在途');
    if (index === 0) {
      await route.press('查看封存借光庭影响'); await expect(page.getByRole('button', { name: '确认封存借光庭', exact: true })).toBeDisabled();
      await page.getByRole('group', { name: '确认封存借光庭', exact: true }).press('Escape');
      await expect(page.getByRole('group', { name: '确认封存借光庭', exact: true })).toHaveCount(0);
      await page.getByLabel('支援保留电量', { exact: true }).fill('');
      await expect(page.getByRole('button', { name: '保存支援配置', exact: true })).toBeDisabled();
      await route.press('暂停已保存支援');
      expect((await saved(page)).outposts.support).toEqual({ ...launched.outposts.support, enabled: false });
      await page.reload(); await expect(page.getByTestId('save-status')).toHaveText('已保存'); await route.press('分所');
      expect((await saved(page)).outposts.support.trip).toEqual(launched.outposts.support.trip);
    }
    await route.wait(60); expect((await saved(page)).outposts.support.trip).toBeNull();
    await route.mark(`O02/support-${index + 1}-arrived`);
  }
  await route.press('暂停已保存支援');
  expect((await saved(page)).outposts.sites.O02!.ledger.supportReceived.energy).toBe(100000);
}

for (const [device, width, height] of [['desktop', 1440, 1000], ['mobile', 390, 844]] as const) {
  test(`B01-11: complete two-map UI route, local or relay proof, cross-map knowledge, sealing and reopening on ${device}`, async ({ page, context }, info) => {
    await page.setViewportSize({ width, height }); await page.emulateMedia({ reducedMotion: 'reduce' });
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    const route = new Route(page); await start(page, route);
    const order: OutpostId[] = device === 'desktop' ? ['O01', 'O02'] : ['O02', 'O01'];
    for (const [index, id] of order.entries()) {
      await route.open(id);
      if (index === 0) {
        await invalidDrafts(page, route, id);
        if (device === 'mobile') {
          await page.setViewportSize({ width: 320, height: 740 });
          const other = id === 'O01' ? 'O02' : 'O01';
          await route.press(`查看${OUTPOSTS[other].name}`); await route.press('安排人手');
          await expect(page.locator('#outpost-workers')).toBeFocused(); await expect(page.locator('#outpost-workers')).toContainText('请先封存');
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
          await route.press(`查看${OUTPOSTS[id].name}`); await route.press('安排人手'); await expect(page.locator('#outpost-workers')).toBeFocused();
          await relaySupport(page, route);
        }
      }
      if (id === 'O01') {
        await expect(page.getByRole('region', { name: '无库巷设施', exact: true })).toContainText('不能建设仓库');
        await expect(page.getByRole('button', { name: /安排无库巷简易仓库/ })).toHaveCount(0);
      }
      if (device === 'desktop' && id === 'O02') {
        // The O01 knowledge is actually used in the other map without sending
        // extra supplies: this full route remains a two-person zero-support run.
        for (const kind of ['光包', '工料包', '光包']) await route.press(`草稿加入${kind}`);
        await route.press('保存支援配置'); expect((await saved(page)).outposts.support).toMatchObject({ enabled: false, queue: ['light', 'materials', 'light'] });
      }
      await route.project(id, `${id}-1`);
      await route.project(id, `${id}-2`, id === 'O01' && device === 'desktop' ? 2 : 0, device === 'mobile' ? 'relay' : 'local');
      await route.project(id, `${id}-3`);
      const completed = (await saved(page)).outposts.sites[id]!;
      expect(completed.handoff).toBe(false); expect(completed.proof).toBe(id === 'O02' ? device === 'mobile' ? 'relay' : 'local' : null);
      if (id === 'O01') expect(completed.roofPrefab).toBe(device === 'desktop' ? 2 : 0);
      await expect(page.getByTestId(`outpost-scene-${id}`)).toContainText(OUTPOSTS[id].address);
      const other = id === 'O01' ? 'O02' : 'O01';
      for (const inspected of [other, id] as const) {
        await route.press(`查看${OUTPOSTS[inspected].name}`);
        await expect(page.getByTestId(`outpost-handoff-${id}`)).toHaveCount(1);
        await expect(page.locator('#pending-matters').getByTestId(`outpost-handoff-${id}`)).toContainText(`来自${OUTPOSTS[id].name}`);
        if (device === 'mobile') {
          await route.note('open pending shortcut after inspecting another map');
          await page.getByRole('button', { name: /^待处理/ }).click();
          await expect(page.locator('#pending-matters')).toBeFocused();
          await expect(page.locator('#pending-matters').getByRole('button', { name: `确认${OUTPOSTS[id].name}地图交接`, exact: true })).toBeVisible();
        }
        expect((await saved(page)).outposts.sites[id]!.handoff).toBe(false);
      }
      if (index === 0) { await route.offlineReport(900, id); await route.story('L04-3'); }
      await route.press(`确认${OUTPOSTS[id].name}地图交接`); await expect(page.getByTestId(`outpost-handoff-${id}`)).toHaveCount(0);
      if (device === 'mobile' && id === 'O01') {
        await route.project(id, 'lightFrame'); expect((await saved(page)).outposts.sites[id]!.lightFrame).toBe(true);
        await expect(page.getByTestId(`outpost-scene-${id}`)).toContainText('回照灯架已建成');
      }
      await page.getByTestId(`outpost-scene-${id}`).screenshot({ path: info.outputPath(`${device}-${id}.png`), animations: 'disabled' });
      await route.mark(`${id}/completed`); await route.seal(id);
      if (index === 1) expect((await saved(page)).outposts.sites[order[0]]).toEqual(route.milestones[`${order[0]}/sealed`].outposts.sites[order[0]]);
    }
    await route.story('L04-4'); await route.open(order[0], true);
    if (device === 'desktop') {
      await route.project('O01', 'build:generator');
      await route.parts('O01', 10000);
      const beforePolicy = await saved(page);
      await route.press('无库巷切换暗灯'); await route.press('无库巷切换常灯'); await route.press('无库巷提高装配工优先级');
      const afterPolicy = await saved(page);
      expect(afterPolicy.outposts.sites.O01!.resources.parts).toBe(beforePolicy.outposts.sites.O01!.resources.parts - 10000);
      expect(afterPolicy.outposts.sites.O01!.priority).toEqual(['salvage', 'repair', 'assemble', 'record']);
      expect(afterPolicy.priority).toEqual(beforePolicy.priority); await route.project('O01', 'lightFrame');
    }
    await page.reload(); await expect(page.getByTestId('save-status')).toHaveText('已保存');
    const checkpoint = await saved(page); expect(decodeSave(encodeSave(checkpoint, checkpoint.clock.lastAt)).state).toEqual(checkpoint);
    for (const node of ['L04-1', 'L04-2', 'L04-3', 'L04-4'] as const) expect(checkpoint.experience.story[node]).toBeDefined();
    expect(checkpoint.outposts.knowledge).toEqual({ manifest: true, lightFrame: true });
    expect(checkpoint.outposts.sites.O01!.sent).toEqual({ light: 0, materials: 0 });
    expect(checkpoint.outposts.sites.O02!.sent).toEqual({ light: device === 'mobile' ? 2 : 0, materials: 0 });
    expect(checkpoint.ledger.supportSent).toMatchObject({ energy: device === 'mobile' ? 120000 : 40000, parts: 40000, memory: 16000, component: 0 });
    await route.press('设置'); const exportedPromise = page.waitForEvent('download'); await route.press('导出存档');
    const stream = await (await exportedPromise).createReadStream(), chunks: Buffer[] = [];
    for await (const chunk of stream!) chunks.push(Buffer.from(chunk)); const exported = Buffer.concat(chunks).toString('utf8');
    expect(decodeSave(exported).state).toEqual(checkpoint);
    await writeFile(info.outputPath(`${device}-v04-save.json`), exported);
    await page.getByLabel('存档文本', { exact: true }).fill(exported); await route.press('检查存档'); await route.press('确认导入并替换');
    await expect(page.getByRole('alert')).toContainText('已导入存档'); expect(await saved(page)).toEqual(checkpoint); await route.press('知道了');
    await route.press('读取恢复副本'); await expect(page.getByRole('alert')).toContainText('已读取有效恢复副本');
    expect(await saved(page)).toEqual(checkpoint); expect(JSON.parse(await page.evaluate(key => localStorage.getItem(key)!, BACKUP_KEY)).schemaVersion).toBe(9);
    await route.press('知道了');
    await route.press('分所'); await page.setViewportSize({ width: 320, height: 740 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await route.press('安排人手'); await expect(page.locator('#outpost-workers')).toBeFocused();
    await page.screenshot({ path: info.outputPath(`${device}-320px.png`), fullPage: true, animations: 'disabled' });
    await route.mark('end'); assertInvariants(await saved(page)); expect(errors).toEqual([]);
    await writeFile(info.outputPath('route.json'), JSON.stringify({ device, origin: 'genuine schema 6 V0.3.3 released gameplay fixture', note: 'Away-person seconds measure unavailable original residents, not invented new arrivals or assumed lost production. Sources were idle; the actual home and local ledgers are retained in every milestone.', awayPersonSeconds: route.awayPersonSeconds, actions: route.actions, milestones: route.milestones }, null, 2));
    if (device === 'desktop') {
      await test.step('B10: complete current-schema state survives interrupted settlement and a single-writer handover', async () => {
        const before = await saved(page), elapsed = 86400517, wanted = advance(before, elapsed);
        wanted.clock.lastAt = before.clock.lastAt + elapsed; wanted.report = summarize(before, wanted, elapsed);
        await page.addInitScript(() => {
          const Original = window.MessageChannel;
          window.MessageChannel = class extends Original {
            constructor() {
              super(); const post = this.port2.postMessage.bind(this.port2);
              this.port2.postMessage = ((value: unknown) => {
                if (value === null && new Error().stack?.includes('/src/app/controller.ts') && !sessionStorage.getItem('districtzero.test.v04-interrupted')) {
                  sessionStorage.setItem('districtzero.test.v04-interrupted', 'yes'); (window as any).__v04SettlementHeld = true; return;
                }
                post(value);
              }) as typeof this.port2.postMessage;
            }
          };
        });
        await page.clock.setSystemTime(new Date(wanted.clock.lastAt)); await page.reload();
        await page.waitForFunction(() => (window as any).__v04SettlementHeld === true);
        expect(await saved(page)).toEqual(before);
        await page.reload(); await expect(page.getByTestId('save-status')).toHaveText('已保存', { timeout: 30000 });
        expect(await saved(page)).toEqual(wanted); assertInvariants(await saved(page));
        await writeFile(info.outputPath('current-schema-interrupted.json'), JSON.stringify({ elapsed, before, after: await saved(page) }, null, 2));
        const follower = await context.newPage(); follower.on('pageerror', error => errors.push(error.message));
        await follower.clock.install({ time: new Date(wanted.clock.lastAt) }); await follower.clock.pauseAt(new Date(wanted.clock.lastAt)); await follower.goto('/');
        await expect(follower.getByRole('status').filter({ hasText: '另一页面正在运行' })).toBeVisible();
        await click(follower, '设置'); await expect(follower.getByRole('button', { name: '立即保存', exact: true })).toBeDisabled();
        const locks = await follower.evaluate(async () => navigator.locks.query());
        expect(locks.held!.filter(lock => lock.name === 'districtzero.writer.v1')).toHaveLength(1);
        expect(locks.pending!.filter(lock => lock.name === 'districtzero.writer.v1')).toHaveLength(1);
        await page.close(); await expect(follower.getByTestId('save-status')).toHaveText('已保存');
        expect(await saved(follower)).toEqual(wanted); await click(follower, '分所');
        await expect(follower.getByTestId('outpost-stock-O01')).toBeVisible(); await expect(follower.getByRole('button', { name: '保存并启用本地装配', exact: true })).toBeEnabled();
        const ownership = await follower.evaluate(async () => navigator.locks.query());
        expect(ownership.held!.filter(lock => lock.name === 'districtzero.writer.v1')).toHaveLength(1);
        await follower.close();
        expect(errors).toEqual([]);
      });
    }
  });
}
