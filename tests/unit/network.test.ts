import { preExpansion } from '../legacy-shape';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { advance, applyAction, capacities, createGame, freeResidents, summarize } from '../../src/game/engine';
import { activeDistricts, districtState } from '../../src/game/city';
import { amounts, RESIDENTS, RESOURCES } from '../../src/game/config';
import { createNetwork, NETWORK_RULES, ROUTE_IDS, ROUTES } from '../../src/game/network';
import { assertInvariants, decodeSave, encodeSave } from '../../src/game/saves';
import type { Action, DefinitionId, GameState, Resource } from '../../src/game/types';

const v2Text = readFileSync(new URL('../fixtures/v0.2-chapter.json', import.meta.url), 'utf8');
const v3Text = readFileSync(new URL('../fixtures/v0.3-chapter.json', import.meta.url), 'utf8');
function act(s: GameState, action: Action) { const result = applyAction(s, action); expect(result.error).toBeNull(); assertInvariants(result.state); return result.state; }
function stock(s: GameState, resource: Resource, value: number) {
  const delta = value - s.resources[resource]; s.resources[resource] = value;
  if (delta >= 0) { s.ledger.production[resource] += delta; s.earned[resource] += delta; } else s.ledger.operating[resource] -= delta;
}
function fill(s: GameState) { for (const r of RESOURCES) stock(s, r, capacities(s)[r]); }
function old() {
  let s = decodeSave(v2Text).state;
  for (const id of activeDistricts(s)) for (const resident of RESIDENTS) for (const job of ['salvage', 'record'] as const) {
    while (districtState(s, id)!.assignments[resident][job]) s = act(s, { type: 'assign', district: id, resident, job, delta: -1 });
  }
  return s;
}
function finish(state: GameState, definition: DefinitionId) {
  let s = structuredClone(state); fill(s); s = act(s, { type: 'enqueue', definition });
  const uid = s.queue.at(-1)!.uid;
  for (let i = 0; i < 1500 && s.queue.some(p => p.uid === uid); i++) s = advance(s, 1000);
  expect(s.queue.some(p => p.uid === uid)).toBe(false); assertInvariants(s); return s;
}
function rain() {
  let s = finish(old(), 'P08');
  s = act(s, { type: 'network-staff', route: 'rain', district: 'district-0', resident: 'shadow', delta: 1 }); return s;
}
function firstReturn() {
  let s = act(rain(), { type: 'dispatch', route: 'rain', direction: 'outbound', loads: 1 }); s = advance(s, 120000);
  s = act(s, { type: 'dispatch', route: 'rain', direction: 'inbound', loads: 1 }); s = advance(s, 120000);
  return act(s, { type: 'event', event: 'E12', choice: 'reliable' });
}
function both(expanded = false) {
  let s = finish(finish(firstReturn(), 'P09'), 'R05');
  s = act(s, { type: 'network-staff', route: 'station', district: 'district-0', resident: 'echo', delta: 1 });
  if (expanded) s = finish(s, 'R06');
  return s;
}

describe('V0.3 migration, inventory and workers', () => {
  it('N01: migrates the genuine V0.2 chapter and its historical report without free cargo', () => {
    const raw = JSON.parse(v2Text), migrated = decodeSave(v2Text);
    expect(migrated.migratedFrom).toBe(2); expect(migrated.schemaVersion).toBe(4);
    for (const key of ['resources', 'earned', 'facilities', 'population', 'assignments', 'events', 'completed', 'queue', 'city', 'clock', 'history'] as const) expect(preExpansion(migrated.state[key])).toEqual(raw.state[key]);
    expect(preExpansion(migrated.state.ledger)).toEqual(preExpansion({ ...raw.state.ledger, exports: amounts(), imports: amounts() }));
    expect(preExpansion(migrated.state.report)).toEqual(preExpansion({ ...raw.state.report, flows: { ...raw.state.report.flows, exports: amounts(), imports: amounts() }, transport: { departures: 0, deliveries: 0, maintenance: 0 } }));
    expect(migrated.state.network).toEqual(createNetwork()); expect(decodeSave(encodeSave(migrated.state, 0)).state).toEqual(migrated.state);
  });
  it('N01: rejects new content disguised as an old state or historical report', () => {
    for (const alter of [
      (raw: any) => { raw.state.network = createNetwork(); },
      (raw: any) => { raw.state.completed.push('P08'); },
      (raw: any) => { raw.state.report.completed.push('P08'); },
      (raw: any) => { raw.state.events.E11 = { status: 'pending' }; },
      (raw: any) => { raw.state.queue.push({ uid: 'q-999', definition: 'route:rain', district: 'district-0', targetLevel: 1, status: 'waiting', progress: 0, reserved: amounts() }); }
    ]) {
      const raw = JSON.parse(v2Text); alter(raw); expect(() => decodeSave(JSON.stringify(raw))).toThrow();
    }
  });
  it('N01: V0.2 paused work keeps its reservation and millisecond remainder after migration', () => {
    let paused = act(decodeSave(v2Text).state, { type: 'enqueue', definition: 'build:generator' });
    paused = advance(paused, 1517); paused = act(paused, { type: 'pause', uid: paused.queue[0].uid });
    expect(paused.queue[0].reserved.parts).toBeGreaterThan(0); expect(paused.clock.remainderMs).toBe(517);
    const oldSave = preExpansion(JSON.parse(encodeSave(paused, 0))); oldSave.schemaVersion = 2; oldSave.balanceVersion = '0.2.0';
    delete oldSave.state.network;
    for (const flows of [oldSave.state.ledger, oldSave.state.report.flows]) { delete flows.exports; delete flows.imports; }
    delete oldSave.state.report.transport;
    let migrated = decodeSave(JSON.stringify(oldSave)).state; expect(preExpansion(migrated)).toEqual(preExpansion(paused));
    const reserved = { ...migrated.ledger.reserved };
    migrated = act(migrated, { type: 'resume', uid: migrated.queue[0].uid }); migrated = advance(migrated, 100000);
    expect(migrated.facilities.generator).toBe(3); expect(migrated.ledger.reserved).toEqual(reserved); assertInvariants(migrated);
  });
  it('N02/03: actually ships supply, manufactures rain memory and imports it exactly once', () => {
    const before = rain(); let s = act(before, { type: 'dispatch', route: 'rain', direction: 'outbound', loads: 1 });
    expect(s.resources.parts).toBe(before.resources.parts - 20000); expect(s.resources.energy).toBe(before.resources.energy - 14000);
    expect(s.network.routes.rain.node.resources).toEqual(amounts()); expect(s.earned).toEqual(before.earned);
    s = advance(s, 119000); expect(s.network.routes.rain.trip?.remaining).toBe(1);
    s = advance(s, 1000); expect(s.network.routes.rain.node.resources).toEqual(amounts(0, 0, 12000));
    const memory = s.resources.memory, earned = s.earned.memory;
    s = act(s, { type: 'dispatch', route: 'rain', direction: 'inbound', loads: 1 });
    expect(s.network.routes.rain.node.resources.memory).toBe(0); expect(s.resources.memory).toBe(memory);
    s = advance(s, 120000); expect(s.resources.memory).toBe(memory + 12000); expect(s.earned.memory).toBe(earned);
    expect(s.network.routes.rain.imports).toBe(1); expect(advance(s, 1000).resources.memory).toBe(s.resources.memory);
    const report = summarize(before, s, 240000); expect(report.transport).toEqual({ departures: 2, deliveries: 2, maintenance: 0 });
    expect(report.flows.exports).toEqual(amounts(10000, 20000)); expect(report.flows.imports.memory).toBe(12000);
    for (const r of RESOURCES) expect(report.end[r]).toBe(report.start[r] + report.flows.production[r] + report.flows.rewards[r] + report.flows.refunds[r] + report.flows.imports[r] - report.flows.exports[r] - report.flows.operating[r] - report.flows.reserved[r]);
    assertInvariants(s);
  });
  it('N02: full home storage retains the complete cargo and occupied vehicle until room opens', () => {
    let s = advance(act(rain(), { type: 'dispatch', route: 'rain', direction: 'outbound', loads: 1 }), 120000);
    s = act(s, { type: 'dispatch', route: 'rain', direction: 'inbound', loads: 1 }); stock(s, 'memory', capacities(s).memory);
    s = advance(s, 200000); expect(s.network.routes.rain.trip?.remaining).toBe(0); expect(s.network.routes.rain.imports).toBe(0); expect(s.ledger.imports.memory).toBe(0);
    expect(applyAction(s, { type: 'network-staff', route: 'rain', district: 'district-0', resident: 'shadow', delta: -1 }).error).toContain('运输');
    const restored = decodeSave(encodeSave(s, 0)).state; stock(restored, 'memory', capacities(s).memory - 12000);
    s = advance(restored, 1000); expect(s.network.routes.rain.trip).toBeNull(); expect(s.resources.memory).toBe(capacities(s).memory); expect(s.network.routes.rain.imports).toBe(1); assertInvariants(s);
  });
  it('N02: failed departure does not deduct stock, fees, wear or an ID', () => {
    const states = [rain(), rain(), rain()]; stock(states[0], 'parts', 0); states[1].network.routes.rain.condition = 0;
    for (const [i, s] of states.entries()) {
      const action: Action = { type: 'dispatch', route: 'rain', direction: 'outbound', loads: i === 2 ? 2 : 1 }, before = structuredClone(s), result = applyAction(s, action);
      expect(result.error).not.toBeNull(); expect(result.state).toEqual(before); expect(s).toEqual(before);
    }
  });
  it('N03: missing supply and output capacity stop the entire city recipe without overflow', () => {
    let s = advance(rain(), 120000); expect(s.network.routes.rain.node.resources).toEqual(amounts());
    for (let i = 0; i < 9; i++) { fill(s); s = advance(act(s, { type: 'dispatch', route: 'rain', direction: 'outbound', loads: 1 }), 120000); }
    const before = s.network.routes.rain.node; expect(before.resources.memory).toBe(96000); expect(before.resources.parts).toBe(20000);
    s = advance(s, 120000); expect(s.network.routes.rain.node.resources).toEqual(before.resources); expect(s.network.routes.rain.node.used).toEqual(before.used); assertInvariants(s);
  });
  it('N04: external assignments cannot also fill jobs, relocate or apply an oversized template', () => {
    let s = finish(old(), 'P08');
    s = act(s, { type: 'assign', resident: 'shadow', job: 'salvage', delta: 1 });
    s = act(s, { type: 'template-save', district: 'district-0', name: '本城满班' });
    s = act(s, { type: 'assign', resident: 'shadow', job: 'salvage', delta: -1 });
    s = act(s, { type: 'network-staff', route: 'rain', district: 'district-0', resident: 'shadow', delta: 1 });
    expect(freeResidents(s, 'shadow')).toBe(0);
    for (const action of [
      { type: 'assign', resident: 'shadow', job: 'salvage', delta: 1 },
      { type: 'relocate', resident: 'shadow', from: 'district-0', to: 'district-1' },
      { type: 'template-apply', name: '本城满班' }
    ] as Action[]) { const result = applyAction(s, action); expect(result.error).not.toBeNull(); expect(result.state).toEqual(s); }
    s = act(s, { type: 'network-staff', route: 'rain', district: 'district-0', resident: 'shadow', delta: -1 }); expect(freeResidents(s, 'shadow')).toBe(1);
    expect(act(s, { type: 'template-apply', name: '本城满班' }).assignments.shadow.salvage).toBe(1);
  });
});

describe('V0.3 contracts, maintenance and time', () => {
  it('N05: route priority competes for the single vehicle and R06 enables real parallel batches', () => {
    let s = both(); fill(s);
    for (const id of ROUTE_IDS) s = act(s, { type: 'contract', route: id, enabled: true, loads: 1, reserve: amounts() });
    const rainFirst = advance(s, 1000), stationFirst = advance(act(s, { type: 'network-priority', order: ['station', 'rain'] }), 1000);
    expect(rainFirst.network.routes.rain.trip).not.toBeNull(); expect(rainFirst.network.routes.station.trip).toBeNull();
    expect(stationFirst.network.routes.station.trip).not.toBeNull(); expect(stationFirst.network.routes.rain.trip).toBeNull();
    const base = both(true); fill(base);
    let expanded = act(base, { type: 'dispatch', route: 'rain', direction: 'outbound', loads: 2 });
    expanded = act(expanded, { type: 'dispatch', route: 'station', direction: 'outbound', loads: 2 });
    expect(ROUTE_IDS.every(id => expanded.network.routes[id].trip?.loads === 2)).toBe(true); assertInvariants(expanded);
  });
  it('N05: automatic reserves include fees; disabling a contract leaves cargo in transit', () => {
    let s = finish(firstReturn(), 'R05'); fill(s); const reserve = { ...s.resources };
    s = act(s, { type: 'contract', route: 'rain', enabled: true, loads: 1, reserve });
    expect(advance(s, 1000).network.routes.rain.trip).toBeNull();
    reserve.energy -= 13000; reserve.parts -= 20000;
    s = act(s, { type: 'contract', route: 'rain', enabled: true, loads: 1, reserve });
    expect(advance(s, 1000).network.routes.rain.trip).toBeNull();
    reserve.energy -= 1000;
    s = act(s, { type: 'contract', route: 'rain', enabled: true, loads: 1, reserve });
    s = advance(s, 1000); expect(s.network.routes.rain.trip).not.toBeNull(); const trip = structuredClone(s.network.routes.rain.trip);
    s = act(s, { type: 'contract', route: 'rain', enabled: false, loads: 1, reserve }); expect(s.network.routes.rain.trip).toEqual(trip);
    s = advance(s, 120000); expect(s.network.routes.rain.trip).toBeNull(); expect(s.network.routes.rain.exports).toBe(2); assertInvariants(s);
  });
  it('N06: exhausted lines permit existing arrival and manual maintenance applies only once', () => {
    let s = rain(); s.network.routes.rain.condition = 1;
    s = act(s, { type: 'dispatch', route: 'rain', direction: 'outbound', loads: 1 }); expect(s.network.routes.rain.condition).toBe(0);
    s = advance(s, 120000); expect(s.network.routes.rain.exports).toBe(1);
    expect(applyAction(s, { type: 'dispatch', route: 'rain', direction: 'inbound', loads: 1 }).error).toContain('耗尽');
    s = finish(s, 'route:rain'); expect(s.network.routes.rain.condition).toBe(NETWORK_RULES.condition); expect(s.network.maintenance).toBe(1);
    expect(advance(s, 1000).network.maintenance).toBe(1); expect(s.completed.some(id => id.startsWith('route:'))).toBe(false);
  });
  it('N06: automatic route work respects full queues, paused work, worker and supply shortages', () => {
    let s = rain(); s.network.routes.rain.condition = 0;
    s = act(s, { type: 'route-auto', route: 'rain', enabled: true }); s = act(s, { type: 'enqueue', definition: 'build:generator' });
    s = advance(s, 1000); s = act(s, { type: 'pause', uid: s.queue[0].uid });
    s = advance(s, 120000); expect(s.network.maintenance).toBe(0); expect(s.queue.filter(p => p.definition === 'route:rain')).toHaveLength(1);
    s = act(s, { type: 'cancel', uid: s.queue[0].uid });
    for (const id of activeDistricts(s)) for (const resident of RESIDENTS) while (districtState(s, id)!.assignments[resident].repair) s = act(s, { type: 'assign', district: id, resident, job: 'repair', delta: -1 });
    const missingWorkers = advance(s, 120000); expect(missingWorkers.network.maintenance).toBe(0); expect(missingWorkers.queue[0].status).toBe('waiting');
    s = act(s, { type: 'assign', resident: 'echo', job: 'repair', delta: 1 }); stock(s, 'parts', 0);
    expect(advance(s, 120000).network.maintenance).toBe(0); fill(s); s = advance(s, 130000);
    expect(s.network.maintenance).toBe(1); assertInvariants(s);
  });
  it('N06: full queues defer automatic route work and cancellation refunds its remaining materials', () => {
    let s = rain(); s.network.routes.rain.condition = 0;
    s = act(s, { type: 'route-auto', route: 'rain', enabled: true });
    for (const definition of ['build:generator', 'build:warehouse', 'build:workbench'] as const) s = act(s, { type: 'enqueue', definition });
    s = advance(s, 1000); s = act(s, { type: 'pause', uid: s.queue[0].uid });
    const waiting = advance(s, 120000); expect(waiting.queue).toHaveLength(3); expect(waiting.queue.some(p => p.definition === 'route:rain')).toBe(false);
    s = act(waiting, { type: 'cancel', uid: waiting.queue[2].uid }); s = advance(s, 1000);
    expect(s.queue.at(-1)!.definition).toBe('route:rain');
    while (s.queue[0].definition !== 'route:rain') s = act(s, { type: 'cancel', uid: s.queue[0].uid });
    s = advance(s, 1000); expect(s.queue[0].status).toBe('running'); const before = structuredClone(s);
    s = act(s, { type: 'cancel', uid: s.queue[0].uid });
    expect(s.earned).toEqual(before.earned); expect(s.ledger.refunds.parts).toBeGreaterThan(before.ledger.refunds.parts);
    expect(s.network.maintenance).toBe(0); assertInvariants(s);
  });
  it('N06: the two persistent choices change future travel and wear without changing an existing trip', () => {
    const returned = advance(act(advance(act(rain(), { type: 'dispatch', route: 'rain', direction: 'outbound', loads: 1 }), 120000), { type: 'dispatch', route: 'rain', direction: 'inbound', loads: 1 }), 120000);
    const reliable = act(returned, { type: 'event', event: 'E12', choice: 'reliable' }), express = act(returned, { type: 'event', event: 'E12', choice: 'express' });
    const a = act(reliable, { type: 'dispatch', route: 'rain', direction: 'outbound', loads: 1 }), b = act(express, { type: 'dispatch', route: 'rain', direction: 'outbound', loads: 1 });
    expect(a.network.routes.rain.trip!.duration).toBe(120); expect(b.network.routes.rain.trip!.duration).toBe(96);
    expect(a.network.routes.rain.condition - b.network.routes.rain.condition).toBe(70);
    expect(applyAction(b, { type: 'event', event: 'E12', choice: 'reliable' }).error).not.toBeNull();
    const existing = act(returned, { type: 'dispatch', route: 'rain', direction: 'outbound', loads: 1 });
    const chosenDuringTravel = act(existing, { type: 'event', event: 'E12', choice: 'express' });
    expect(chosenDuringTravel.network.routes.rain.trip).toEqual(existing.network.routes.rain.trip);
    expect(advance(chosenDuringTravel, 120000).network.routes.rain.trip).toBeNull();
  });
  it('N01/02: rejects forged cargo, worker overlap, counters, recipes, priorities and clocks', () => {
    const s = act(rain(), { type: 'dispatch', route: 'rain', direction: 'outbound', loads: 1 });
    const edits: ((raw: any) => void)[] = [
      raw => { raw.state.network.routes.rain.trip.cargo.memory = 1; },
      raw => { raw.state.assignments.shadow.salvage++; },
      raw => { raw.state.network.routes.rain.node.resources.memory++; },
      raw => { raw.state.network.routes.rain.departures++; },
      raw => { raw.state.network.nextTrip++; },
      raw => { raw.state.network.priority = ['rain', 'rain']; },
      raw => { raw.state.network.routes.rain.trip.remaining = 121; },
      raw => { raw.state.network.routes.rain.trip.duration = 96; },
      raw => { raw.state.network.routes.rain.contract.loads = 0; },
      raw => { raw.state.report.transport.deliveries = -1; }
    ];
    for (const edit of edits) { const raw = JSON.parse(encodeSave(s, 0)); edit(raw); expect(() => decodeSave(JSON.stringify(raw))).toThrow(); }
  });
  it('N07: in-transit saves round-trip and irregular elapsed segments match a full day', () => {
    let before = both(true); fill(before);
    for (const id of ROUTE_IDS) {
      before = act(before, { type: 'contract', route: id, enabled: true, loads: 1, reserve: amounts(30000, 30000, 5000) });
      before = act(before, { type: 'route-auto', route: id, enabled: true });
    }
    // Existing local producers sustain repeatable contracts while storage limits
    // and stalled unloading still constrain each route naturally.
    before = act(before, { type: 'assign', district: 'district-2', resident: 'echo', job: 'record', delta: 1 });
    before = advance(before, 1000); expect(decodeSave(encodeSave(before, 0)).state).toEqual(before);
    const whole = advance(before, 86400517); let split = before;
    for (const elapsed of [119111, 29999, 1001, 630017, 1000000, 60000000, 24620389]) split = advance(split, elapsed);
    expect(split).toEqual(whole); assertInvariants(whole);
    const report = summarize(before, whole, 86400517); whole.report = report; expect(decodeSave(encodeSave(whole, 0)).state).toEqual(whole);
    expect(report.transport.deliveries).toBeGreaterThan(0); expect(whole.network.maintenance).toBeGreaterThan(0);
  });
  it('N07: seven days stay bounded and preserve both external city and transport accounting', () => {
    const s = decodeSave(v3Text).state; const after = advance(s, 604800000); assertInvariants(after);
    expect(after.network.nextTrip).toBeGreaterThan(s.network.nextTrip);
    for (const id of ROUTE_IDS) for (const r of RESOURCES) expect(after.network.routes[id].node.resources[r]).toBeLessThanOrEqual(ROUTES[id].capacity[r]);
    expect(decodeSave(encodeSave(after, 0)).state).toEqual(after);
  });
  it('N01: a fresh game has no unlocked routes, phantom stock or vehicles in transit', () => {
    const s = createGame(); expect(s.network).toEqual(createNetwork()); assertInvariants(s);
  });
});
