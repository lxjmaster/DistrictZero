import { amounts, RESOURCES, resourceNames } from './config';
import type { CalendarAction, CalendarOrder, CalendarReport, GameState } from './types';
import { boostCount, calendarCapacity, calendarClock, calendarHeld, calendarQueueLimit, calendarUnlocked, CALENDAR_RULES } from './calendar-config';
import { MODES, RECIPES, reservedSpace, ROUTE_IDS, ROUTES, routeOpen, tickNodeProduction } from './network';

const canPay = (s: GameState, payment: ReturnType<typeof amounts>) => RESOURCES.every(r => s.resources[r] - payment[r] >= s.calendar.storage.reserve[r]);
function pay(s: GameState, payment: ReturnType<typeof amounts>) {
  for (const r of RESOURCES) { s.resources[r] -= payment[r]; s.ledger.operating[r] += payment[r]; }
}
export function calendarStorageReason(s: GameState): string | null {
  if (!calendarUnlocked(s)) return '先修复校时台并阅读储时来信';
  const c = s.calendar;
  if (!c.storage.enabled) return '储时已暂停';
  if (c.stored >= Math.min(c.storage.target, calendarCapacity(s))) return '已达到时间目标，储时待命';
  if (!canPay(s, CALENDAR_RULES.captureCost)) return '储时等待旧城电量、记忆或保留库存';
  return null;
}
export function calendarPrepareReason(s: GameState, order: CalendarOrder): string | null {
  const stock = s.network.routes[order.route].node.resources;
  const inputs = calendarHeld(s, order.route, 'supply', order.uid);
  const space = reservedSpace(s, order.route, order.uid);
  for (const r of RESOURCES) if (stock[r] - inputs[r] < order.supply[r]) return `${ROUTES[order.route].name}${resourceNames[r]}${inputs[r] ? '被其他排程占用或' : ''}供料不足；在途不算到货`;
  if (RESOURCES.some(r => stock[r] + space[r] + order.product[r] > ROUTES[order.route].capacity[r])) return '产物空间不足，需给库存与在途预留留出整批位置';
  return null;
}
export function calendarOrderReason(s: GameState, order = s.calendar.orders[0]): string | null {
  if (!calendarUnlocked(s)) return '先修复校时台并阅读储时来信';
  if (!order) return '尚未安排历法加工';
  if (!s.calendar.enabled) return '历法排程已暂停，已有备料仍保留';
  if (s.calendar.orders[0]?.uid !== order.uid) return '等待前项完成或手动调整顺序';
  const clock = calendarClock(s, order.route), route = s.network.routes[order.route];
  if (clock.round < order.earliestRound) return `等待第${order.earliestRound + 1}轮起的重叠窗口`;
  if (!clock.overlap) return `等待两地日期重叠，下次还有${clock.next}秒`;
  if (!route.staff) return '本线需要一名实际外派夜工';
  if (route.node.mode !== order.mode) return '当前生产模式与已保存排程不一致，请恢复模式或取消重排';
  const reason = calendarPrepareReason(s, order);
  if (reason) return reason;
  if (!order.prepared) return '等待整批备料与产物空间预留';
  if (s.calendar.stored < CALENDAR_RULES.steps) return '时间储备不足60秒';
  if (!s.calendar.allowance) return '校准次数耗尽，请安排校准工程';
  if (!canPay(s, CALENDAR_RULES.boostCost)) return '加工等待旧城电量、记忆或保留库存';
  return null;
}
export function calendarReasons(s: GameState): string[] {
  if (!s.experience.story['L05-1']) return [];
  const reasons: string[] = [];
  if (s.calendar.storage.enabled) { const why = calendarStorageReason(s); if (why) reasons.push(why); }
  if (s.calendar.orders.length) { const why = calendarOrderReason(s); if (why) reasons.push(why); }
  return reasons;
}
// Called once after all arrivals and before ordinary node production. Exactly
// one unprepared order may acquire a whole batch; an unavailable order never
// takes a partial input or space reservation.
export function prepareCalendar(s: GameState) {
  if (!calendarUnlocked(s) || !s.calendar.enabled) return;
  for (const order of s.calendar.orders) if (!order.prepared && !calendarPrepareReason(s, order)) {
    order.prepared = true; break;
  }
}
export function tickCalendar(s: GameState, log: (text: string) => void) {
  if (!calendarUnlocked(s)) return;
  const c = s.calendar;
  if (!calendarStorageReason(s)) { pay(s, CALENDAR_RULES.captureCost); c.stored += 1; c.captured += 1; }
  const head = c.orders[0];
  if (!head || calendarOrderReason(s, head)) return;
  // All conditions were checked before changing stock. Releasing only this
  // order makes its exact inputs/space available to the shared production step.
  c.orders.shift(); c.stored -= CALENDAR_RULES.steps; c.allowance -= 1;
  pay(s, CALENDAR_RULES.boostCost);
  for (let step = 0; step < CALENDAR_RULES.steps; step++) tickNodeProduction(s, head.route);
  const round = calendarClock(s).round;
  c.boosts[head.route][head.mode] += 1;
  if (round > head.createdRound) c.crossRound += 1;
  c.history.push({ uid: head.uid, route: head.route, mode: head.mode, createdRound: head.createdRound, completedRound: round, second: s.clock.seconds });
  if (c.history.length > CALENDAR_RULES.history) c.history.shift();
  log(`${ROUTES[head.route].name}历法加工完成：${RECIPES[head.route][head.mode].name}，使用60秒时间与1次校准。产物仍在当地。`);
}
export function calendarAction(s: GameState, action: CalendarAction): string | null {
  const c = s.calendar;
  // Pause never validates unsaved draft fields and never discards held inputs.
  if (action.type === 'calendar-storage-pause') { c.storage.enabled = false; return null; }
  if (action.type === 'calendar-toggle' && action.enabled === false) { c.enabled = false; return null; }
  if (!calendarUnlocked(s) || s.network.legacyPending) return '先修复校时台并阅读储时来信';
  switch (action.type) {
    case 'calendar-storage':
      if (typeof action.enabled !== 'boolean' || !Number.isSafeInteger(action.target) || action.target < 0 || action.target > CALENDAR_RULES.capacity || !action.reserve || RESOURCES.some(r => !Number.isSafeInteger(action.reserve[r]) || action.reserve[r] < 0 || action.reserve[r] > CALENDAR_RULES.maxSetting)) return '时间目标需为0–600整数秒；保留量为0–1,000,000，最多3位小数';
      c.storage = { enabled: action.enabled, target: action.target, reserve: { ...action.reserve } }; break;
    case 'calendar-toggle':
      if (typeof action.enabled !== 'boolean') return '请选择启用或暂停排程';
      c.enabled = action.enabled; break;
    case 'calendar-add': {
      if (!ROUTE_IDS.includes(action.route) || !routeOpen(s, action.route) || !MODES.includes(action.mode) || ![0, 1, 2].includes(action.delay)) return '请选择已开放地区、配方和最早轮次';
      if (c.orders.length >= calendarQueueLimit(s)) return `历法清单已满（最多${calendarQueueLimit(s)}项），不会自动续填`;
      const round = calendarClock(s).round, recipe = RECIPES[action.route][action.mode];
      c.orders.push({ uid: `cal-${c.nextOrder++}`, route: action.route, mode: action.mode, supply: { ...recipe.supply }, product: { ...recipe.product }, createdRound: round, earliestRound: round + action.delay, prepared: false }); break;
    }
    case 'calendar-cancel': case 'calendar-move': {
      const index = c.orders.findIndex(o => o.uid === action.uid);
      if (index < 0) return '排程已经完成或不存在';
      if (action.type === 'calendar-cancel') { c.orders.splice(index, 1); break; }
      const other = index + action.direction;
      if (![-1, 1].includes(action.direction) || other < 0 || other >= c.orders.length) return '不能再向这个方向移动';
      [c.orders[index], c.orders[other]] = [c.orders[other], c.orders[index]]; break;
    }
  }
  return null;
}
export function summarizeCalendar(before: GameState, after: GameState): CalendarReport {
  const boosts = { rain: { normal: 0, specialty: 0 }, station: { normal: 0, specialty: 0 } }, produced = { rain: amounts(), station: amounts() };
  for (const id of ROUTE_IDS) for (const mode of MODES) {
    boosts[id][mode] = after.calendar.boosts[id][mode] - before.calendar.boosts[id][mode];
    for (const r of RESOURCES) produced[id][r] += boosts[id][mode] * RECIPES[id][mode].product[r];
  }
  return { captured: after.calendar.captured - before.calendar.captured, used: (boostCount(after) - boostCount(before)) * CALENDAR_RULES.steps,
    services: after.calendar.services - before.calendar.services, boosts, produced,
    queued: after.calendar.orders.length, prepared: after.calendar.orders.filter(o => o.prepared).length,
    stored: after.calendar.stored, allowance: after.calendar.allowance, reasons: calendarReasons(after) };
}
