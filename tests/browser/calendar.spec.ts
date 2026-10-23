import { expect, test } from '@playwright/test';
import type { BrowserContext, Page, TestInfo } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { BACKUP_KEY, SAVE_KEY } from '../../src/app/storage';
import { RESOURCES, resourceNames } from '../../src/game/config';
import { advance, definitionFor, format, summarize } from '../../src/game/engine';
import { calendarClock, boostCount } from '../../src/game/calendar-config';
import { RECIPES, ROUTES } from '../../src/game/network';
import { assertInvariants, decodeSave } from '../../src/game/saves';
import type { Amounts, CalendarOrder, DefinitionId, GameState, ProductionMode, RouteId } from '../../src/game/types';

test.use({ actionTimeout: 10000 });
test.setTimeout(180000);
const START = new Date('2026-10-23T10:00:00Z');
const saved = (page: Page): Promise<GameState> => page.evaluate(key => JSON.parse(localStorage.getItem(key)!).state, SAVE_KEY);
const click = (page: Page, name: string) => page.getByRole('button', { name, exact: true }).click();

// The only fixture edits are wall-clock metadata. Every cost, resident,
// shipment, prepared package and completed project comes from real UI actions.
class CalendarRoute {
  readonly actions: { second: number; action: string }[] = [];
  readonly milestones: Record<string, GameState> = {};
  constructor(readonly page: Page) {}
  async mark(name: string) { this.milestones[name] = await saved(this.page); }
  async note(action: string) { this.actions.push({ second: (await saved(this.page)).clock.seconds, action }); }
  async press(name: string) { await this.note(name); await click(this.page, name); }
  async wait(seconds: number) {
    expect(seconds).toBeGreaterThanOrEqual(10);
    const before = await saved(this.page);
    await this.page.clock.fastForward(seconds * 1000);
    await expect.poll(async () => (await saved(this.page)).clock.seconds, { timeout: 30000 }).toBe(before.clock.seconds + seconds);
    await expect(this.page.getByTestId('save-status')).toHaveText('已保存');
  }
  async until(condition: (state: GameState) => boolean, label: string, limit = 2400, step = 60) {
    for (let elapsed = 0; elapsed < limit; elapsed += step) {
      if (condition(await saved(this.page))) return;
      await this.wait(step);
    }
    expect(condition(await saved(this.page)), `${label}: ${JSON.stringify((await saved(this.page)).calendar)}`).toBe(true);
  }
  async story(node: string) {
    await this.note(`read ${node}`);
    await this.page.getByTestId(`story-${node}`).getByRole('button', { name: '读完历法来信', exact: true }).click();
  }
  async project(id: DefinitionId) {
    await this.press('工务');
    const before = await saved(this.page), quote = definitionFor(before, id);
    await this.press(`安排${quote.name}`);
    await this.until(state => state.completed.includes(id), `${id} completes using ordinary home production`);
    const after = await saved(this.page);
    for (const resource of RESOURCES) expect(after.ledger.reserved[resource] - before.ledger.reserved[resource]).toBe(quote.cost[resource]);
    assertInvariants(after); await this.mark(id); await this.press('历法');
  }
  async mode(id: RouteId, mode: ProductionMode) {
    await this.press('夜网');
    if ((await saved(this.page)).network.routes[id].node.mode !== mode) {
      const card = this.page.getByTestId(`route-${id}`), details = card.locator('details.production-modes');
      if (!await details.evaluate(element => (element as HTMLDetailsElement).open)) await details.locator('summary').click();
      await card.getByRole('button', { name: `切换为${RECIPES[id][mode].name}`, exact: true }).click();
      await this.press(`确认切换${ROUTES[id].name}生产`);
      expect((await saved(this.page)).network.routes[id].node.mode).toBe(mode);
    }
    await this.press('历法');
  }
  async order(id: RouteId, mode: ProductionMode, delay: 0 | 1 | 2): Promise<CalendarOrder> {
    await this.press('历法');
    await this.page.getByLabel('历法加工城市', { exact: true }).selectOption(id);
    await this.page.getByLabel('历法加工配方', { exact: true }).selectOption(mode);
    await this.page.getByLabel('历法最早轮次', { exact: true }).selectOption(String(delay));
    const before = await saved(this.page);
    await this.press('加入历法排程');
    const after = await saved(this.page), order = after.calendar.orders.at(-1)!;
    expect(order).toMatchObject({ route: id, mode, createdRound: calendarClock(before).round, earliestRound: calendarClock(before).round + delay, prepared: false, supply: RECIPES[id][mode].supply, product: RECIPES[id][mode].product });
    expect(after.calendar.stored).toBe(before.calendar.stored); expect(after.network).toEqual(before.network);
    return order;
  }
  async supply(id: RouteId, packages = 1) {
    await this.press('夜网');
    const before = await saved(this.page), city = ROUTES[id].name;
    await this.page.getByLabel(`${city}补给包数`, { exact: true }).fill(String(packages));
    await this.press(`发车补给${city}`);
    const after = await saved(this.page), trip = after.network.routes[id].trip!;
    expect(trip).toMatchObject({ direction: 'outbound', remaining: trip.duration, spaceReserved: true });
    for (const resource of RESOURCES) expect(after.ledger.exports[resource] - before.ledger.exports[resource]).toBe(trip.cargo[resource]);
    await this.press('历法');
    await expect(this.page.getByTestId(`calendar-supply-${id}`)).toContainText('在途');
    return trip;
  }
  async networkHolds(id: RouteId, supply: Partial<Amounts> = {}, product: Partial<Amounts> = {}, cargo: Partial<Amounts> = {}) {
    await this.press('夜网');
    const state = await saved(this.page), card = this.page.getByTestId(`route-${id}`);
    for (const resource of RESOURCES.filter(resource => ROUTES[id].capacity[resource] > 0)) {
      const stock = this.page.getByTestId(`node-${id}-${resource}`).locator('..');
      const input = supply[resource] ?? 0, output = product[resource] ?? 0, shipment = cargo[resource] ?? 0;
      for (const [pattern, amount, text] of [
        [/^另留 .* 给在途货物$/, shipment, `另留 ${format(shipment)} 给在途货物`],
        [/^历法产物预留空位 /, output, `历法产物预留空位 ${format(output)}`],
        [/^历法已占原料 /, input, `历法已占原料 ${format(input)} · 可用 ${format(state.network.routes[id].node.resources[resource] - input)}`]
      ] as const) {
        const label = stock.getByText(pattern);
        if (amount > 0) await expect(label).toHaveText(text);
        else await expect(label).toHaveCount(0);
      }
    }
    if (Object.values(supply).some(value => value > 0) || Object.values(product).some(value => value > 0)) {
      await expect(card).toContainText('加工完成或取消时释放；暂停仍保留');
    }
    await this.press('历法');
  }
  async roundPosition(round: number, position: number) {
    const state = await saved(this.page), target = state.calendar.originSecond! + round * 600 + position;
    expect(target - state.clock.seconds, 'route deliberately reaches a future game-calendar window').toBeGreaterThanOrEqual(10);
    await this.wait(target - state.clock.seconds);
  }
  async roundTrip(name: string, info: TestInfo) {
    const checkpoint = await saved(this.page); assertInvariants(checkpoint);
    await this.press('设置');
    const downloadPromise = this.page.waitForEvent('download'); await this.press('导出存档');
    const stream = await (await downloadPromise).createReadStream(), chunks: Buffer[] = [];
    for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
    const exported = Buffer.concat(chunks).toString('utf8');
    expect(JSON.parse(exported)).toMatchObject({ schemaVersion: 8, balanceVersion: '0.5.0' });
    expect(decodeSave(exported).state).toEqual(checkpoint);
    await writeFile(info.outputPath(`${name}.json`), exported);
    const forged = JSON.parse(exported); forged.state.calendar.stored += 1;
    const primary = await this.page.evaluate(key => localStorage.getItem(key), SAVE_KEY);
    const backup = await this.page.evaluate(key => localStorage.getItem(key), BACKUP_KEY);
    await this.page.getByLabel('存档文本', { exact: true }).fill(JSON.stringify(forged)); await this.press('检查存档');
    await expect(this.page.getByRole('alert')).toBeVisible();
    await expect(this.page.getByRole('button', { name: '确认导入并替换', exact: true })).toHaveCount(0);
    expect(await this.page.evaluate(key => localStorage.getItem(key), SAVE_KEY)).toBe(primary);
    expect(await this.page.evaluate(key => localStorage.getItem(key), BACKUP_KEY)).toBe(backup);
    await this.page.getByLabel('存档文本', { exact: true }).fill(exported); await this.press('检查存档'); await this.press('确认导入并替换');
    await expect(this.page.getByRole('alert')).toContainText('已导入存档'); expect(await saved(this.page)).toEqual(checkpoint); await this.press('知道了');
    await this.press('读取恢复副本'); await expect(this.page.getByRole('alert')).toContainText('已读取有效恢复副本');
    expect(await saved(this.page)).toEqual(checkpoint); await this.press('知道了');
    await this.page.reload(); await expect(this.page.getByTestId('save-status')).toHaveText('已保存');
    expect(await saved(this.page)).toEqual(checkpoint); await this.press('历法');
    return checkpoint;
  }
}

async function start(page: Page, route: CalendarRoute) {
  const raw = JSON.parse(await readFile(new URL('../fixtures/v0.4-chapter.json', import.meta.url), 'utf8'));
  raw.savedAt = START.getTime(); raw.state.clock.lastAt = START.getTime();
  await page.addInitScript(([key, text]) => { if (!localStorage.getItem(key)) localStorage.setItem(key, text); }, [SAVE_KEY, JSON.stringify(raw)]);
  await page.clock.install({ time: START }); await page.clock.pauseAt(START); await page.goto('/');
  await expect(page.getByTestId('save-status')).toHaveText('已保存'); await expect(page.getByRole('alert')).toContainText('V0.4存档已迁移');
  const migrated = await saved(page);
  expect(migrated.calendar).toMatchObject({ originSecond: null, captured: 0, stored: 0, allowance: 0, services: 0, enabled: false, orders: [] });
  expect(migrated.resources).toEqual(raw.state.resources); expect(migrated.outposts).toEqual(raw.state.outposts); expect(migrated.network).toEqual(raw.state.network);
  expect(JSON.parse(await page.evaluate(key => localStorage.getItem(key)!, BACKUP_KEY)).schemaVersion).toBe(7);
  await route.press('知道了'); if (raw.state.report) await route.press('收好报告');
  await expect(page.getByRole('button', { name: '历法', exact: true })).toHaveCount(0);
  await route.mark('migrated');
  // Restore real old-city roles left idle by the finished two-map route.
  await route.press('经营旧巷'); await route.press('增加影子居民回收工'); await route.press('增加影子居民回收工');
  await route.press('经营信笺里'); await route.press('增加回声居民记录员'); await route.press('增加回声居民记录员');
  await route.press('经营第0街区'); await route.press('增加回声居民记录员');
  await route.story('L05-1'); await route.project('P13');
  const opened = await saved(page);
  expect(opened.calendar).toMatchObject({ stored: 0, captured: 0, allowance: 6, enabled: false, storage: { enabled: false, target: 120 } });
  expect(opened.calendar.originSecond).toBeGreaterThan(migrated.clock.seconds);
  await route.story('L05-2');
}

async function storageDrafts(page: Page, route: CalendarRoute) {
  await page.getByLabel('储时目标（秒）', { exact: true }).fill('0'); await route.press('保存并启用储时');
  await route.wait(10); expect((await saved(page)).calendar.captured).toBe(0);
  const before = (await saved(page)).calendar.storage;
  await page.getByLabel('储时目标（秒）', { exact: true }).fill('0.1');
  await expect(page.getByRole('button', { name: '保存并启用储时', exact: true })).toBeDisabled();
  await route.press('暂停储时'); expect((await saved(page)).calendar.storage).toEqual({ ...before, enabled: false });
  await expect(page.getByLabel('储时目标（秒）', { exact: true })).toHaveValue('0.1');
  await route.press('工务'); await route.press('历法');
  await expect(page.getByLabel('储时目标（秒）', { exact: true })).toHaveValue('0');
  await page.reload(); await expect(page.getByTestId('save-status')).toHaveText('已保存'); await route.press('历法');
  await expect(page.getByLabel('储时目标（秒）', { exact: true })).toHaveValue('0');
  await page.getByLabel('储时目标（秒）', { exact: true }).fill('300');
  const values = { energy: '50.001', parts: '30.001', memory: '20.001', component: '0.001', rainFilm: '0.001', railCore: '0.001' };
  for (const resource of RESOURCES) await page.getByLabel(`历法保留${resourceNames[resource]}`, { exact: true }).fill(values[resource]);
  await route.press('保存并启用储时');
  expect((await saved(page)).calendar.storage.reserve).toEqual({ energy: 50001, parts: 30001, memory: 20001, component: 1, rainFilm: 1, railCore: 1 });
  await page.getByLabel('历法保留电量', { exact: true }).fill('1.0001');
  await expect(page.getByRole('button', { name: '保存储时配置', exact: true })).toBeDisabled();
  await route.press('暂停储时');
  expect((await saved(page)).calendar.storage.reserve.energy).toBe(50001);
  await page.getByLabel('历法保留电量', { exact: true }).fill('50.001'); await route.press('保存并启用储时');
  await route.until(state => state.calendar.stored === 300, 'stored time is actually paid for');
  await route.mark('storage-filled');
}

async function firstPreparedOrder(page: Page, route: CalendarRoute, info: TestInfo, device: string) {
  await route.mode('rain', 'normal');
  const order = await route.order('rain', 'normal', 2);
  await expect(page.getByRole('button', { name: '加入历法排程', exact: true })).toBeDisabled();
  await route.press('启用历法排程');
  const trip = await route.supply('rain');
  expect((await saved(page)).calendar.orders[0].prepared).toBe(false);
  await route.wait(trip.duration); expect((await saved(page)).calendar.orders[0].prepared).toBe(true);
  expect(boostCount(await saved(page))).toBe(0);
  await route.press('暂停历法排程'); await route.press('暂停储时');
  const prepared = await saved(page);
  expect(prepared.network.routes.rain.trip).toBeNull(); expect(prepared.calendar.enabled).toBe(false);
  // A paused future order owns these inputs and output slots without a train.
  await route.networkHolds('rain', { energy: 10000, parts: 20000 }, { memory: 12000 });
  await page.getByLabel('历法加工城市', { exact: true }).selectOption('station');
  await page.getByLabel('历法加工配方', { exact: true }).selectOption('specialty');
  expect((await saved(page)).calendar.orders).toEqual(prepared.calendar.orders);
  await route.roundTrip(`${device}-prepared-order`, info);
  expect((await saved(page)).calendar.orders[0]).toEqual({ ...order, prepared: true });
  await expect(page.getByTestId(`cal-order-${order.uid}`)).toContainText('常规整理');
  await route.mode('rain', 'specialty'); await route.press('启用历法排程');
  await route.roundPosition(order.earliestRound, 10);
  expect(boostCount(await saved(page))).toBe(0); expect((await saved(page)).calendar.stored).toBe(prepared.calendar.stored);
  await expect(page.getByTestId(`cal-order-${order.uid}`)).toContainText('模式');
  await route.mode('rain', 'normal'); await route.press('夜网'); await route.press('召回雨城夜工'); await route.press('历法');
  await route.wait(10); expect(boostCount(await saved(page))).toBe(0);
  await expect(page.getByTestId(`cal-order-${order.uid}`)).toContainText(/夜工|人员|外派/);
  await route.press('夜网'); await route.press('经营第0街区'); await route.press('外派影子居民至雨城'); await route.press('历法');
  const before = await saved(page); await route.wait(10);
  const after = await saved(page);
  expect(after.calendar.boosts.rain.normal).toBe(1); expect(after.calendar.stored).toBe(before.calendar.stored - 60);
  expect(after.calendar.allowance).toBe(5); expect(after.calendar.crossRound).toBe(1); expect(after.calendar.orders).toEqual([]);
  expect(after.network.routes.rain.node.produced.memory - before.network.routes.rain.node.produced.memory).toBe(12000);
  expect(after.network.routes.rain.node.used.parts - before.network.routes.rain.node.used.parts).toBe(20000);
  expect(after.network.routes.rain.node.resources).toEqual({ energy: 0, parts: 0, memory: 12000, component: 0, rainFilm: 0, railCore: 0 });
  assertInvariants(after); await route.mark('rain-normal-cross-round');
  await route.networkHolds('rain');
  await route.press('保存并启用储时');
}

async function specialtyQueue(page: Page, route: CalendarRoute) {
  await route.mode('rain', 'specialty'); await route.mode('station', 'specialty');
  const first = await route.order('rain', 'specialty', 2), second = await route.order('station', 'specialty', 0), canceled = await route.order('rain', 'specialty', 1);
  await expect(page.getByRole('button', { name: '加入历法排程', exact: true })).toBeDisabled();
  const rainBatches = (await saved(page)).network.routes.rain.node.batches.specialty;
  await route.supply('rain', 2); const stationTrip = await route.supply('station'); await route.wait(stationTrip.duration);
  // One reservation per second is deliberate: ordinary production consumes
  // the second unheld package on arrival. A real extra delivery is needed for
  // the other rain order; the test must not assume instantaneous bulk holding.
  expect((await saved(page)).calendar.orders.map(order => order.prepared)).toEqual([true, true, false]);
  expect((await saved(page)).network.routes.rain.node.batches.specialty).toBe(rainBatches + 1);
  const extra = await route.supply('rain');
  // The real extra supply train and the first prepared order reserve separately.
  expect((await saved(page)).network.routes.rain.trip).toEqual(extra);
  await route.networkHolds('rain', first.supply, first.product, extra.cargo);
  await route.wait(extra.duration);
  expect((await saved(page)).calendar.orders.every(order => order.prepared)).toBe(true);
  await route.networkHolds('rain', { energy: 20000, parts: 24000 }, { rainFilm: 4000 });
  const beforeCancel = await saved(page); await route.press(`取消排程${canceled.uid}`);
  const afterCancel = await saved(page);
  expect(afterCancel.calendar.orders.map(order => order.uid)).toEqual([first.uid, second.uid]);
  expect(afterCancel.resources).toEqual(beforeCancel.resources); expect(afterCancel.ledger).toEqual(beforeCancel.ledger);
  expect(afterCancel.network).toEqual(beforeCancel.network); expect(afterCancel.earned).toEqual(beforeCancel.earned);
  await route.networkHolds('rain', first.supply, first.product);
  // The ready station package cannot jump past an earlier future rain order.
  await route.roundPosition(first.createdRound + 1, 250);
  expect((await saved(page)).calendar.boosts.station.specialty).toBe(0);
  expect((await saved(page)).calendar.orders.map(order => order.uid)).toEqual([first.uid, second.uid]);
  await route.press(`前移排程${second.uid}`); expect((await saved(page)).calendar.orders[0].uid).toBe(second.uid);
  await route.wait(10); expect((await saved(page)).calendar.boosts.station.specialty).toBe(1);
  await route.mark('station-specialty-after-reorder');
  await route.roundPosition(first.earliestRound, 10);
  expect((await saved(page)).calendar.boosts.rain.specialty).toBe(1);
  expect((await saved(page)).calendar.orders).toEqual([]); expect(boostCount(await saved(page))).toBe(4);
  await route.networkHolds('rain'); await route.networkHolds('station');
  await route.mark('four-recipes');
}

async function interruptedAndHandover(page: Page, context: BrowserContext, info: TestInfo, errors: string[]) {
  const before = await saved(page), elapsed = 86400517, expected = advance(before, elapsed);
  expected.clock.lastAt = before.clock.lastAt + elapsed; expected.report = summarize(before, expected, elapsed);
  await page.addInitScript(() => {
    const Original = window.MessageChannel;
    window.MessageChannel = class extends Original {
      constructor() {
        super(); const post = this.port2.postMessage.bind(this.port2);
        this.port2.postMessage = ((value: unknown) => {
          if (value === null && new Error().stack?.includes('/src/app/controller.ts') && !sessionStorage.getItem('districtzero.test.v05-interrupted')) {
            sessionStorage.setItem('districtzero.test.v05-interrupted', 'yes'); (window as any).__v05SettlementHeld = true; return;
          }
          post(value);
        }) as typeof this.port2.postMessage;
      }
    };
  });
  await page.clock.setSystemTime(new Date(expected.clock.lastAt)); await page.reload();
  await page.waitForFunction(() => (window as any).__v05SettlementHeld === true);
  expect(await saved(page)).toEqual(before);
  await page.reload(); await expect(page.getByTestId('save-status')).toHaveText('已保存', { timeout: 30000 });
  expect(await saved(page)).toEqual(expected); assertInvariants(await saved(page));
  await writeFile(info.outputPath('schema8-interrupted-settlement.json'), JSON.stringify({ elapsed, before, after: await saved(page) }, null, 2));
  const follower = await context.newPage(); follower.on('pageerror', error => errors.push(error.message));
  await follower.clock.install({ time: new Date(expected.clock.lastAt) }); await follower.clock.pauseAt(new Date(expected.clock.lastAt)); await follower.goto('/');
  await expect(follower.getByRole('status').filter({ hasText: '另一页面正在运行' })).toBeVisible();
  // The follower does not load the writer's game until it owns the lock.
  // Its initial read-only UI must not be mistaken for an unlocked chapter.
  await click(follower, '设置'); await expect(follower.getByRole('button', { name: '立即保存', exact: true })).toBeDisabled();
  const locks = await follower.evaluate(async () => navigator.locks.query());
  expect(locks.held!.filter(lock => lock.name === 'districtzero.writer.v1')).toHaveLength(1);
  expect(locks.pending!.filter(lock => lock.name === 'districtzero.writer.v1')).toHaveLength(1);
  await page.close(); await expect(follower.getByTestId('save-status')).toHaveText('已保存');
  expect(await saved(follower)).toEqual(expected); await click(follower, '历法');
  await expect(follower.getByTestId('calendar-history')).toContainText('常规整理');
  await expect(follower.getByRole('button', { name: '加入历法排程', exact: true })).toBeEnabled();
  const ownership = await follower.evaluate(async () => navigator.locks.query());
  expect(ownership.held!.filter(lock => lock.name === 'districtzero.writer.v1')).toHaveLength(1);
  await follower.close(); expect(errors).toEqual([]);
}

for (const [device, width, height] of [['desktop', 1440, 1000], ['mobile', 390, 844]] as const) {
  test(`K01-11: genuine V0.4 migration, all calendar recipes, finite scheduling and complete chapter on ${device}`, async ({ page, context }, info) => {
    await page.setViewportSize({ width, height }); await page.emulateMedia({ reducedMotion: 'reduce' });
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    const route = new CalendarRoute(page); await start(page, route); await storageDrafts(page, route);
    await firstPreparedOrder(page, route, info, device); await route.project('P14');
    await route.mode('station', 'normal'); await route.order('station', 'normal', 1); await route.supply('station');
    await route.until(state => state.calendar.boosts.station.normal === 1, 'station normal package waits for a genuine overlap', 1800);
    await route.mark('station-normal'); await route.project('P15'); await route.story('L05-3');
    await specialtyQueue(page, route);
    await route.press('工务'); const before = await saved(page);
    await route.press('安排把日期写进共同名录'); await route.press('历法'); await route.press('安排校准走失的刻度');
    expect((await saved(page)).queue.map(project => project.definition)).toEqual(['P16', 'calendar:service']);
    await route.wait(10); await route.press('工务');
    await page.getByTestId('queue-P16').getByRole('button', { name: '暂停', exact: true }).click();
    const paused = (await saved(page)).queue[0]; await route.wait(60);
    expect((await saved(page)).queue[0].progress).toBe(paused.progress); expect((await saved(page)).calendar.services).toBe(0);
    expect((await saved(page)).queue[1].status).toBe('waiting');
    await page.getByTestId('queue-P16').getByRole('button', { name: '继续', exact: true }).click();
    await route.until(state => state.completed.includes('P16') && state.calendar.services === 1, 'shared queue completes P16 and one calibration');
    const completed = await saved(page);
    expect(completed.calendar.allowance).toBe(5); expect(completed.completed).not.toContain('calendar:service');
    for (const resource of RESOURCES) expect(completed.ledger.reserved[resource] - before.ledger.reserved[resource]).toBe(definitionFor(before, 'P16').cost[resource] + definitionFor(before, 'calendar:service').cost[resource]);
    await route.story('L05-4'); await route.mark('chapter-complete'); await route.press('历法');
    for (const id of ['P13', 'P14', 'P15', 'P16']) expect(completed.completed).toContain(id);
    for (const node of ['L05-1', 'L05-2', 'L05-3', 'L05-4'] as const) expect((await saved(page)).experience.story[node]).toBeDefined();
    const pending = await route.order('rain', 'specialty', 2); const trip = await route.supply('rain'); await route.wait(trip.duration);
    expect((await saved(page)).calendar.orders.find(order => order.uid === pending.uid)?.prepared).toBe(true);
    const offlineBefore = await saved(page), elapsed = 1500000, expected = advance(offlineBefore, elapsed);
    expected.clock.lastAt = offlineBefore.clock.lastAt + elapsed; expected.report = summarize(offlineBefore, expected, elapsed);
    await page.clock.setSystemTime(new Date(expected.clock.lastAt)); await page.reload();
    await expect(page.getByTestId('save-status')).toHaveText('已保存'); expect(await saved(page)).toEqual(expected);
    expect(expected.report!.calendar!.used).toBe(60); expect(expected.report!.calendar!.produced.rain.rainFilm).toBe(2000);
    await expect(page.getByTestId('calendar-report')).toContainText('60'); await expect(page.getByTestId('calendar-report')).toContainText('雨城');
    await route.mark('offline-completion'); await route.press('收好报告'); await route.press('历法');
    const checkpoint = await route.roundTrip(`${device}-v05-save`, info);
    expect(checkpoint.calendar.originSecond).toBe(route.milestones.P13.calendar.originSecond);
    await page.setViewportSize({ width: 320, height: 740 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await route.press('安排人手'); await expect(page.locator('#workers')).toBeFocused();
    await page.getByRole('button', { name: /^待处理/ }).click(); await expect(page.locator('#pending-matters')).toBeFocused();
    await page.getByLabel('储时目标（秒）', { exact: true }).focus(); await page.keyboard.press('Tab');
    expect(await page.evaluate(() => document.activeElement?.tagName)).toBe('INPUT');
    await page.screenshot({ path: info.outputPath(`${device}-calendar-320px.png`), fullPage: true, animations: 'disabled' });
    await page.setViewportSize({ width, height });
    await page.getByTestId('calendar-panel').screenshot({ path: info.outputPath(`${device}-calendar-clocks.png`), animations: 'disabled' });
    await page.getByTestId('calendar-history').screenshot({ path: info.outputPath(`${device}-calendar-history.png`), animations: 'disabled' });
    await route.mark('end'); assertInvariants(await saved(page)); expect(errors).toEqual([]);
    await writeFile(info.outputPath('route.json'), JSON.stringify({ device, origin: 'genuine schema 7 V0.4 completed gameplay fixture; no inventory, workers or completion grants', humanFeedback: 'not sampled; automation is not experience acceptance', actions: route.actions, milestones: route.milestones }, null, 2));
    if (device === 'desktop') await interruptedAndHandover(page, context, info, errors);
  });
}
