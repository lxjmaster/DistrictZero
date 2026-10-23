import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { amounts, FLOWS, RESOURCES } from '../../src/game/config';
import { activeDistricts } from '../../src/game/city';
import { boostCount, calendarCapacity, calendarClock, calendarHeld, calendarQueueLimit, CALENDAR_RULES, createCalendar } from '../../src/game/calendar-config';
import { calendarOrderReason, calendarPrepareReason, calendarStorageReason, tickCalendar } from '../../src/game/calendar';
import { advance, applyAction, capacities, createGame, definitionFor, refundPreview, stockLimits, summarize } from '../../src/game/engine';
import { pendingStories, prefabLimit } from '../../src/game/experience';
import { departureReason, RECIPES, reservedSpace, ROUTE_IDS, tickNodeProduction, travelSeconds } from '../../src/game/network';
import { assertInvariants, decodeSave, encodeSave } from '../../src/game/saves';
import type { Action, Amounts, DefinitionId, GameState, ProductionMode, RouteId } from '../../src/game/types';

const historical = readFileSync(new URL('../fixtures/v0.4-chapter.json', import.meta.url), 'utf8');
function act(s: GameState, action: Action): GameState {
  const result = applyAction(s, action);
  expect(result.error, JSON.stringify(action)).toBeNull(); assertInvariants(result.state); return result.state;
}
function reject(s: GameState, action: Action) {
  const result = applyAction(s, action); expect(result.error).not.toBeNull(); expect(result.state).toEqual(s);
}
function run(s: GameState, seconds: number): GameState {
  const next = advance(s, seconds * 1000); assertInvariants(next); return next;
}
// Artificial home production funds boundary tests, never a genuine play route.
// Calendar progress, supplies, windows and projects still use real actions and
// elapsed time. The genuine historical fixture is never rewritten.
function fund(s: GameState): GameState {
  const next = structuredClone(s), cap = stockLimits(next);
  for (const r of RESOURCES) { const added = cap[r] - next.resources[r]; next.resources[r] += added; next.ledger.production[r] += added; next.earned[r] += added; }
  assertInvariants(next); return next;
}
function drain(s: GameState, resource: keyof Amounts, value: number): GameState {
  const next = structuredClone(s); next.ledger.operating[resource] += next.resources[resource] - value; next.resources[resource] = value; assertInvariants(next); return next;
}
function foundation(): GameState {
  let s = decodeSave(historical).state;
  for (const district of activeDistricts(s)) s = act(s, { type: 'auto-repair', district, enabled: false });
  for (const route of ROUTE_IDS) { s = act(s, { type: 'contract-pause', route }); s = act(s, { type: 'route-auto', route, enabled: false }); }
  if (s.outposts.active) s = act(s, { type: 'outpost-seal', confirmClear: true });
  s = act(s, { type: 'assembly-plan', ...s.experience.assembly, enabled: false }); return fund(s);
}
function build(s: GameState, definition: DefinitionId): GameState {
  s = act(fund(s), { type: 'enqueue', definition });
  for (let elapsed = 0; s.queue.some(p => p.definition === definition) && elapsed < 3000; elapsed += 50) s = run(s, 50);
  expect(s.queue.some(p => p.definition === definition)).toBe(false); return s;
}
let p13Cache: GameState | undefined;
function ready(): GameState {
  if (!p13Cache) {
    let s = act(foundation(), { type: 'story', node: 'L05-1' }); s = build(s, 'P13');
    expect(s.completed).toContain('P13'); expect(s.calendar.originSecond).toBe(s.clock.seconds);
    p13Cache = act(s, { type: 'story', node: 'L05-2' });
  }
  return structuredClone(p13Cache);
}
function atPosition(s: GameState, position: number): GameState { return run(s, (position - calendarClock(s).position + 600) % 600); }
function capture(s: GameState, target = 300): GameState {
  s = act(fund(s), { type: 'calendar-storage', enabled: true, target, reserve: amounts() });
  s = run(s, Math.max(0, Math.min(target, calendarCapacity(s)) - s.calendar.stored)); return act(s, { type: 'calendar-storage-pause' });
}
function supply(s: GameState, route: RouteId, mode: ProductionMode, loads = 1): GameState {
  if (s.network.routes[route].condition <= 0) s = build(s, `route:${route}`);
  s = fund(s);
  if (s.network.routes[route].node.mode !== mode) s = act(s, { type: 'production-mode', route, mode });
  return act(s, { type: 'dispatch', route, direction: 'outbound', loads });
}
function sameRoundBoost(s: GameState, route: RouteId, mode: ProductionMode): GameState {
  s = act(s, { type: 'calendar-toggle', enabled: false });
  if (s.calendar.stored < 60) s = capture(s);
  const position = route === 'rain' ? 10 : 250, travel = travelSeconds(s, route);
  s = atPosition(s, (position - travel + 600) % 600); s = run(supply(s, route, mode, 2), travel);
  // One ordinary batch leaves a real second supply package. Create the order
  // only after arrival, within this round's window, without inventing stock.
  const count = boostCount(s), round = calendarClock(s).round;
  s = act(s, { type: 'calendar-add', route, mode, delay: 0 });
  s = run(act(s, { type: 'calendar-toggle', enabled: true }), 1);
  expect(boostCount(s)).toBe(count + 1); expect(s.calendar.history.at(-1)).toMatchObject({ createdRound: round, completedRound: round });
  return act(s, { type: 'calendar-toggle', enabled: false });
}
let p15Cache: GameState | undefined;
function expanded(): GameState {
  if (!p15Cache) {
    let s = sameRoundBoost(capture(ready()), 'rain', 'normal'); s = build(s, 'P14');
    s = sameRoundBoost(s, 'station', 'normal'); s = build(s, 'P15');
    expect(s.calendar.crossRound).toBe(0); expect(calendarQueueLimit(s)).toBe(3); p15Cache = s;
  }
  return structuredClone(p15Cache);
}
function held(s: GameState, route: RouteId = 'rain', mode: ProductionMode = 'normal'): GameState {
  s = act(s, { type: 'calendar-add', route, mode, delay: 2 }); s = act(s, { type: 'calendar-toggle', enabled: true });
  s = run(supply(s, route, mode), travelSeconds(s, route)); expect(s.calendar.orders.at(-1)?.prepared).toBe(true);
  return act(s, { type: 'calendar-toggle', enabled: false });
}
function due(s: GameState): GameState {
  const order = s.calendar.orders[0], clock = calendarClock(s), start = order.route === 'rain' ? 0 : 240;
  return run(s, s.calendar.originSecond! + Math.max(order.earliestRound, clock.round + 1) * 600 + start - s.clock.seconds);
}
let serviceCache: GameState | undefined;
function serviceReady(): GameState {
  if (!serviceCache) { serviceCache = sameRoundBoost(expanded(), 'rain', 'specialty'); expect(serviceCache.calendar.allowance).toBe(3); }
  return structuredClone(serviceCache);
}

describe('V0.5 manual opening and time storage', () => {
  it('K01: real main/story chain requires manual decisions and actual cross-round production', () => {
    const fresh = createGame(), base = foundation();
    reject(fresh, { type: 'story', node: 'L05-1' }); reject(base, { type: 'enqueue', definition: 'P13' });
    for (const s of [fresh, base]) {
      reject(s, { type: 'calendar-storage', enabled: true, target: 120, reserve: amounts() });
      reject(s, { type: 'calendar-add', route: 'rain', mode: 'normal', delay: 0 });
      expect(run(s, 600).calendar).toEqual(createCalendar());
    }
    let s = act(base, { type: 'story', node: 'L05-1' });
    expect(s.resources).toEqual(base.resources); expect(s.queue).toEqual(base.queue);
    reject(s, { type: 'story', node: 'L05-2' }); s = build(s, 'P13');
    expect(s.calendar).toMatchObject({ allowance: 6, stored: 0, captured: 0, enabled: false, storage: { enabled: false, target: 120 } });
    expect(pendingStories(s)).toContain('L05-2'); reject(s, { type: 'calendar-toggle', enabled: true });
    s = act(s, { type: 'story', node: 'L05-2' }); reject(s, { type: 'story', node: 'L05-2' });
    for (const definition of ['P13', 'P14', 'P15'] as const) reject(s, { type: 'enqueue', definition });
    s = expanded(); reject(s, { type: 'enqueue', definition: 'P16' }); expect(s.experience.story['L05-3']).toBeUndefined();
    s = act(s, { type: 'story', node: 'L05-3' }); s = due(held(capture(s), 'station', 'specialty'));
    s = run(act(s, { type: 'calendar-toggle', enabled: true }), 1); expect(s.calendar.crossRound).toBe(1); s = build(s, 'P16');
    expect(pendingStories(s)).toContain('L05-4'); expect(s.experience.story['L05-4']).toBeUndefined();
    const before = structuredClone(s); s = act(s, { type: 'story', node: 'L05-4' });
    expect(s.resources).toEqual(before.resources); expect(s.ledger).toEqual(before.ledger);
    reject(s, { type: 'story', node: 'L05-4' }); reject(s, { type: 'enqueue', definition: 'P16' });
  });

  it.each([0, 119, 120, 239, 240, 359, 360, 599, 600])('K02: exact left-closed/right-open windows at elapsed second %i', elapsed => {
    const start = ready(), s = run(start, elapsed), position = elapsed % 600;
    expect(s.calendar.originSecond).toBe(start.calendar.originSecond);
    for (const id of ['home', 'rain', 'station'] as const) {
      const offset = id === 'home' ? 0 : id === 'rain' ? 120 : 360;
      const first = id === 'station' ? 240 : 0, last = id === 'rain' ? 120 : 360, overlap = position >= first && position < last;
      expect(calendarClock(s, id)).toEqual({ round: Math.floor(elapsed / 600), position, local: (position + offset) % 600, overlap,
        next: overlap ? 0 : position < first ? first - position : 600 - position + first });
    }
    expect(decodeSave(encodeSave(s, s.clock.lastAt)).state.calendar.originSecond).toBe(start.calendar.originSecond);
  });
});

describe('V0.5 capture payments and saved settings', () => {
  it('K03: charges whole capture steps, preserves zero, and expands capacity only after actual P14', () => {
    const before = fund(ready()), paused = run(before, 1);
    let s = run(act(before, { type: 'calendar-storage', enabled: true, target: 120, reserve: amounts() }), 1);
    expect(s.calendar.stored).toBe(1); expect(s.calendar.captured).toBe(1); expect(s.earned).toEqual(paused.earned);
    for (const r of RESOURCES) expect(s.ledger.operating[r] - paused.ledger.operating[r]).toBe(CALENDAR_RULES.captureCost[r]);
    s = act(before, { type: 'calendar-storage', enabled: true, target: 0, reserve: amounts() });
    const zero = run(s, 300); expect(zero.calendar.stored).toBe(0); expect(zero.calendar.captured).toBe(0);
    expect(zero.calendar.storage.target).toBe(0); expect(calendarStorageReason(zero)).toContain('目标');
    expect(decodeSave(encodeSave(zero, zero.clock.lastAt)).state.calendar.storage.target).toBe(0);
    s = run(act(fund(ready()), { type: 'calendar-storage', enabled: true, target: 600, reserve: amounts() }), 601);
    expect(s.calendar.stored).toBe(300); expect(s.calendar.storage.target).toBe(600); expect(s.calendar.captured).toBe(300);
    s = run(act(fund(expanded()), { type: 'calendar-storage', enabled: true, target: 600, reserve: amounts() }), 601);
    expect(s.calendar.stored).toBe(600); expect(calendarCapacity(s)).toBe(600);
    const stopped = act(s, { type: 'calendar-storage-pause' }); expect(run(stopped, 20).calendar).toEqual(stopped.calendar);
  });
  it.each(RESOURCES)('K03: honors the saved %s reserve, including non-payment resources', resource => {
    const before = fund(ready()), reserve = amounts(); reserve[resource] = capacities(before)[resource] + 1;
    const control = run(before, 1), waiting = run(act(before, { type: 'calendar-storage', enabled: true, target: 1, reserve }), 1);
    expect(waiting.calendar.stored).toBe(0); expect(waiting.ledger).toEqual(control.ledger);
    expect(run(act(waiting, { type: 'calendar-storage', enabled: true, target: 1, reserve: amounts() }), 1).calendar.stored).toBe(1);
  });
  it('K03: no partial payment on insufficient memory; invalid settings never replace the saved plan', () => {
    const before = drain(fund(ready()), 'memory', 19), control = run(before, 1);
    let s = run(act(before, { type: 'calendar-storage', enabled: true, target: 2, reserve: amounts() }), 1);
    expect(s.calendar.stored).toBe(0); expect(s.resources).toEqual(control.resources); expect(s.ledger).toEqual(control.ledger);
    for (const target of [-1, 0.5, 601, NaN]) reject(s, { type: 'calendar-storage', enabled: true, target, reserve: amounts() });
    reject(s, { type: 'calendar-storage', enabled: true, target: 1, reserve: amounts(-1) });
    reject(s, { type: 'calendar-storage', enabled: true, target: 1, reserve: amounts(1_000_000_001) });
    s = act(s, { type: 'calendar-storage-pause' }); expect(s.calendar.storage.enabled).toBe(false); expect(s.calendar.storage.target).toBe(2);
  });
});

describe('V0.5 actual local production and reservations', () => {
  it.each([['rain', 'normal'], ['rain', 'specialty'], ['station', 'normal'], ['station', 'specialty']] as const)('K04: %s/%s reuses exactly 60 local production steps without advancing other systems', (route, mode) => {
    let s = due(held(capture(expanded()), route, mode));
    const other = route === 'rain' ? 'station' : 'rain';
    s = supply(s, other, 'normal'); s = act(s, { type: 'enqueue', definition: `route:${other}` });
    s = run(s, 1); expect(s.queue[0].progress).toBeGreaterThan(0); expect(s.network.routes[other].trip!.remaining).toBeGreaterThan(0);
    s = act(s, { type: 'calendar-toggle', enabled: true });
    const before = structuredClone(s), expected = structuredClone(s), order = expected.calendar.orders.shift()!;
    for (let step = 0; step < 60; step++) tickNodeProduction(expected, route);
    const messages: string[] = []; tickCalendar(s, text => messages.push(text)); assertInvariants(s);
    expect(s.network.routes[route].node).toEqual(expected.network.routes[route].node);
    const recipe = RECIPES[route][mode], afterNode = s.network.routes[route].node, priorNode = before.network.routes[route].node;
    for (const r of RESOURCES) {
      expect(afterNode.produced[r] - priorNode.produced[r]).toBe(recipe.product[r]);
      expect(afterNode.used[r] - priorNode.used[r]).toBe(recipe.supply[r]);
      expect(afterNode.resources[r] - priorNode.resources[r]).toBe(recipe.product[r] - recipe.supply[r]);
      expect(before.resources[r] - s.resources[r]).toBe(CALENDAR_RULES.boostCost[r]);
      expect(s.ledger.operating[r] - before.ledger.operating[r]).toBe(CALENDAR_RULES.boostCost[r]);
    }
    expect(s.clock).toEqual(before.clock); expect(s.queue).toEqual(before.queue); expect(s.outposts).toEqual(before.outposts); expect(s.city).toEqual(before.city);
    expect(s.arrivalSeconds).toBe(before.arrivalSeconds); expect(s.earned).toEqual(before.earned);
    for (const id of ROUTE_IDS) { expect(s.network.routes[id].trip).toEqual(before.network.routes[id].trip); if (id !== route) expect(s.network.routes[id]).toEqual(before.network.routes[id]); }
    expect(s.calendar.stored).toBe(before.calendar.stored - 60); expect(s.calendar.captured).toBe(before.calendar.captured);
    expect(s.calendar.allowance).toBe(before.calendar.allowance - 1); expect(s.calendar.history.at(-1)?.uid).toBe(order.uid); expect(messages).toHaveLength(1);
  });
  it('K05: a real arrival is reserved before ordinary production; cargo in transit is never usable', () => {
    let s = act(ready(), { type: 'calendar-add', route: 'rain', mode: 'normal', delay: 0 });
    s = act(s, { type: 'calendar-toggle', enabled: true }); s = supply(s, 'rain', 'normal');
    const batches = s.network.routes.rain.node.batches.normal;
    s = run(s, travelSeconds(s, 'rain') - 1);
    expect(s.calendar.orders[0].prepared).toBe(false); expect(s.network.routes.rain.node.resources).toEqual(amounts());
    expect(calendarPrepareReason(s, s.calendar.orders[0])).toContain('在途');
    s = run(s, 1); expect(s.calendar.orders[0].prepared).toBe(true); expect(s.network.routes.rain.trip).toBeNull();
    expect(s.network.routes.rain.node.resources).toEqual(RECIPES.rain.normal.supply); expect(s.network.routes.rain.node.batches.normal).toBe(batches);
    expect(calendarHeld(s, 'rain', 'supply')).toEqual(RECIPES.rain.normal.supply); expect(reservedSpace(s, 'rain')).toEqual(RECIPES.rain.normal.product);
    const paused = act(s, { type: 'calendar-toggle', enabled: false }), later = run(paused, 100);
    expect(later.network.routes.rain.node.resources).toEqual(paused.network.routes.rain.node.resources); expect(later.calendar.orders).toEqual(paused.calendar.orders);
    const canceled = act(later, { type: 'calendar-cancel', uid: later.calendar.orders[0].uid });
    expect(canceled.network).toEqual(later.network); expect(canceled.ledger).toEqual(later.ledger); expect(canceled.earned).toEqual(later.earned);
    expect(calendarHeld(canceled, 'rain', 'supply')).toEqual(amounts()); expect(reservedSpace(canceled, 'rain')).toEqual(amounts());
    expect(run(canceled, 1).network.routes.rain.node.batches.normal).toBe(batches + 1);
  });
  it('K05: genuinely delivered partial inputs never reserve a partial package or charge a boost', () => {
    let s = capture(ready(), 60);
    s = run(supply(s, 'rain', 'specialty', 2), travelSeconds(s, 'rain'));
    expect(s.network.routes.rain.node.resources).toEqual(amounts(10000, 12000, 0, 0, 2000));
    s = act(s, { type: 'production-mode', route: 'rain', mode: 'normal' }); s = atPosition(s, 0);
    s = act(s, { type: 'calendar-add', route: 'rain', mode: 'normal', delay: 0 });
    s = act(s, { type: 'calendar-toggle', enabled: true });
    expect(calendarClock(s, 'rain').overlap).toBe(true); expect(s.calendar.stored).toBe(60);
    expect(calendarPrepareReason(s, s.calendar.orders[0])).toContain('零件');
    const before = structuredClone(s), control = run(act(s, { type: 'calendar-toggle', enabled: false }), 1);
    s = run(s, 1);
    expect(s.calendar.orders[0].prepared).toBe(false); expect(calendarHeld(s, 'rain', 'supply')).toEqual(amounts());
    expect(reservedSpace(s, 'rain')).toEqual(amounts());
    expect(s.network.routes.rain.node.resources).toEqual(before.network.routes.rain.node.resources);
    expect(s.network.routes.rain.node.used).toEqual(before.network.routes.rain.node.used);
    expect(s.network.routes.rain.node.received).toEqual(before.network.routes.rain.node.received);
    expect(s.resources).toEqual(control.resources); expect(s.ledger).toEqual(control.ledger);
    expect(s.calendar.stored).toBe(60); expect(s.calendar.allowance).toBe(6); expect(boostCount(s)).toBe(0);
  });
  it.each([2, 3])('K05: %i incoming packages allow only one preparation per second and never duplicate inputs', loads => {
    let s = expanded();
    for (let i = 0; i < 2; i++) s = act(s, { type: 'calendar-add', route: 'rain', mode: 'normal', delay: 2 });
    s = act(s, { type: 'calendar-toggle', enabled: true }); const batches = s.network.routes.rain.node.batches.normal;
    s = run(supply(s, 'rain', 'normal', loads), travelSeconds(s, 'rain'));
    expect(s.calendar.orders.map(o => o.prepared)).toEqual([true, false]); expect(s.network.routes.rain.node.batches.normal).toBe(batches + 1);
    s = run(s, 1); expect(s.calendar.orders.map(o => o.prepared)).toEqual([true, loads === 3]);
    expect(calendarHeld(s, 'rain', 'supply').parts).toBe((loads === 3 ? 2 : 1) * RECIPES.rain.normal.supply.parts);
    if (loads === 2) expect(calendarPrepareReason(s, s.calendar.orders[1])).toContain('占用');
  });
});

describe('V0.5 finite queue and competing capacity', () => {
  it('K05: full output space and existing whole-load reservations block preparation atomically', () => {
    let s = expanded();
    // Produce five more actual batches: the two earlier batches left 24 memory.
    s = run(supply(s, 'rain', 'normal', 3), travelSeconds(s, 'rain') + 120);
    s = run(supply(s, 'rain', 'normal', 2), travelSeconds(s, 'rain') + 60);
    expect(s.network.routes.rain.node.resources.memory).toBe(84000);
    for (let i = 0; i < 2; i++) s = act(s, { type: 'calendar-add', route: 'rain', mode: 'normal', delay: 2 });
    s = act(s, { type: 'calendar-toggle', enabled: true }); s = run(supply(s, 'rain', 'normal', 3), travelSeconds(s, 'rain'));
    expect(s.calendar.orders.map(o => o.prepared)).toEqual([true, false]); expect(reservedSpace(s, 'rain').memory).toBe(12000);
    expect(calendarPrepareReason(s, s.calendar.orders[1])).toContain('空间');
    const stock = structuredClone(s.network.routes.rain.node.resources); s = run(s, 1);
    expect(s.network.routes.rain.node.resources).toEqual(stock); expect(s.calendar.orders[1].prepared).toBe(false);
    s = supply(s, 'rain', 'normal', 3);
    expect(reservedSpace(s, 'rain')).toEqual(amounts(30000, 60000, 12000));
    expect(departureReason(s, 'rain', 'inbound', { normal: 1, specialty: 0 }, capacities(s))).toContain('途中');
    const before = structuredClone(s); s = act(s, { type: 'calendar-cancel', uid: s.calendar.orders[0].uid });
    expect(s.network).toEqual(before.network); expect(s.ledger).toEqual(before.ledger);
    expect(reservedSpace(s, 'rain')).toEqual(amounts(30000, 60000));
  });
  it('K06: limit, immutable snapshots, mode/staff waits and moving a blocked head preserve costs', () => {
    let s = ready(); s = act(s, { type: 'calendar-add', route: 'rain', mode: 'normal', delay: 2 });
    reject(s, { type: 'calendar-add', route: 'station', mode: 'specialty', delay: 0 });
    s = due(held(capture(expanded()), 'rain', 'normal')); s = act(s, { type: 'calendar-toggle', enabled: true });
    const saved = structuredClone(s.calendar.orders[0]);
    s = act(s, { type: 'production-mode', route: 'rain', mode: 'specialty' });
    expect(s.calendar.orders[0]).toEqual(saved); expect(calendarOrderReason(s)).toContain('模式');
    const modeBlocked = structuredClone(s); tickCalendar(s, () => {}); expect(s).toEqual(modeBlocked);
    s = act(s, { type: 'production-mode', route: 'rain', mode: 'normal' });
    const staff = s.network.routes.rain.staff!; s = act(s, { type: 'network-staff', route: 'rain', ...staff, delta: -1 });
    expect(calendarOrderReason(s)).toContain('夜工'); const staffBlocked = structuredClone(s); tickCalendar(s, () => {}); expect(s).toEqual(staffBlocked);
    s = act(s, { type: 'network-staff', route: 'rain', ...staff, delta: 1 });
    s = act(s, { type: 'calendar-add', route: 'station', mode: 'specialty', delay: 2 });
    s = act(s, { type: 'calendar-add', route: 'rain', mode: 'specialty', delay: 0 });
    reject(s, { type: 'calendar-add', route: 'rain', mode: 'normal', delay: 0 });
    const original = structuredClone(s), second = s.calendar.orders[1].uid;
    s = act(s, { type: 'calendar-move', uid: second, direction: -1 });
    expect(s.calendar.orders.map(o => o.uid)).toEqual([second, saved.uid, original.calendar.orders[2].uid]);
    expect(s.calendar.orders[1]).toEqual(saved); expect(s.resources).toEqual(original.resources); expect(s.network).toEqual(original.network);
    expect(calendarOrderReason(s)).toContain('等待第');
    const count = boostCount(s); s = run(s, 10); expect(boostCount(s)).toBe(count); expect(s.calendar.orders).toHaveLength(3);
  });
  it('K06: three held orders execute at most once per second, then the finite list stays empty', () => {
    let s = atPosition(capture(expanded()), 300);
    for (let i = 0; i < 3; i++) s = act(s, { type: 'calendar-add', route: 'rain', mode: 'normal', delay: 2 });
    s = act(s, { type: 'calendar-toggle', enabled: true }); s = run(supply(s, 'rain', 'normal', 3), travelSeconds(s, 'rain') + 1);
    s = run(supply(s, 'rain', 'normal'), travelSeconds(s, 'rain')); expect(s.calendar.orders.every(o => o.prepared)).toBe(true);
    s = act(s, { type: 'calendar-toggle', enabled: false }); s = due(s);
    const count = boostCount(s), captured = s.calendar.captured, allowance = s.calendar.allowance;
    s = act(s, { type: 'calendar-toggle', enabled: true });
    for (let i = 1; i <= 3; i++) { s = run(s, 1); expect(boostCount(s)).toBe(count + i); expect(s.calendar.orders).toHaveLength(3 - i); }
    expect(s.calendar.captured).toBe(captured); expect(s.calendar.allowance).toBe(allowance - 3);
    expect(s.calendar.history.slice(-3).map(record => record.second)).toEqual([s.clock.seconds - 2, s.clock.seconds - 1, s.clock.seconds]);
    const nextOrder = s.calendar.nextOrder; s = run(s, 1200); expect(s.calendar.nextOrder).toBe(nextOrder); expect(boostCount(s)).toBe(count + 3);
  });
});

describe('V0.5 calibration belongs to the original global work queue', () => {
  it('K06/K07: real exhaustion waits without charging and service requires the depleted allowance', () => {
    reject(ready(), { type: 'enqueue', definition: 'calendar:service' });
    let s = serviceReady();
    for (const [route, mode] of [['station', 'specialty'], ['rain', 'specialty'], ['station', 'specialty']] as const) s = sameRoundBoost(s, route, mode);
    expect(s.calendar.allowance).toBe(0); expect(boostCount(s)).toBe(6);
    s = due(held(capture(s), 'rain', 'normal')); s = act(s, { type: 'calendar-toggle', enabled: true });
    expect(calendarOrderReason(s)).toContain('校准次数'); const before = structuredClone(s); tickCalendar(s, () => {}); expect(s).toEqual(before);
    s = act(s, { type: 'calendar-toggle', enabled: false }); s = build(s, 'calendar:service');
    expect(s.calendar.services).toBe(1); expect(s.calendar.allowance).toBe(3); expect(s.calendar.stored).toBe(before.calendar.stored);
    expect(s.completed).not.toContain('calendar:service'); expect(s.calendar.enabled).toBe(false); expect(s.calendar.storage.enabled).toBe(false);
  });
  it('K07: three scoped projects share one head; calibration pause/cancel/refund and completion stay exact', () => {
    let s = serviceReady();
    expect(prefabLimit(definitionFor(s, 'calendar:service'))).toBe(0);
    reject(s, { type: 'enqueue', definition: 'calendar:service', prefab: 1 });
    reject(s, { type: 'enqueue', definition: 'calendar:service', district: 'district-1' });
    s = act(s, { type: 'outpost-open', outpost: 'O01', crew: [{ district: 'district-1', resident: 'shadow' }, { district: 'district-2', resident: 'echo' }] });
    s = act(s, { type: 'outpost-assign', resident: 'shadow', job: 'salvage', delta: 1 });
    s = run(s, 150); s = act(s, { type: 'outpost-assign', resident: 'shadow', job: 'salvage', delta: -1 });
    s = act(s, { type: 'outpost-assign', resident: 'echo', job: 'repair', delta: 1 });
    s = act(s, { type: 'outpost-enqueue', definition: 'build:recycler' });
    s = act(fund(s), { type: 'enqueue', definition: 'calendar:service' }); s = act(s, { type: 'enqueue', definition: 'build:generator' });
    expect(s.queue).toHaveLength(3); reject(s, { type: 'enqueue', definition: 'maintain:relay' });
    s = run(s, 1); const localUid = s.queue[0].uid; expect(s.queue[0].progress).toBeGreaterThan(0); expect(s.queue[1].progress).toBe(0);
    s = act(s, { type: 'pause', uid: localUid }); const paused = run(s, 20);
    expect(paused.queue.map(p => p.progress)).toEqual(s.queue.map(p => p.progress));
    s = act(paused, { type: 'resume', uid: localUid });
    for (let i = 0; s.queue[0]?.uid === localUid && i < 500; i++) s = run(s, 1);
    expect(s.queue[0]).toMatchObject({ definition: 'calendar:service', status: 'waiting', progress: 0, reserved: amounts() });
    const beforeService = structuredClone(s); s = run(s, 1); const serviceUid = s.queue[0].uid;
    expect(s.queue[0].progress).toBeGreaterThan(0); expect(s.queue[0].reserved).toEqual(CALENDAR_RULES.serviceCost);
    expect(s.outposts.sites.O01!.ledger.reserved).toEqual(beforeService.outposts.sites.O01!.ledger.reserved);
    s = act(s, { type: 'pause', uid: serviceUid }); const heldProgress = s.queue[0].progress; s = run(s, 10); expect(s.queue[0].progress).toBe(heldProgress);
    const refunded = refundPreview(s, s.queue[0]), earned = structuredClone(s.earned), resources = structuredClone(s.resources), local = structuredClone(s.outposts);
    s = act(s, { type: 'cancel', uid: serviceUid }); expect(s.earned).toEqual(earned); expect(s.outposts).toEqual(local); expect(s.calendar.services).toBe(0);
    for (const r of RESOURCES) expect(s.resources[r] - resources[r]).toBe(refunded.actual[r]);
    reject(s, { type: 'cancel', uid: serviceUid }); s = act(s, { type: 'cancel', uid: s.queue[0].uid });
    const savedTime = s.calendar.stored; s = build(s, 'calendar:service');
    expect(s.calendar.services).toBe(1); expect(s.calendar.allowance).toBe(6); expect(s.calendar.stored).toBe(savedTime);
    expect(s.completed).not.toContain('calendar:service'); expect(run(s, 300).calendar).toEqual(s.calendar);
  });
});

it('K03/K06: missing time or a saved boost reserve never consumes an input package or partial fee', () => {
  let s = due(held(ready())); s = act(s, { type: 'calendar-toggle', enabled: true });
  expect(calendarOrderReason(s)).toContain('时间储备'); const before = structuredClone(s); tickCalendar(s, () => {}); expect(s).toEqual(before);
  s = act(s, { type: 'calendar-toggle', enabled: false }); s = capture(s); s = due(s);
  const reserve = amounts(); reserve.component = capacities(s).component + 1;
  s = act(s, { type: 'calendar-storage', enabled: false, target: 300, reserve }); s = act(s, { type: 'calendar-toggle', enabled: true });
  expect(calendarOrderReason(s)).toContain('保留库存'); const blocked = structuredClone(s); tickCalendar(s, () => {}); expect(s).toEqual(blocked);
  s = act(s, { type: 'calendar-storage', enabled: true, target: 300, reserve: amounts() });
  s = run(s, 1); expect(s.calendar.stored).toBe(240); const captured = s.calendar.captured;
  s = run(s, 60); expect(s.calendar.stored).toBe(300); expect(s.calendar.captured - captured).toBe(60); expect(boostCount(s)).toBe(1);
});

function equivalenceStart(): GameState {
  let s = atPosition(serviceReady(), 300);
  for (let i = 0; i < 3; i++) s = act(s, { type: 'calendar-add', route: 'rain', mode: 'normal', delay: 2 });
  s = act(s, { type: 'calendar-toggle', enabled: true }); s = run(supply(s, 'rain', 'normal', 3), travelSeconds(s, 'rain') + 1);
  s = run(supply(s, 'rain', 'normal'), travelSeconds(s, 'rain'));
  expect(s.calendar.orders.every(order => order.prepared)).toBe(true);
  s = act(fund(s), { type: 'enqueue', definition: 'calendar:service' });
  s = act(s, { type: 'calendar-storage', enabled: true, target: 600, reserve: amounts() });
  s.clock.remainderMs = 731; assertInvariants(s); return s;
}
describe('V0.5 identical online/offline logical time', () => {
  it.each([900000, 86400000, 604800000])('K09: %ims plus 517ms equals irregular segments for state and additive reports', elapsed => {
    const s = equivalenceStart(), whole = advance(s, elapsed + 517), expected = summarize(s, whole, elapsed + 517);
    let split = s, remaining = elapsed + 517, index = 0;
    const intervals = [713, 98765, 321001, 1234567], flows = Object.fromEntries(FLOWS.map(flow => [flow, amounts()])) as typeof expected.flows;
    let captured = 0, used = 0, services = 0, seconds = 0;
    const boosts = { rain: { normal: 0, specialty: 0 }, station: { normal: 0, specialty: 0 } };
    while (remaining > 0) {
      const step = Math.min(remaining, intervals[index++ % intervals.length]), next = advance(split, step), report = summarize(split, next, step);
      for (const f of FLOWS) for (const r of RESOURCES) flows[f][r] += report.flows[f][r];
      captured += report.calendar!.captured; used += report.calendar!.used; services += report.calendar!.services; seconds += report.seconds;
      for (const id of ROUTE_IDS) for (const mode of ['normal', 'specialty'] as const) boosts[id][mode] += report.calendar!.boosts[id][mode];
      split = next; remaining -= step;
    }
    expect(index).toBeGreaterThanOrEqual(4); expect(split).toEqual(whole); expect(whole.clock.remainderMs).toBe(248); assertInvariants(whole);
    expect(summarize(s, split, elapsed + 517)).toEqual(expected); expect(flows).toEqual(expected.flows); expect(seconds).toBe(expected.seconds);
    expect({ captured, used, services, boosts }).toEqual({ captured: expected.calendar!.captured, used: expected.calendar!.used, services: expected.calendar!.services, boosts: expected.calendar!.boosts });
    expect(boostCount(whole) - boostCount(s)).toBe(3); expect(whole.calendar.crossRound - s.calendar.crossRound).toBe(3);
    expect(whole.calendar.services - s.calendar.services).toBe(1); expect(whole.calendar.stored).toBe(600); expect(whole.calendar.orders).toEqual([]);
    expect(expected.calendar!.used).toBe(180); expect(expected.calendar!.produced.rain.memory).toBe(36000);
  }, 180000);
});
