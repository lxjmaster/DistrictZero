import { readFileSync } from 'node:fs';
import { setImmediate } from 'node:timers/promises';
import { describe, expect, it } from 'vitest';
import { amounts, JOBS, RESIDENTS, RESOURCES, UNIT } from '../../src/game/config';
import { activeDistricts, districtState } from '../../src/game/city';
import { activateNetworkRules, advance, applyAction, capacities, refundPreview, stockLimits, summarize, unlockReason } from '../../src/game/engine';
import { pendingStories } from '../../src/game/experience';
import { LEGACY_ARCHIVE_IDS, archivesUnlocked, remainingSpecialtyUses, VEHICLE_MOD_IDS } from '../../src/game/journey';
import { FIELD_SITES, fieldReward } from '../../src/game/neighborhood';
import { cargoFor, contractPlan, departureReason, networkProof, productResource, RECIPES, reservedSpace, ROUTE_IDS, routeWear, vehicleCapacity } from '../../src/game/network';
import { assertInvariants, decodeSave, encodeSave } from '../../src/game/saves';
import type { Action, CommissionStage, FieldSite, GameState, ProductionMode, Resource, RouteId, VehicleMod } from '../../src/game/types';
import { preFreight } from '../legacy-shape';

const fixture = (v: string) => readFileSync(new URL(`../fixtures/v${v}-chapter.json`, import.meta.url), 'utf8');
function act(s: GameState, action: Action) { const result = applyAction(s, action); expect(result.error, JSON.stringify(action)).toBeNull(); assertInvariants(result.state); return result.state; }
function stock(s: GameState, r: Resource, n: number) {
  const delta = n - s.resources[r]; s.resources[r] = n;
  if (delta >= 0) { s.ledger.production[r] += delta; s.earned[r] += delta; } else s.ledger.operating[r] -= delta;
}
function funds(s: GameState) { stock(s, 'energy', 200000); stock(s, 'parts', 150000); stock(s, 'memory', 50000); stock(s, 'component', 16000); }
function base() {
  let s = decodeSave(fixture('0.3.2')).state;
  for (const id of ROUTE_IDS) { s.network.routes[id].contract.enabled = false; s.network.routes[id].autoRepair = false; }
  for (const id of activeDistricts(s)) for (const r of RESIDENTS) for (const j of JOBS) districtState(s, id)!.assignments[r][j] = 0;
  for (const id of activeDistricts(s)) districtState(s, id)!.autoRepair = false;
  s.assignments.shadow.power = 1;
  s = advance(s, 180000); s = activateNetworkRules(s, s.clock.lastAt);
  funds(s); s = act(s, { type: 'story', node: 'L01-1' }); return s;
}
function finish(s: GameState, mod: VehicleMod | RouteId) {
  funds(s); s.assignments.echo.repair = 1;
  const definition = mod === 'rain' || mod === 'station' ? `route:${mod}` as const : `vehiclemod:${mod}` as const;
  s = act(s, { type: 'enqueue', definition }); s = advance(s, 240000);
  expect(s.queue.some(p => p.definition === definition)).toBe(false); s.assignments.echo.repair = 0; assertInvariants(s); return s;
}
function ready(s: GameState, id: RouteId) { return s.network.routes[id].condition > 0 ? s : finish(s, id); }
function make(s: GameState, id: RouteId, mode: ProductionMode, n: number) {
  s = ready(s, id); funds(s);
  if (s.network.routes[id].node.mode !== mode) s = act(s, { type: 'production-mode', route: id, mode });
  s = act(s, { type: 'dispatch', route: id, direction: 'outbound', loads: { normal: n, specialty: 0 } });
  return advance(s, (s.network.routes[id].trip!.duration + n * 60) * 1000);
}
function importSpecialties(s: GameState, id: RouteId, n = 3) {
  s = make(s, id, 'specialty', n); s = ready(s, id);
  s = act(s, { type: 'dispatch', route: id, direction: 'inbound', loads: { normal: 0, specialty: n } });
  return advance(s, s.network.routes[id].trip!.duration * 1000);
}
function supplyBoth() { return importSpecialties(importSpecialties(base(), 'rain'), 'station'); }
function deliver(s: GameState, stage: CommissionStage) { return act(act(s, { type: 'commission-track', stage }), { type: 'commission-deliver', stage }); }
function visit(s: GameState, site: FieldSite, kind: 'first' | 'clue' | 'supply', choice?: 'a' | 'b') {
  s = act(s, { type: 'field-start', site, kind, district: 'district-0', resident: 'shadow' });
  s = advance(s, FIELD_SITES[site].seconds * 1000);
  const p = s.neighborhood.field.pending.find(p => p.site === site)!;
  return act(s, { type: 'field-claim', uid: p.uid, ...(choice ? { choice } : {}) });
}
function contract(s: GameState, id: RouteId, mode: ProductionMode, target: number, reserve = amounts(), buffer = 2) {
  const targets = amounts(); targets[productResource(id, mode)] = target;
  return act(s, { type: 'contract', route: id, enabled: true, loads: 1, reserve, targets, buffer, manifest: { normal: mode === 'normal' ? 2 : 0, specialty: mode === 'specialty' ? 3 : 0 }, order: [mode, mode === 'normal' ? 'specialty' : 'normal'] });
}
function oneCycleRainContract(buffer = 2) {
  let s = base(); s.completed = s.completed.filter(id => id !== 'P11'); delete s.events.E15;
  s = act(s, { type: 'dispatch', route: 'rain', direction: 'outbound', loads: 2 }); s = advance(s, 120000);
  s = act(s, { type: 'production-mode', route: 'rain', mode: 'specialty' });
  return act(s, { type: 'contract', route: 'rain', enabled: true, loads: 1, reserve: amounts(0, s.resources.parts), targets: amounts(0, 0, 0, 0, 2000), buffer, manifest: { normal: 0, specialty: 1 } });
}

describe('V0.3.3 recipes, whole packages and demand', () => {
  it.each(ROUTE_IDS.flatMap(id => (['normal', 'specialty'] as const).map(mode => [id, mode] as const)))('UX14: %s/%s produces exactly two explicit recipes and preserves all city ledgers', (id, mode) => {
    const before = base(), old = before.network.routes[id].node, s = make(before, id, mode, 2), node = s.network.routes[id].node, recipe = RECIPES[id][mode];
    for (const r of RESOURCES) { expect(node.produced[r] - old.produced[r]).toBe(recipe.product[r] * 2); expect(node.used[r] - old.used[r]).toBe(recipe.supply[r] * 2); }
    expect(node.batches[mode] - old.batches[mode]).toBe(2); assertInvariants(s);
    expect(capacities(s).rainFilm).toBe(12000 + activeDistricts(s).reduce((n, d) => n + districtState(s, d)!.facilities.warehouse * 4000, 0));
  });
  it('UX14/17: switching resets only the cycle and leaves supply and an existing freight snapshot intact', () => {
    let s = base(); s = act(s, { type: 'dispatch', route: 'rain', direction: 'outbound', loads: 2 }); s = advance(s, 30000);
    const before = structuredClone(s), after = act(s, { type: 'production-mode', route: 'rain', mode: 'specialty' });
    expect(after.network.routes.rain.node.cycle).toBe(0); expect(after.network.routes.rain.trip).toEqual(before.network.routes.rain.trip);
    expect(after.resources).toEqual(before.resources); expect(after.network.routes.rain.node.resources).toEqual(before.network.routes.rain.node.resources);
    s = advance(after, 150000); expect(s.network.routes.rain.node.produced.rainFilm).toBe(4000); expect(s.network.routes.rain.node.used.parts - before.network.routes.rain.node.used.parts).toBe(24000);
    expect(decodeSave(encodeSave(s, 0)).state).toEqual(s);
  });
  it('UX15/16: a mixed return takes available whole packages, snapshots the cargo and reserves its whole destination', () => {
    let s = make(make(base(), 'rain', 'normal', 2), 'rain', 'specialty', 2); const earned = { ...s.earned }, before = { ...s.resources };
    s = act(s, { type: 'dispatch', route: 'rain', direction: 'inbound', loads: { normal: 1, specialty: 2 } });
    expect(s.network.routes.rain.trip!.cargo).toEqual(amounts(0, 0, 12000, 0, 4000)); expect(reservedSpace(s, 'home')).toEqual(s.network.routes.rain.trip!.cargo);
    expect(s.resources.memory).toBe(before.memory); expect(s.earned).toEqual(earned);
    const blocked = applyAction(s, { type: 'dispatch', route: 'rain', direction: 'inbound', loads: { normal: 1, specialty: 1 } }); expect(blocked.state).toEqual(s);
    s = advance(s, 120000); expect(s.resources.memory).toBe(before.memory + 12000); expect(s.resources.rainFilm).toBe(before.rainFilm + 4000);
    expect(reservedSpace(s, 'home')).toEqual(amounts()); for (const r of ['memory', 'rainFilm'] as const) expect(s.earned[r]).toBe(earned[r]); assertInvariants(s);
  });
  it('UX15: targets stop supply at fulfillment and resume after an actual finite commission payment', () => {
    let s = act(base(), { type: 'production-mode', route: 'rain', mode: 'specialty' }); s = contract(s, 'rain', 'specialty', 4000);
    s = advance(s, 600000); expect(s.resources.rainFilm).toBeGreaterThanOrEqual(4000); const departures = s.network.routes.rain.departures;
    const idle = advance(s, 300000); expect(idle.network.routes.rain.departures).toBe(departures); expect(contractPlan(idle, 'rain', capacities(idle))).toEqual({ reason: '产物目标已满足，合同待命' });
    s = deliver(idle, 'CM05-1'); expect(s.resources.rainFilm).toBe(2000);
    s = advance(s, 1000); expect(s.network.routes.rain.trip).not.toBeNull(); s = advance(s, 600000);
    expect(s.resources.rainFilm).toBeGreaterThanOrEqual(4000); expect(s.network.routes.rain.departures).toBeGreaterThan(departures); assertInvariants(s);
  });
  it('UX15: package priority fills a partial vehicle without waiting for an unavailable second product', () => {
    let s = make(make(base(), 'station', 'normal', 2), 'station', 'specialty', 3);
    const targets = amounts(0, capacities(s).parts, 0, 0, 0, 20000);
    s = act(s, { type: 'contract', route: 'station', enabled: true, loads: 2, reserve: amounts(), targets, buffer: 2, manifest: { normal: 2, specialty: 3 }, order: ['normal', 'specialty'] });
    expect(contractPlan(s, 'station', capacities(s))).toEqual({ direction: 'inbound', manifest: { normal: 2, specialty: 3 } });
    s.network.routes.station.contract.targets.parts = s.resources.parts + 1;
    expect(contractPlan(s, 'station', capacities(s))).toEqual({ direction: 'inbound', manifest: { normal: 1, specialty: 3 } });
    s.network.routes.station.contract.targets.parts = 0;
    expect(contractPlan(s, 'station', capacities(s))).toEqual({ direction: 'inbound', manifest: { normal: 0, specialty: 3 } });
    s.network.routes.station.contract.manifest.specialty = 0;
    expect(contractPlan(s, 'station', capacities(s))).toEqual({ reason: '当前产物的取货包数为0，等待调整合同货单' });
  });
  it('UX15: retains all six reserves, includes departure energy and pauses without committing a new draft', () => {
    let s = act(base(), { type: 'production-mode', route: 'rain', mode: 'specialty' }); s.assignments.shadow.power = 0;
    const reserve = { ...s.resources, energy: s.resources.energy - 13999, parts: s.resources.parts - 12000 };
    s = contract(s, 'rain', 'specialty', 6000, reserve, 1); expect(advance(s, 1000).network.routes.rain.trip).toBeNull();
    reserve.energy -= 1000; s = contract(s, 'rain', 'specialty', 6000, reserve, 1); s = advance(s, 1000); expect(s.network.routes.rain.trip).not.toBeNull();
    const before = structuredClone(s); s = act(s, { type: 'contract-pause', route: 'rain' });
    expect(s.network.routes.rain.contract).toEqual({ ...before.network.routes.rain.contract, enabled: false }); expect(s.network.routes.rain.trip).toEqual(before.network.routes.rain.trip);
    for (const bad of [-1, 0.1, 33, NaN]) expect(applyAction(s, { type: 'dispatch', route: 'station', direction: 'inbound', loads: { normal: bad, specialty: 0 } }).state).toEqual(s);
  });
  it('UX15: shared-fleet priority determines which new target contract obtains the last vehicle', () => {
    let s = act(base(), { type: 'network-priority', order: ['rain', 'station'] }); s.completed = s.completed.filter(id => !['R06', 'P10', 'P11'].includes(id)); delete s.events.E14; delete s.events.E15;
    for (const id of ROUTE_IDS) s = contract(s, id, 'normal', capacities(s)[productResource(id, 'normal')]);
    const first = advance(s, 1000), reversed = advance(act(s, { type: 'network-priority', order: ['station', 'rain'] }), 1000);
    expect(first.network.routes.rain.trip).not.toBeNull(); expect(first.network.routes.station.trip).toBeNull();
    expect(reversed.network.routes.station.trip).not.toBeNull(); expect(reversed.network.routes.rain.trip).toBeNull();
  });
});

describe('V0.3.3 capacity, vehicles and chapter proof', () => {
  it('UX16: commission rewards and warehouse removal honor the space already held for a train', () => {
    let s = base();
    for (const node of ['L03-1', 'L03-2'] as const) s = act(s, { type: 'story', node });
    s = deliver(s, 'CM04-1'); s = visit(visit(s, 'F02', 'first', 'a'), 'F02', 'clue');
    s.assignments.echo.repair = 1; s = act(s, { type: 'enqueue', district: 'district-1', definition: 'build:warehouse' }); s = advance(s, 240000);
    expect(s.city.districts['district-1']!.facilities.warehouse).toBe(1);
    s = make(s, 'rain', 'normal', 2); s = act(s, { type: 'dispatch', route: 'rain', direction: 'inbound', loads: 2 });
    stock(s, 'memory', stockLimits(s).memory); s = act(s, { type: 'commission-track', stage: 'CM04-2' });
    expect(applyAction(s, { type: 'commission-deliver', stage: 'CM04-2' }).state).toEqual(s);
    expect(applyAction(s, { type: 'dismantle', district: 'district-1', facility: 'warehouse' }).error).toContain('在途预留');
    const bad = JSON.parse(encodeSave(s, 0)); bad.state.resources.memory++; bad.state.ledger.production.memory++; bad.state.earned.memory++;
    expect(() => decodeSave(JSON.stringify(bad))).toThrow();
    stock(s, 'memory', 20000); s = act(s, { type: 'commission-deliver', stage: 'CM04-2' });
    s = act(s, { type: 'dismantle', district: 'district-1', facility: 'warehouse' }); assertInvariants(s);
  });
  it('UX15: manifest order changes which indivisible package fits into the remaining vehicle space', () => {
    let s = make(make(make(base(), 'station', 'normal', 2), 'station', 'specialty', 3), 'station', 'specialty', 3);
    s.completed = s.completed.filter(id => !['R06', 'P10', 'P11'].includes(id)); delete s.events.E14; delete s.events.E15;
    const targets = amounts(0, 1000000, 0, 0, 0, 20000);
    s = act(s, { type: 'contract', route: 'station', enabled: true, loads: 1, reserve: amounts(), targets, manifest: { normal: 2, specialty: 5 }, order: ['normal', 'specialty'] });
    expect(contractPlan(s, 'station', capacities(s))).toEqual({ direction: 'inbound', manifest: { normal: 1, specialty: 4 } });
    s.network.routes.station.contract.order = ['specialty', 'normal'];
    expect(contractPlan(s, 'station', capacities(s))).toEqual({ direction: 'inbound', manifest: { normal: 0, specialty: 5 } });
  });
  it('UX16: a home reservation stops local production exactly and rejects a departure without a whole package slot', () => {
    let s = base(); s = act(s, { type: 'dispatch', route: 'station', direction: 'inbound', loads: 1 });
    const held = reservedSpace(s, 'home').parts; expect(held).toBe(32000); stock(s, 'parts', stockLimits(s).parts - 10);
    s.assignments.shadow.salvage = 1; const before = s.earned.parts; s = advance(s, 1000);
    expect(s.resources.parts).toBe(stockLimits(s).parts); expect(s.earned.parts - before).toBe(10);
    const stopped = advance(s, 1000); expect(stopped.earned.parts).toBe(s.earned.parts);
    s = advance(stopped, 180000); expect(s.network.routes.station.trip).toBeNull(); expect(s.resources.parts).toBe(capacities(s).parts);
    expect(departureReason(s, 'station', 'inbound', 1, capacities(s))).toContain('空间不足'); assertInvariants(s);
  });
  it('UX16: a new outbound reserves the city side and forged destination reservations cannot be imported', () => {
    let s = act(base(), { type: 'dispatch', route: 'rain', direction: 'outbound', loads: 2 });
    expect(reservedSpace(s, 'rain')).toEqual(cargoFor('rain', 'outbound', 2)); expect(reservedSpace(s, 'home')).toEqual(amounts());
    const raw = JSON.parse(encodeSave(s, 0)); raw.state.network.routes.rain.node.resources.parts = 160000;
    expect(() => decodeSave(JSON.stringify(raw))).toThrow();
    s = advance(s, 120000); expect(reservedSpace(s, 'rain')).toEqual(amounts()); assertInvariants(s);
  });
  it.each(VEHICLE_MOD_IDS.flatMap(mod => (['reliable', 'express'] as const).map(choice => [mod, choice] as const)))('UX17: %s combines with %s, stays opt-in and protects a paid departure snapshot', (mod, choice) => {
    let s = supplyBoth(); s.events.E12!.choice = choice; s = deliver(deliver(s, 'CM04-1'), 'CM06-1'); s = finish(s, mod);
    expect(s.network.vehicle.active).toBeNull(); s = act(s, { type: 'vehicle-mod', mod });
    expect(vehicleCapacity(s)).toBe(mod === 'freightRack' ? 100000 : 80000); expect(routeWear(s)).toBe(mod === 'railGuard' ? choice === 'reliable' ? 60 : 113 : choice === 'reliable' ? 80 : 150);
    s = ready(s, 'rain'); const condition = s.network.routes.rain.condition, operating = s.ledger.operating.energy;
    s = act(s, { type: 'dispatch', route: 'rain', direction: 'outbound', loads: { normal: 3, specialty: 0 } });
    const trip = structuredClone(s.network.routes.rain.trip!); expect(trip.fee).toBe(mod === 'freightRack' ? 6000 : 4000); expect(s.ledger.operating.energy - operating).toBe(trip.fee); expect(condition - s.network.routes.rain.condition).toBe(trip.wear);
    expect(trip.duration).toBe(choice === 'express' ? 96 : 120); expect(applyAction(s, { type: 'vehicle-mod', mod: null }).state).toEqual(s);
    s = act(s, { type: 'production-mode', route: 'rain', mode: 'normal' }); expect(s.network.routes.rain.trip).toEqual(trip);
    expect(decodeSave(encodeSave(s, 0)).state).toEqual(s);
    for (const mutate of [(v: any) => { v.wear = 75; }, (v: any) => { v.capacity = mod === 'freightRack' ? 80000 : 60000; }, (v: any) => { v.fee += 1; }]) { const raw = JSON.parse(encodeSave(s, 0)); mutate(raw.state.network.routes.rain.trip); expect(() => decodeSave(JSON.stringify(raw))).toThrow(); }
  });
  it('UX16/17: vehicle-project cancellation respects available specialty room and cannot increase earned totals', () => {
    let s = supplyBoth(); s = deliver(s, 'CM04-1'); s.assignments.echo.repair = 1;
    s = advance(act(s, { type: 'enqueue', definition: 'vehiclemod:freightRack' }), 1000);
    stock(s, 'railCore', stockLimits(s).railCore); const preview = refundPreview(s, s.queue[0]), earned = { ...s.earned };
    expect(preview.overflow.railCore, JSON.stringify(s.queue)).toBeGreaterThan(0); expect(preview.actual.railCore).toBe(0);
    s = act(s, { type: 'cancel', uid: s.queue[0].uid }); expect(s.earned).toEqual(earned); assertInvariants(s);
  });
  it('UX17: a buffered contract proves responsiveness only with a real whole home slot and affordable future departure', () => {
    let s = make(base(), 'rain', 'normal', 2); s.network.routes.rain.node.cycle = 0;
    s = contract(s, 'rain', 'normal', 1000000);
    expect(networkProof(s, capacities(s))).toBe(true);
    stock(s, 'memory', capacities(s).memory - 1000); expect(networkProof(s, capacities(s))).toBe(false);
    stock(s, 'memory', 20000); stock(s, 'energy', 0); expect(networkProof(s, capacities(s))).toBe(false);
    stock(s, 'energy', 50000); s.network.routes.rain.contract.enabled = false; expect(networkProof(s, capacities(s))).toBe(false);
    s.network.routes.rain.contract.enabled = true; s.network.routes.rain.contract.targets.memory = s.resources.memory; expect(networkProof(s, capacities(s))).toBe(true);
    s.completed = s.completed.filter(id => id !== 'P11'); delete s.events.E15; expect(unlockReason(s, 'P11')).toBeNull();
    s.network.routes.rain.contract.targets.memory = 0; expect(unlockReason(s, 'P11')).not.toBeNull();
  });
  it.each([1, 2, 8])('UX17: one production cycle proves P11 with buffer %i even when further supply is blocked', buffer => {
    let s = oneCycleRainContract(buffer);
    expect(s.network.routes.rain.node.resources.energy).toBe(RECIPES.rain.specialty.supply.energy);
    expect(contractPlan(s, 'rain', capacities(s))).not.toHaveProperty('direction');
    expect(departureReason(s, 'rain', 'outbound', 1, capacities(s), s.network.routes.rain.contract.reserve)).toBe('自动合同等待本城保留库存');
    expect(networkProof(s, capacities(s))).toBe(true); expect(unlockReason(s, 'P11')).toBeNull();
    expect(act(s, { type: 'enqueue', definition: 'P11' }).queue.some(p => p.definition === 'P11')).toBe(true);
    const before = structuredClone(s);
    s = advance(s, 60000); expect(s.network.routes.rain.trip).toMatchObject({ direction: 'inbound', cargo: { rainFilm: 2000 } });
    s = advance(s, 120000);
    expect(s.resources.rainFilm).toBe(2000); expect(s.ledger.imports.rainFilm - before.ledger.imports.rainFilm).toBe(2000);
    expect(s.earned.rainFilm).toBe(before.earned.rainFilm); expect(s.network.routes.rain.exports).toBe(before.network.routes.rain.exports);
    expect(s.network.routes.rain.trip).toBeNull(); expect(networkProof(s, capacities(s))).toBe(true);
    expect(decodeSave(encodeSave(s, 0)).state).toEqual(s); assertInvariants(s);
  });
  it('UX17: a partially supplied proof still requires current demand, pickup, a whole home slot, reserves, fee and enough ingredients', () => {
    const s = oneCycleRainContract();
    const blocked = (bad: GameState) => {
      assertInvariants(bad); expect(networkProof(bad, capacities(bad))).toBe(false); expect(unlockReason(bad, 'P11')).not.toBeNull();
      expect(applyAction(bad, { type: 'enqueue', definition: 'P11' }).state).toEqual(bad);
    };
    blocked(act(s, { type: 'contract', route: 'rain', enabled: true, loads: 1, reserve: s.network.routes.rain.contract.reserve, manifest: { normal: 1, specialty: 0 } }));
    blocked(act(s, { type: 'production-mode', route: 'rain', mode: 'normal' }));
    const crowded = structuredClone(s); stock(crowded, 'rainFilm', capacities(crowded).rainFilm - 1000);
    crowded.network.routes.rain.contract.targets.rainFilm = capacities(crowded).rainFilm; blocked(crowded);
    const poor = structuredClone(s); stock(poor, 'energy', 3999); blocked(poor);
    const reserved = structuredClone(s); reserved.network.routes.rain.contract.reserve.memory = reserved.resources.memory + 1; blocked(reserved);
    let exhausted = advance(act(s, { type: 'contract-pause', route: 'rain' }), 60000);
    exhausted = act(exhausted, { type: 'dispatch', route: 'rain', direction: 'inbound', loads: { normal: 0, specialty: 1 } });
    exhausted = advance(exhausted, 120000);
    blocked(contract(exhausted, 'rain', 'specialty', 4000, exhausted.network.routes.rain.contract.reserve));
  });
  it.each(['outbound', 'inbound'] as const)('UX17: an unrelated %s shipment cannot satisfy the current P11 contract', direction => {
    let s = direction === 'inbound' ? make(base(), 'rain', 'normal', 1) : base();
    s.completed = s.completed.filter(id => id !== 'P11'); delete s.events.E15;
    s = contract(s, 'rain', 'specialty', 6000);
    expect(networkProof(s, capacities(s))).toBe(false);
    s = act(s, { type: 'dispatch', route: 'rain', direction, loads: 1 });
    const blocked = () => {
      expect(networkProof(s, capacities(s))).toBe(false); expect(unlockReason(s, 'P11')).not.toBeNull();
      expect(applyAction(s, { type: 'enqueue', definition: 'P11' }).state).toEqual(s);
    };
    blocked();
    // A positive target alone cannot make a zero-package contract responsive.
    const reserve = s.network.routes.rain.contract.reserve;
    s = act(s, { type: 'contract', route: 'rain', enabled: true, loads: 1, reserve, targets: amounts(0, 0, 0, 0, 6000), manifest: { normal: 1, specialty: 0 } });
    blocked(); assertInvariants(s);
  });
  it.each(['outbound', 'inbound'] as const)('UX17: a relevant paid %s shipment remains proof when home energy falls', direction => {
    let s = direction === 'inbound' ? make(base(), 'rain', 'normal', 1) : base();
    s.completed = s.completed.filter(id => id !== 'P11'); delete s.events.E15;
    s = contract(s, 'rain', 'normal', s.resources.memory + 12000);
    s = act(s, { type: 'dispatch', route: 'rain', direction, loads: 1 });
    const trip = structuredClone(s.network.routes.rain.trip);
    stock(s, 'energy', 0);
    expect(networkProof(s, capacities(s))).toBe(true); expect(unlockReason(s, 'P11')).toBeNull();
    expect(s.network.routes.rain.trip).toEqual(trip); expect(decodeSave(encodeSave(s, 0)).state).toEqual(s);
  });
  it('UX17: an outbound proof follows the current recipe, package setting and actual whole-package space', () => {
    let s = contract(base(), 'rain', 'specialty', 6000);
    s = act(s, { type: 'dispatch', route: 'rain', direction: 'outbound', loads: 1 });
    expect(networkProof(s, capacities(s))).toBe(false);
    // The old normal supply can feed the newly selected specialty recipe.
    s = act(s, { type: 'production-mode', route: 'rain', mode: 'specialty' });
    expect(networkProof(s, capacities(s))).toBe(true);
    stock(s, 'rainFilm', capacities(s).rainFilm - 1000);
    s = contract(s, 'rain', 'specialty', capacities(s).rainFilm);
    expect(networkProof(s, capacities(s))).toBe(false);
    stock(s, 'rainFilm', 0);
    s = act(s, { type: 'contract', route: 'rain', enabled: true, loads: 1, reserve: amounts(), targets: amounts(0, 0, 0, 0, 6000), manifest: { normal: 1, specialty: 0 } });
    expect(networkProof(s, capacities(s))).toBe(false); assertInvariants(s);
  });
});

describe('V0.3.3 finite people, investigations and archives', () => {
  it.each((['F05', 'F06'] as const).flatMap(site => (['a', 'b'] as const).map(branch => [site, branch] as const)))('UX14: %s branch %s requires its actual import and extra payment, then supports an explicit ordinary revisit', (site, choice) => {
    const locked = base(); expect(applyAction(locked, { type: 'field-start', site, kind: 'first', district: 'district-0', resident: 'shadow' }).state).toEqual(locked);
    let s = supplyBoth(); s = act(s, { type: 'field-start', site, kind: 'first', district: 'district-0', resident: 'shadow' }); s = advance(s, FIELD_SITES[site].seconds * 1000);
    const p = s.neighborhood.field.pending[0], payment = fieldReward(p, choice).payment;
    for (const r of RESOURCES.filter(r => payment[r] > 0)) { const poor = structuredClone(s); stock(poor, r, 0); expect(applyAction(poor, { type: 'field-claim', uid: p.uid, choice }).state).toEqual(poor); }
    s = act(s, { type: 'field-claim', uid: p.uid, choice }); expect(s.neighborhood.field.sites[site].first).toBe(choice);
    if (site === 'F05' && choice === 'b') expect(archivesUnlocked(s)).toBe(true);
    const resource = site === 'F05' ? 'rainFilm' : 'railCore', before = s.resources[resource], consumed = s.neighborhood.field.consumed[resource];
    s = visit(s, site, 'supply'); expect(s.resources[resource]).toBe(before); expect(s.neighborhood.field.consumed[resource] - consumed).toBe(UNIT);
    expect(s.neighborhood.field.sites[site].supplies).toBe(1); expect(decodeSave(encodeSave(s, 0)).state).toEqual(s);
  });
  it('UX14/20: completes the nine responding stages, both finite clues, four L03 letters and all three readable archives exactly once', () => {
    let s = supplyBoth(); s = importSpecialties(importSpecialties(s, 'rain'), 'station');
    for (const node of ['L03-1', 'L03-2', 'L03-3'] as const) s = act(s, { type: 'story', node });
    s = deliver(s, 'CM04-1'); s = visit(visit(s, 'F02', 'first', 'b'), 'F02', 'clue'); s = deliver(deliver(s, 'CM04-2'), 'CM04-3');
    s = deliver(s, 'CM05-1'); s = visit(visit(s, 'F05', 'first', 'b'), 'F05', 'clue'); s = deliver(s, 'CM05-2');
    s = deliver(s, 'CM06-1'); s = visit(visit(s, 'F06', 'first', 'a'), 'F06', 'clue');
    for (const mod of VEHICLE_MOD_IDS) s = finish(s, mod);
    s = deliver(s, 'CM06-2'); expect(pendingStories(s)).toContain('L03-4'); s = act(s, { type: 'story', node: 'L03-4' }); s = deliver(s, 'CM06-3');
    funds(s); for (const id of LEGACY_ARCHIVE_IDS) { const before = { ...s.ledger.fulfillment }; s = act(s, { type: 'archive', id }); expect(s.ledger.fulfillment.memory).toBeGreaterThan(before.memory); expect(applyAction(s, { type: 'archive', id }).state).toEqual(s); }
    s = deliver(s, 'CM05-3'); expect(s.neighborhood.commissions.completed).toHaveLength(9); expect(remainingSpecialtyUses(s)).toEqual([]);
    expect(Object.keys(s.experience.story).filter(id => id.startsWith('L03'))).toHaveLength(4); expect(s.experience.archives).toEqual(LEGACY_ARCHIVE_IDS);
    expect(decodeSave(encodeSave(s, 0)).state).toEqual(s); assertInvariants(s);
  });
});

describe('V0.3.3 old offline bridge and save boundaries', () => {
  it('UX18/17: a genuinely valid old queued P11 keeps compatibility only for that queued item', () => {
    const raw = JSON.parse(fixture('0.3.2'));
    raw.state.completed = raw.state.completed.filter((id: string) => id !== 'P11'); delete raw.state.events.E15;
    raw.state.queue = [{ uid: 'q-999', definition: 'P11', district: 'district-0', targetLevel: 1, status: 'waiting', progress: 0, reserved: { energy: 0, parts: 0, memory: 0, component: 0 }, prefab: 0, legacyChapter: false }]; raw.state.nextProject = 1000;
    let s = activateNetworkRules(decodeSave(JSON.stringify(raw)).state, raw.state.clock.lastAt);
    expect(s.queue[0].legacyChapter).toBe(true);
    for (const id of ROUTE_IDS) s = act(s, { type: 'contract-pause', route: id });
    expect(unlockReason(s, 'P11')).not.toBeNull(); expect(unlockReason(s, 'P11', 'district-0', s.queue[0].legacyChapter)).toBeNull();
    const canceled = act(s, { type: 'cancel', uid: 'q-999' }); expect(applyAction(canceled, { type: 'enqueue', definition: 'P11' }).state).toEqual(canceled);
    funds(s); s = advance(s, 600000); expect(s.completed).toContain('P11'); expect(s.queue).toEqual([]); assertInvariants(s);
  });
  it.each(['0.1', '0.2', '0.3', '0.3.1', '0.3.2'])('UX18: genuine %s retains historical values, zero new cargo and an explicit rules boundary', version => {
    const raw = JSON.parse(fixture(version)), loaded = decodeSave(fixture(version));
    expect(loaded.state.network.legacyPending).toBe(true); expect(loaded.state.resources.rainFilm).toBe(0); expect(loaded.state.resources.railCore).toBe(0);
    expect(preFreight(loaded.state.resources)).toEqual({ ...raw.state.resources, component: raw.state.resources.component ?? 0 });
    const activated = activateNetworkRules(loaded.state, loaded.state.clock.lastAt + 5000);
    expect(activated.network.legacyPending).toBe(false); expect(activated.network.rulesSince).toBe(loaded.state.clock.lastAt + 5000);
    for (const id of ROUTE_IDS) { expect(activated.network.routes[id].trip).toEqual(loaded.state.network.routes[id].trip); if (activated.completed.includes(id === 'rain' ? 'P08' : 'P09')) expect(activated.network.routes[id].contract.targets[productResource(id, 'normal')]).toBe(capacities(activated)[productResource(id, 'normal')]); }
    expect(decodeSave(encodeSave(activated, activated.clock.lastAt)).state).toEqual(activated);
  });
  it('UX18: matches the released V0.3.2 engine for the complete old offline interval before activating targets', () => {
    const reference = JSON.parse(readFileSync(new URL('../fixtures/v0.3.2-offline-reference.json', import.meta.url), 'utf8'));
    const before = decodeSave(fixture('0.3.2')).state, after = advance(before, reference.elapsed); after.report = summarize(before, after, reference.elapsed);
    expect(preFreight(after)).toEqual(reference.state);
    const activated = activateNetworkRules(after, before.clock.lastAt + reference.elapsed); expect(activated.resources).toEqual(after.resources); expect(activated.ledger).toEqual(after.ledger);
  });
  it('UX18: rejects new fields, resources, sites, letters, archives and vehicle work disguised as schemas 1–5', () => {
    const mutations = [
      (s: any) => { s.resources.rainFilm = 0; }, (s: any) => { s.resources.railCore = 1; }, (s: any) => { s.experience = { ...s.experience, archives: [] }; },
      (s: any) => { s.network = { ...s.network, vehicle: { built: [], active: null } }; },
      (s: any) => { if (s.experience) s.experience.story['L03-1'] = {}; else s.experience = {}; },
      (s: any) => { s.queue.push({ uid: 'q-999', definition: 'vehiclemod:freightRack' }); }
    ];
    for (const version of ['0.1', '0.2', '0.3', '0.3.1', '0.3.2']) for (const mutate of mutations) { const raw = JSON.parse(fixture(version)); mutate(raw.state); expect(() => decodeSave(JSON.stringify(raw))).toThrow(); }
    const old = JSON.parse(fixture('0.3.2')); old.state.neighborhood.field.sites.F05 = { first: null, clue: false, supplies: 0 }; expect(() => decodeSave(JSON.stringify(old))).toThrow();
  });
  it.each([86400, 604800])('UX18/20: %i seconds of specialty contracts equal irregular segments and conserve both endpoints and held field supplies', async seconds => {
    await setImmediate(); let before = supplyBoth();
    before = contract(before, 'rain', 'specialty', 20000); before = contract(before, 'station', 'specialty', 20000);
    before = act(before, { type: 'field-start', site: 'F05', kind: 'first', district: 'district-0', resident: 'shadow' });
    before = advance(before, 1000); const whole = advance(before, seconds * 1000 + 517); await setImmediate();
    let split = before, rest = seconds * 1000 + 517;
    for (const ms of [119117, 22843, 17777, 2045555]) { split = advance(split, ms); rest -= ms; } split = advance(split, rest);
    expect(split).toEqual(whole); assertInvariants(whole); expect(whole.neighborhood.field.pending).toHaveLength(1);
    const report = summarize(before, whole, seconds * 1000 + 517); whole.report = report;
    expect(decodeSave(encodeSave(whole, 0)).state).toEqual(whole); for (const r of RESOURCES) expect(report.end[r]).toBe(report.start[r] + report.flows.production[r] + report.flows.rewards[r] + report.flows.refunds[r] + report.flows.imports[r] - report.flows.exports[r] - report.flows.operating[r] - report.flows.reserved[r] - report.flows.fulfillment[r] - report.flows.fieldReserved[r]);
  }, 60000);
});
