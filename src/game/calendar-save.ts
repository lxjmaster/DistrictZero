import { RESOURCES } from './config';
import { boostCount, calendarCapacity, calendarClock, calendarHeld, calendarQueueLimit, CALENDAR_PROJECTS, CALENDAR_RULES, createCalendar } from './calendar-config';
import { MODES, RECIPES, reservedSpace, ROUTE_IDS, ROUTES, routeOpen } from './network';
import type { Amounts, CalendarOrder, CalendarRecord, CalendarReport, CalendarState, GameState } from './types';

const bad = (reason: string): never => { throw new Error(`存档无效：${reason}`); };
const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : bad('历法需要数据对象');
const integer = (value: unknown, name: string, min = 0, max = Number.MAX_SAFE_INTEGER): number => typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max ? value : bad(`${name}超出范围或不是整数`);
const boolean = (value: unknown, name: string): boolean => typeof value === 'boolean' ? value : bad(`${name}必须是布尔值`);
const list = (value: unknown, name: string, max: number): unknown[] => Array.isArray(value) && value.length <= max ? value : bad(`${name}格式错误`);
function choice<T extends string>(value: unknown, values: readonly T[], name: string): T { return typeof value === 'string' && values.includes(value as T) ? value as T : bad(`${name}不受支持`); }
function readAmounts(value: unknown, name: string, max = Number.MAX_SAFE_INTEGER): Amounts {
  const o = object(value);
  return Object.fromEntries(RESOURCES.map(r => [r, integer(o[r], name, 0, max)])) as Amounts;
}
function uid(value: unknown): string {
  return typeof value === 'string' && /^cal-([1-9]\d*)$/.test(value) && Number.isSafeInteger(Number(value.slice(4))) ? value : bad('历法排程标识错误');
}
function readBoosts(value: unknown): CalendarState['boosts'] {
  const o = object(value);
  if (Object.keys(o).length !== ROUTE_IDS.length) bad('历法加工地点不完整');
  return Object.fromEntries(ROUTE_IDS.map(id => { const modes = object(o[id]); return [id, { normal: integer(modes.normal, '常规历法加工'), specialty: integer(modes.specialty, '特产历法加工') }]; })) as CalendarState['boosts'];
}
function readOrder(value: unknown): CalendarOrder {
  const o = object(value);
  return { uid: uid(o.uid), route: choice(o.route, ROUTE_IDS, '历法地点'), mode: choice(o.mode, MODES, '历法配方'), supply: readAmounts(o.supply, '历法投入快照'), product: readAmounts(o.product, '历法产物快照'), createdRound: integer(o.createdRound, '历法创建轮次'), earliestRound: integer(o.earliestRound, '历法最早轮次'), prepared: boolean(o.prepared, '历法备料标记') };
}
function readRecord(value: unknown): CalendarRecord {
  const o = object(value);
  return { uid: uid(o.uid), route: choice(o.route, ROUTE_IDS, '加工地点'), mode: choice(o.mode, MODES, '加工配方'), createdRound: integer(o.createdRound, '加工创建轮次'), completedRound: integer(o.completedRound, '加工完成轮次'), second: integer(o.second, '加工完成时间', 1) };
}
export function readCalendar(value: unknown): CalendarState {
  const o = object(value), storage = object(o.storage);
  return {
    originSecond: o.originSecond === null ? null : integer(o.originSecond, '历法原点', 1),
    storage: { enabled: boolean(storage.enabled, '储时开关'), target: integer(storage.target, '储时目标', 0, CALENDAR_RULES.capacity), reserve: readAmounts(storage.reserve, '储时保留量', CALENDAR_RULES.maxSetting) },
    stored: integer(o.stored, '时间储备', 0, CALENDAR_RULES.capacity), captured: integer(o.captured, '累计储时'),
    allowance: integer(o.allowance, '校准余量', 0, CALENDAR_RULES.initialAllowance), services: integer(o.services, '校准次数'),
    enabled: boolean(o.enabled, '历法排程开关'), orders: list(o.orders, '历法排程', 3).map(readOrder), nextOrder: integer(o.nextOrder, '历法排程序列', 1),
    boosts: readBoosts(o.boosts), crossRound: integer(o.crossRound, '跨轮加工'), history: list(o.history, '历法加工历史', CALENDAR_RULES.history).map(readRecord)
  };
}
export function readCalendarReport(value: unknown): CalendarReport {
  const o = object(value), produced = object(o.produced);
  const report: CalendarReport = {
    captured: integer(o.captured, '报告储时'), used: integer(o.used, '报告用时'), services: integer(o.services, '报告校准'), boosts: readBoosts(o.boosts),
    produced: Object.fromEntries(ROUTE_IDS.map(id => [id, readAmounts(produced[id], '报告历法产物')])) as CalendarReport['produced'],
    queued: integer(o.queued, '报告排程数', 0, 3), prepared: integer(o.prepared, '报告备料数', 0, 3), stored: integer(o.stored, '报告储备', 0, CALENDAR_RULES.capacity), allowance: integer(o.allowance, '报告校准余量', 0, CALENDAR_RULES.initialAllowance),
    reasons: list(o.reasons, '历法报告停因', 30).map(v => typeof v === 'string' && v.length <= 1000 ? v : bad('历法报告停因格式错误'))
  };
  const count = ROUTE_IDS.reduce((n, id) => n + report.boosts[id].normal + report.boosts[id].specialty, 0);
  if (report.used !== count * CALENDAR_RULES.steps || report.prepared > report.queued) bad('历法报告用时或备料不守恒');
  for (const id of ROUTE_IDS) for (const r of RESOURCES) {
    const expected = MODES.reduce((n, mode) => n + report.boosts[id][mode] * RECIPES[id][mode].product[r], 0);
    if (report.produced[id][r] !== expected) bad('历法报告产物与配方不一致');
  }
  return report;
}

export function assertCalendar(s: GameState): void {
  const c = readCalendar(s.calendar), story = s.experience.story, initial = createCalendar(), count = boostCount(s);
  const done = (id: string) => s.completed.includes(id);
  const planned = (id: string) => done(id) || s.queue.some(p => !p.outpost && p.definition === id);
  const storyIds = ['L05-1', 'L05-2', 'L05-3', 'L05-4'] as const;
  for (let i = 1; i < storyIds.length; i++) if (story[storyIds[i]] && !story[storyIds[i - 1]]) bad('历法来信顺序错误');
  if (story['L05-1'] && !story['L04-4'] || planned('P13') && !story['L05-1']) bad('校时台缺少来信来源');
  if (story['L05-2'] && !done('P13') || story['L05-3'] && !done('P15') || story['L05-4'] && !done('P16')) bad('历法来信缺少工程成果');
  if (planned('P14') && (!done('P13') || c.boosts.rain.normal + c.boosts.rain.specialty < 1)) bad('雨城日期缺少实际加工');
  if (planned('P15') && (!done('P14') || c.boosts.station.normal + c.boosts.station.specialty < 1)) bad('长站日期缺少实际加工');
  if (planned('P16') && (!done('P15') || c.crossRound < 1)) bad('共同日期缺少跨轮加工');
  if (done('P13') !== (c.originSecond !== null) || c.originSecond !== null && c.originSecond > s.clock.seconds) bad('校时台与历法原点不一致');
  if (!done('P13')) {
    if (JSON.stringify(c) !== JSON.stringify(initial)) bad('校时台未建成不能保存历法进度或配置');
  } else {
    if (c.stored !== c.captured - CALENDAR_RULES.steps * count || c.allowance !== CALENDAR_RULES.initialAllowance + CALENDAR_RULES.serviceAllowance * c.services - count) bad('历法储时或校准次数不守恒');
    if (c.stored > calendarCapacity(s) || c.captured > s.clock.seconds - c.originSecond!) bad('储时超过容量或实际经过时间');
  }
  if (!story['L05-2'] && (c.enabled || c.storage.enabled || c.storage.target !== initial.storage.target || RESOURCES.some(r => c.storage.reserve[r] !== initial.storage.reserve[r]) || c.captured || c.services || count || c.orders.length || c.nextOrder !== 1)) bad('历法安排缺少手动阅读');
  if (s.network.legacyPending && (story['L05-1'] || c.originSecond !== null)) bad('旧离线规则未完成不能出现历法');
  if (s.completed.includes('calendar:service')) bad('校准不得写入一次性完工记录');
  for (const p of s.queue) {
    if (p.definition === 'calendar:service' && (p.outpost || p.district !== 'district-0' || p.targetLevel !== 1 || p.prefab !== 0 || p.legacyChapter || !done('P13') || c.allowance > 3)) bad('校准工程的来源、归属或额度错误');
    if (CALENDAR_PROJECTS.some(id => id === p.definition) && (p.outpost || p.district !== 'district-0' || p.legacyChapter)) bad('历法主线工程归属错误');
  }
  integer(count, '历法总加工');
  if (c.orders.length > calendarQueueLimit(s) || c.nextOrder < count + c.orders.length + 1 || c.crossRound > count) bad('历法排程容量或累计序列错误');
  const seen = new Set<string>(), currentRound = calendarClock(s).round;
  for (const entry of [...c.orders, ...c.history]) {
    if (seen.has(entry.uid) || Number(entry.uid.slice(4)) >= c.nextOrder || !routeOpen(s, entry.route)) bad('历法排程序列重复或来源错误');
    seen.add(entry.uid);
    if (entry.createdRound > currentRound) bad('历法排程创建于未来轮次');
  }
  for (const order of c.orders) {
    const recipe = RECIPES[order.route][order.mode];
    if (order.earliestRound < order.createdRound || order.earliestRound > order.createdRound + 2 || RESOURCES.some(r => order.supply[r] !== recipe.supply[r] || order.product[r] !== recipe.product[r])) bad('历法排程轮次或配方快照错误');
  }
  for (const id of ROUTE_IDS) {
    const node = s.network.routes[id].node, held = calendarHeld(s, id, 'supply'), space = reservedSpace(s, id);
    for (const mode of MODES) if (c.boosts[id][mode] > node.batches[mode]) bad('历法加工缺少外城实际生产');
    for (const r of RESOURCES) if (held[r] > node.resources[r] || node.resources[r] + space[r] > ROUTES[id].capacity[r]) bad('历法备料或产物空间超出当地库存与容量');
  }
  for (const r of RESOURCES) {
    const paid = c.captured * CALENDAR_RULES.captureCost[r] + count * CALENDAR_RULES.boostCost[r];
    if (!Number.isSafeInteger(paid) || paid > s.ledger.operating[r]) bad('历法收费缺少实际运行支出');
    // Refunds also include dismantling, not only canceled calibration work.
    if (c.services * CALENDAR_RULES.serviceCost[r] > s.ledger.reserved[r]) bad('校准缺少实际工程支出');
  }
  if (c.history.length !== Math.min(count, CALENDAR_RULES.history)) bad('历法历史缺少最近加工记录');
  const recent = initial.boosts;
  let previousSecond = -1, recentCross = 0;
  for (const [index, record] of c.history.entries()) {
    const relative = record.second - c.originSecond!, position = relative % CALENDAR_RULES.round;
    const completedCount = count - c.history.length + index + 1;
    if (relative < completedCount * CALENDAR_RULES.steps || record.second > s.clock.seconds || record.second <= previousSecond || record.completedRound !== Math.floor(relative / CALENDAR_RULES.round) || record.completedRound < record.createdRound) bad('历法加工时间或轮次错误');
    if (record.route === 'rain' ? position < 0 || position >= 120 : position < 240 || position >= 360) bad('历法加工不在两地重叠窗口');
    previousSecond = record.second; recent[record.route][record.mode] += 1;
    if (record.completedRound > record.createdRound) recentCross += 1;
  }
  for (const id of ROUTE_IDS) for (const mode of MODES) if (recent[id][mode] > c.boosts[id][mode] || count <= CALENDAR_RULES.history && recent[id][mode] !== c.boosts[id][mode]) bad('历法历史与累计加工不一致');
  if (recentCross > c.crossRound || c.crossRound > recentCross + count - c.history.length) bad('跨轮统计缺少实际完成记录');
  const report = s.report?.calendar;
  if (report) {
    readCalendarReport(report);
    if (!done('P13') && (report.captured || report.used || report.services || report.queued || report.stored || report.allowance) || report.captured > c.captured || report.used > count * CALENDAR_RULES.steps || report.services > c.services || report.queued > calendarQueueLimit(s)) bad('历法报告缺少实际来源');
    if (report.captured > s.report!.seconds || report.used / CALENDAR_RULES.steps > s.report!.seconds || report.stored > calendarCapacity(s)) bad('历法报告超过结算时长或储时容量');
    for (const id of ROUTE_IDS) for (const mode of MODES) if (report.boosts[id][mode] > c.boosts[id][mode]) bad('历法报告加工超出累计');
    for (const r of RESOURCES) if (report.captured * CALENDAR_RULES.captureCost[r] + report.used / CALENDAR_RULES.steps * CALENDAR_RULES.boostCost[r] > s.report!.flows.operating[r]) bad('历法报告缺少实际收费');
  }
  for (const key of s.report?.completed ?? []) if (CALENDAR_PROJECTS.some(id => id === key) && !done(key)) bad('历法报告缺少实际完工');
}
