import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { amounts, JOBS, RESIDENTS, RESOURCES, UNIT } from '../../src/game/config';
import { activeDistricts, districtState, localBeds } from '../../src/game/city';
import { activateNetworkRules, advance, applyAction, freeResidents, refundPreview, summarize } from '../../src/game/engine';
import { assertInvariants, decodeSave, encodeSave } from '../../src/game/saves';
import { OUTPOST_INITIAL, outpostCapacities, outpostDefinition, outpostEnqueueReason, outpostLimits, outpostProjectReasons, outpostReservedSpace, outpostSealReason, outpostView, stationedWorkers, supportReason } from '../../src/game/outposts';
import type { Action, Amounts, DefinitionId, GameState, Job, Resident, Resource } from '../../src/game/types';
import type { OutpostId, OutpostProof, SupportKind } from '../../src/game/outpost-types';

const historical = readFileSync(new URL('../fixtures/v0.3.2-chapter.json', import.meta.url), 'utf8');
function act(s: GameState, action: Action): GameState {
  const result = applyAction(s, action);
  expect(result.error, JSON.stringify(action)).toBeNull();
  assertInvariants(result.state);
  return result.state;
}
function wait(s: GameState, seconds: number): GameState { const next = advance(s, seconds * UNIT); assertInvariants(next); return next; }
function clearHome(s: GameState) {
  for (const district of activeDistricts(s)) for (const resident of RESIDENTS) for (const job of JOBS) {
    while (districtState(s, district)!.assignments[resident][job]) s = act(s, { type: 'assign', district, resident, job, delta: -1 });
  }
  return s;
}
let cachedFoundation: GameState | undefined;
function foundation(): GameState {
  if (!cachedFoundation) {
    let s = activateNetworkRules(decodeSave(historical).state, 0);
    for (const route of ['rain', 'station'] as const) { s = act(s, { type: 'contract-pause', route }); s = act(s, { type: 'route-auto', route, enabled: false }); }
    for (const district of activeDistricts(s)) s = act(s, { type: 'auto-repair', district, enabled: false });
    for (const node of ['L01-1', 'L03-1', 'L03-2', 'L03-3', 'L03-4', 'L04-1'] as const) s = act(s, { type: 'story', node });
    s = act(s, { type: 'story', node: 'L01-2', choice: 'dismantle' });
    s = act(s, { type: 'enqueue', definition: 'P12' });
    s = wait(s, 2000);
    expect(s.completed).toContain('P12');
    s = act(s, { type: 'story', node: 'L04-2' });
    cachedFoundation = act(clearHome(s), { type: 'assign', district: 'district-0', resident: 'shadow', job: 'power', delta: 1 });
  }
  return structuredClone(cachedFoundation);
}
const crewFor = (resident: Resident) => [{ district: resident === 'shadow' ? 'district-1' as const : 'district-2' as const, resident }, { district: resident === 'shadow' ? 'district-1' as const : 'district-2' as const, resident }];
function open(id: OutpostId = 'O01', resident: Resident = 'shadow', from = foundation()) { return act(from, { type: 'outpost-open', outpost: id, crew: crewFor(resident) }); }
function rotate(s: GameState, resident: Resident, job: Job | null) {
  const id = s.outposts.active!;
  for (const type of RESIDENTS) for (const current of JOBS) while (s.outposts.sites[id]!.assignments[type][current]) s = act(s, { type: 'outpost-assign', resident: type, job: current, delta: -1 });
  s = act(s, { type: 'outpost-assign', resident, job: 'power', delta: 1 });
  if (job) s = act(s, { type: 'outpost-assign', resident, job, delta: 1 });
  return s;
}
function until(s: GameState, predicate: (s: GameState) => boolean, label: string, maxSeconds = 10000) {
  let seconds = 0;
  while (!predicate(s) && seconds < maxSeconds) { s = wait(s, 10); seconds += 10; }
  expect(predicate(s), `${label} after ${seconds}s`).toBe(true);
  return s;
}
function gather(s: GameState, resident: Resident, resource: 'energy' | 'parts' | 'memory', target: number) {
  const id = s.outposts.active!, job = resource === 'energy' ? null : resource === 'parts' ? 'salvage' : 'record';
  s = rotate(s, resident, job);
  return until(s, state => state.outposts.sites[id]!.resources[resource] >= target, `${id}:${resource} >= ${target}`);
}
function prepare(s: GameState, resident: Resident, payment: Amounts) {
  const id = s.outposts.active!;
  s = gather(s, resident, 'parts', outpostLimits(s, id).parts);
  s = gather(s, resident, 'memory', payment.memory);
  if (payment.component > s.outposts.sites[id]!.resources.component) {
    s = rotate(s, resident, 'assemble');
    s = act(s, { type: 'outpost-assembly', enabled: true, target: payment.component, reserve: amounts(10000, 10000) });
    s = until(s, state => state.outposts.sites[id]!.resources.component >= payment.component, 'components');
    s = act(s, { type: 'outpost-assembly', enabled: false, target: payment.component, reserve: amounts(10000, 10000) });
  }
  s = gather(s, resident, 'parts', payment.parts);
  return gather(s, resident, 'energy', Math.min(outpostLimits(s, id).energy, payment.energy + 1000));
}
function finish(s: GameState, resident: Resident, definition: DefinitionId, prefab = 0, proof?: OutpostProof) {
  const id = s.outposts.active!, def = outpostDefinition(s, id, definition, undefined, prefab);
  s = prepare(s, resident, def.cost);
  s = rotate(s, resident, 'repair');
  s = act(s, { type: 'outpost-enqueue', definition, prefab, ...(proof ? { proof } : {}) });
  const uid = s.queue.at(-1)!.uid;
  return until(s, state => !state.queue.some(p => p.uid === uid), `${id}:${definition} complete`);
}
function finishMap(s: GameState, resident: Resident, proof: OutpostProof = 'local', roofPrefab = 0) {
  const id = s.outposts.active!;
  s = finish(s, resident, `${id}-1`);
  s = finish(s, resident, `${id}-2`, id === 'O01' ? roofPrefab : 0, id === 'O02' ? proof : undefined);
  s = finish(s, resident, `${id}-3`);
  return act(s, { type: 'outpost-handoff', outpost: id });
}
function debitLocal(s: GameState, id: OutpostId, resource: Resource, value: number) {
  const d = s.outposts.sites[id]!, used = d.resources[resource] - value;
  expect(used).toBeGreaterThanOrEqual(0); d.resources[resource] = value; d.ledger.operating[resource] += used;
  assertInvariants(s);
}
function plan(s: GameState, queue: SupportKind[], enabled = true) { return act(s, { type: 'support-plan', enabled, queue, reserve: amounts() }); }

describe('V0.4 local economies and real two-person routes', () => {
  it.each(RESIDENTS)('B04/B06: %s pair completes both maps without additional support or cloned tools', resident => {
    const home = foundation(), before = { ...home.ledger.supportSent };
    let s = open('O01', resident, home);
    expect(s.outposts.sites.O01!.bench).toEqual({ built: [], active: null });
    s = finishMap(s, resident, 'local', 2);
    expect(s.outposts.sites.O01!.roofPrefab).toBe(2);
    expect(s.outposts.knowledge.manifest).toBe(true);
    const first = structuredClone(s.outposts.sites.O01);
    s = act(s, { type: 'outpost-seal', confirmClear: true });
    s = open('O02', resident, s); s = finishMap(s, resident);
    expect(s.outposts.sites.O02!.proof).toBe('local');
    expect(s.outposts.knowledge.lightFrame).toBe(true);
    expect(s.outposts.sites.O01!.resources).toEqual(first!.resources);
    expect(s.outposts.sites.O01!.sent).toEqual({ light: 0, materials: 0 });
    expect(s.outposts.sites.O02!.sent).toEqual({ light: 0, materials: 0 });
    for (const r of RESOURCES) expect(s.ledger.supportSent[r] - before[r]).toBe(OUTPOST_INITIAL[r] * 2);
    expect(applyAction(s, { type: 'outpost-handoff', outpost: 'O02' }).error).not.toBeNull();
    expect(decodeSave(encodeSave(s, s.clock.lastAt)).state).toEqual(s);
  }, 60000);
  it.each((['O01', 'O02'] as const).flatMap(id => RESIDENTS.map(resident => ({ id, resident }))))('B04: $id $resident pair recovers from all local resources exhausted and an unpowered repair assignment', ({ id, resident }) => {
    let s = open(id, resident);
    for (const r of RESOURCES) debitLocal(s, id, r, 0);
    s = act(s, { type: 'outpost-assign', resident, job: 'repair', delta: 1 });
    s = act(s, { type: 'outpost-assign', resident, job: 'repair', delta: 1 });
    s = act(s, { type: 'outpost-enqueue', definition: `${id}-1` });
    const stalled = wait(s, 30); expect(stalled.outposts.sites[id]!.resources).toEqual(amounts()); expect(stalled.queue[0].progress).toBe(0);
    s = act(stalled, { type: 'cancel', uid: stalled.queue[0].uid });
    s = finishMap(s, resident);
    expect(s.outposts.sites[id]!.sent).toEqual({ light: 0, materials: 0 });
    const requiredComponents = ([`${id}-1`, `${id}-2`, `${id}-3`] as const).reduce((total, definition) => total + outpostDefinition(s, id, definition).cost.component, 0);
    expect(s.outposts.sites[id]!.ledger.production.component).toBeGreaterThanOrEqual(requiredComponents);
  }, 60000);
  it('B02: first transfer is atomic, preserves home beds and can happen only once per map', () => {
    const base = foundation(), sources = crewFor('shadow');
    const insufficient = structuredClone(base); insufficient.outposts.support.reserve.energy = insufficient.resources.energy;
    const failed = applyAction(insufficient, { type: 'outpost-open', outpost: 'O01', crew: sources });
    expect(failed.error).toContain('保留'); expect(failed.state).toEqual(insufficient);
    let s = open('O01', 'shadow', base);
    expect(s.outposts.sites.O01!.resources).toEqual(OUTPOST_INITIAL);
    expect(s.outposts.sites.O01!.earned).toEqual(amounts());
    expect(s.city.districts['district-1']!.population).toEqual(base.city.districts['district-1']!.population);
    expect(stationedWorkers(s, 'district-1', 'shadow')).toBe(2);
    expect(freeResidents(s, 'shadow', 'district-1')).toBe(freeResidents(base, 'shadow', 'district-1') - 2);
    expect(applyAction(s, { type: 'outpost-open', outpost: 'O02', crew: sources }).error).toContain('封存');
    s = rotate(s, 'shadow', 'salvage'); s = wait(s, 100);
    s = act(s, { type: 'outpost-seal', confirmClear: true });
    const frozen = structuredClone(s.outposts.sites.O01), sent = { ...s.ledger.supportSent };
    s = wait(s, 1000); expect(s.outposts.sites.O01).toEqual(frozen);
    s = open('O01', 'echo', s);
    expect(s.ledger.supportSent).toEqual(sent); expect(s.outposts.sites.O01!.resources).toEqual(frozen!.resources);
    expect(s.outposts.sites.O01!.assignments.shadow.salvage).toBe(0);
  });
  it('B03: reinforcement needs a dorm, shares real home occupancy, and can recall only idle staff down to two', () => {
    let s = open();
    expect(applyAction(s, { type: 'outpost-reinforce', district: 'district-2', resident: 'echo' }).error).toContain('宿舍');
    s = finish(s, 'shadow', 'build:dorm');
    s = act(s, { type: 'outpost-reinforce', district: 'district-2', resident: 'echo' });
    s = act(s, { type: 'outpost-reinforce', district: 'district-2', resident: 'echo' });
    expect(s.outposts.crew).toHaveLength(4);
    expect(applyAction(s, { type: 'outpost-reinforce', district: 'district-2', resident: 'echo' }).error).toContain('住处');
    s = act(s, { type: 'outpost-assign', resident: 'echo', job: 'record', delta: 1 });
    s = act(s, { type: 'outpost-assign', resident: 'echo', job: 'record', delta: 1 });
    const uid = s.outposts.crew.find(p => p.resident === 'echo')!.uid;
    expect(applyAction(s, { type: 'outpost-recall', uid }).error).toContain('岗位');
    s = act(s, { type: 'outpost-assign', resident: 'echo', job: 'record', delta: -1 });
    s = act(s, { type: 'outpost-recall', uid });
    s = act(s, { type: 'outpost-assign', resident: 'echo', job: 'record', delta: -1 });
    s = act(s, { type: 'outpost-recall', uid: s.outposts.crew.find(p => p.resident === 'echo')!.uid });
    expect(applyAction(s, { type: 'outpost-recall', uid: s.outposts.crew[0].uid }).error).toContain('两名');
  });
  it('B04/B08: ordinary assembly is local even without the optional home paper, and a lamp only halves lighting', () => {
    let s = open('O02');
    // The ability is granted by P12, not a copied home assembly configuration.
    delete s.experience.story['L01-1']; delete s.experience.story['L01-2']; s.experience.blueprints = [];
    s = applyAction(s, { type: 'outpost-assign', resident: 'shadow', job: 'power', delta: 1 }).state;
    s = applyAction(s, { type: 'outpost-assign', resident: 'shadow', job: 'assemble', delta: 1 }).state;
    s = applyAction(s, { type: 'outpost-assembly', enabled: true, target: 25, reserve: amounts() }).state;
    const before = structuredClone(s.outposts.sites.O02!); s = advance(s, 2000);
    expect(s.outposts.sites.O02!.resources.component).toBe(25);
    expect(s.outposts.sites.O02!.ledger.operating.parts - before.ledger.operating.parts).toBe(200);
    expect(s.outposts.sites.O02!.ledger.operating.energy - before.ledger.operating.energy).toBe(200);
    expect(s.experience.assembly.enabled).toBe(false);
    const lit = structuredClone(s); lit.outposts.sites.O02!.lightFrame = true;
    const ordinary = outpostView(s, 'O02'), frame = outpostView(lit, 'O02');
    expect(frame.production).toEqual(ordinary.production); expect(ordinary.operating.energy - frame.operating.energy).toBe(25);
  });
  it('B04: same-second refill charges cumulative actual output rather than rounding its two passes separately', () => {
    let s = open(); s = gather(s, 'shadow', 'parts', outpostCapacities(s, 'O01').parts);
    debitLocal(s, 'O01', 'parts', outpostCapacities(s, 'O01').parts - 20);
    s = act(s, { type: 'outpost-assign', resident: 'shadow', job: 'power', delta: -1 });
    s = act(s, { type: 'outpost-assign', resident: 'shadow', job: 'record', delta: 1 });
    const before = structuredClone(s.outposts.sites.O01!); s = wait(s, 1);
    const after = s.outposts.sites.O01!;
    expect(after.resources.parts).toBe(outpostCapacities(s, 'O01').parts);
    expect(after.ledger.production.parts - before.ledger.production.parts).toBe(50); // 20 headroom and 30 used by recording.
    expect(after.ledger.operating.energy - before.ledger.operating.energy).toBe(121); // Lighting 50 + recorder 50 + ceil(100 * 50 / 240).
    expect(after.ledger.operating.parts - before.ledger.operating.parts).toBe(30);
    expect(after.ledger.production.memory - before.ledger.production.memory).toBe(60);
    expect(decodeSave(encodeSave(s, s.clock.lastAt)).state).toEqual(s);
  });
  it('B06/B08: completing the court first permits real lamp construction in the alley without copying the equipment', () => {
    let s = finishMap(open('O02'), 'shadow');
    expect(s.outposts.knowledge.lightFrame).toBe(true); expect(s.outposts.sites.O02!.lightFrame).toBe(false);
    s = act(s, { type: 'outpost-seal', confirmClear: true }); s = open('O01', 'shadow', s);
    expect(s.outposts.sites.O01!.lightFrame).toBe(false);
    s = finish(s, 'shadow', 'lightFrame');
    expect(s.outposts.sites.O01!.lightFrame).toBe(true); expect(s.completed).toContain('O01@lightFrame');
    expect(s.outposts.sites.O02!.lightFrame).toBe(false);
    expect(outpostEnqueueReason(s, 'O01', 'lightFrame')).toContain('已经');
    s = rotate(s, 'shadow', null);
    debitLocal(s, 'O01', 'energy', 40000); // Leave headroom so the generation assertion measures the recipe, not capacity refill.
    const before = structuredClone(s.outposts.sites.O01!); s = wait(s, 1);
    expect(s.outposts.sites.O01!.ledger.operating.energy - before.ledger.operating.energy).toBe(25);
    expect(s.outposts.sites.O01!.ledger.production.energy - before.ledger.production.energy).toBe(500);
    expect(outpostCapacities(s, 'O01')).toEqual(amounts(80000, 80000, 24000, 6000));
    expect(applyAction(s, { type: 'outpost-handoff', outpost: '__proto__' as OutpostId }).error).toContain('未知');
  });
});

describe('V0.4 support reservations and scoped work', () => {
  it('B08: the alley handoff enables a finite three-package plan in the court and does not refill it', () => {
    let s = open();
    expect(applyAction(s, { type: 'support-plan', enabled: true, queue: ['materials', 'light', 'materials'], reserve: amounts() }).error).toContain('有效');
    s = finishMap(s, 'shadow');
    expect(s.outposts.knowledge.manifest).toBe(true); expect(s.outposts.support.enabled).toBe(false);
    s = act(s, { type: 'outpost-seal', confirmClear: true }); s = open('O02', 'shadow', s);
    expect(s.outposts.support.enabled).toBe(false); expect(s.outposts.support.queue).toEqual([]);
    const before = { ...s.ledger.supportSent };
    s = plan(s, ['materials', 'light', 'materials']); s = wait(s, 181);
    expect(s.outposts.sites.O02!.sent).toEqual({ light: 1, materials: 2 });
    expect(s.outposts.support.trip).toBeNull(); expect(s.outposts.support.queue).toEqual([]);
    expect(s.outposts.sites.O02!.ledger.supportReceived).toEqual(amounts(80000, 60000, 16000));
    expect(s.ledger.supportSent.energy - before.energy).toBe(60000);
    expect(s.ledger.supportSent.parts - before.parts).toBe(40000);
    expect(s.ledger.supportSent.memory - before.memory).toBe(8000);
    const sequence = s.outposts.nextTrip, received = { ...s.outposts.sites.O02!.ledger.supportReceived };
    s = wait(s, 300);
    expect(s.outposts.nextTrip).toBe(sequence); expect(s.outposts.sites.O02!.ledger.supportReceived).toEqual(received);
    expect(supportReason(s)).toContain('不会自动续填');
  });
  it('B07: reserves a whole package, protects its space and uses arrival inputs only on the next second', () => {
    let s = open('O01');
    s = plan(s, ['light']); const home = structuredClone(s);
    s = wait(s, 1);
    expect(s.ledger.supportSent.energy - home.ledger.supportSent.energy).toBe(40000);
    expect(s.outposts.support.trip!.remaining).toBe(60);
    expect(outpostReservedSpace(s, 'O01').energy).toBe(40000); expect(outpostLimits(s, 'O01').energy).toBe(40000);
    const sent = s.ledger.supportSent.energy;
    s = act(s, { type: 'support-pause' }); s = wait(s, 59);
    debitLocal(s, 'O01', 'energy', 0);
    s = act(s, { type: 'outpost-assign', resident: 'shadow', job: 'salvage', delta: 1 });
    const before = s.outposts.sites.O01!.resources.parts;
    expect(outpostView(s, 'O01').net.energy).toBe(40000);
    s = wait(s, 1); expect(s.outposts.sites.O01!.resources.energy).toBe(40000); expect(s.outposts.sites.O01!.resources.parts).toBe(before);
    s = wait(s, 1); expect(s.outposts.sites.O01!.resources.parts).toBe(before + 240);
    expect(s.ledger.supportSent.energy).toBe(sent); expect(s.outposts.support.trip).toBeNull();
    expect(s.outposts.sites.O01!.earned.energy).toBe(0);
  });
  it('B07: a full destination or reserve failure never charges the cargo or fee', () => {
    let s = open('O01'); s = gather(s, 'shadow', 'energy', outpostCapacities(s, 'O01').energy);
    s = plan(s, ['light']); expect(supportReason(s)).toContain('空间');
    const before = structuredClone(s.ledger); s = wait(s, 1);
    expect(s.ledger.supportSent).toEqual(before.supportSent); expect(s.outposts.support.trip).toBeNull();
    s = plan(s, []); s = act(s, { type: 'support-plan', enabled: true, queue: ['materials'], reserve: { ...s.resources } });
    expect(supportReason(s)).toContain('保留'); const held = { ...s.ledger.supportSent }; s = wait(s, 1); expect(s.ledger.supportSent).toEqual(held);
  });
  it('B07/B02: four sent packages count once across arrivals, save/reopen and sealing; the fifth stays unpaid', () => {
    let s = open('O02');
    for (let i = 0; i < 4; i++) {
      debitLocal(s, 'O02', 'energy', 0); s = plan(s, ['light']); s = wait(s, 1);
      expect(s.outposts.sites.O02!.sent.light).toBe(i + 1);
      expect(outpostSealReason(s)).toContain('在途');
      s = decodeSave(encodeSave(s, s.clock.lastAt)).state; s = wait(s, 60);
      expect(s.outposts.support.trip).toBeNull();
    }
    const sent = { ...s.ledger.supportSent }, count = s.outposts.nextTrip;
    s = plan(s, ['materials']); expect(supportReason(s)).toContain('4次'); s = wait(s, 100);
    expect(s.ledger.supportSent).toEqual(sent); expect(s.outposts.nextTrip).toBe(count);
    expect(applyAction(s, { type: 'outpost-seal', confirmClear: false }).error).toContain('确认');
    s = act(s, { type: 'outpost-seal', confirmClear: true }); s = open('O02', 'shadow', s);
    expect(s.outposts.sites.O02!.sent.light).toBe(4); expect(s.ledger.supportSent).toEqual(sent);
    s = plan(s, ['light']); expect(supportReason(s)).toContain('4次');
  });
  it('B06: relay proof counts received additional power, not the initial package, queue or in-transit cargo', () => {
    let s = open('O02'); s = finish(s, 'shadow', 'O02-1');
    s = prepare(s, 'shadow', outpostDefinition(s, 'O02', 'O02-2').cost);
    s = rotate(s, 'shadow', 'repair');
    s = act(s, { type: 'outpost-enqueue', definition: 'O02-2', proof: 'relay' });
    expect(outpostProjectReasons(s, s.queue[0]).join()).toContain('80');
    for (let i = 0; i < 2; i++) {
      debitLocal(s, 'O02', 'energy', 0); s = plan(s, ['light']); s = wait(s, 1);
      expect(s.queue[0].status).toBe('waiting'); s = wait(s, 60);
      if (!i) expect(s.queue[0].status).toBe('waiting');
    }
    s = wait(s, 1); expect(s.queue[0].status).toBe('running');
    s = until(s, state => state.queue.length === 0, 'relay project');
    expect(s.outposts.sites.O02!.proof).toBe('relay');
  });
  it('B05: only the fixed global head works, and cancelling refunds the correct local ledger', () => {
    let s = open(); s = prepare(s, 'shadow', outpostDefinition(s, 'O01', 'O01-1').cost); s = rotate(s, 'shadow', 'repair');
    s = act(s, { type: 'enqueue', definition: 'build:generator' });
    s = act(s, { type: 'outpost-enqueue', definition: 'O01-1' });
    const op = s.outposts.sites.O01!.ledger.operating.energy; s = wait(s, 10);
    expect(s.queue[0].progress).toBe(0); expect(s.queue[1].progress).toBe(0);
    expect(s.outposts.sites.O01!.ledger.operating.energy - op).toBe(500);
    s = act(s, { type: 'assign', resident: 'echo', district: 'district-0', job: 'repair', delta: 1 });
    s = act(s, { type: 'assign', resident: 'shadow', district: 'district-0', job: 'power', delta: 1 });
    s = until(s, state => state.queue[0].outpost === 'O01', 'home head finished');
    // Exact completion boundary is covered separately from this batched wait.
    s = wait(s, 1); s = act(s, { type: 'pause', uid: s.queue[0].uid });
    const before = structuredClone(s), refund = refundPreview(s, s.queue[0]);
    s = act(s, { type: 'cancel', uid: s.queue[0].uid });
    expect(s.resources).toEqual(before.resources); expect(s.ledger.refunds).toEqual(before.ledger.refunds);
    for (const r of RESOURCES) expect(s.outposts.sites.O01!.resources[r] - before.outposts.sites.O01!.resources[r]).toBe(refund.actual[r]);
    expect(s.outposts.sites.O01!.earned).toEqual(before.outposts.sites.O01!.earned);
    const report = summarize(before, s, 0); expect(report.outposts![0].flows.refunds).toEqual(refund.actual);
  });
  it('B05: shared workbench slots and map-specific definitions reject cross-map, over-level and unsupported work', () => {
    let s = open();
    expect(outpostEnqueueReason(s, 'O01', 'O02-1')).toContain('另一张');
    expect(outpostEnqueueReason(s, 'O01', 'build:warehouse')).toContain('不能');
    expect(outpostEnqueueReason(s, 'O01', 'public:relay')).toContain('不能');
    expect(applyAction(s, { type: 'outpost-enqueue', definition: 'O01-1', prefab: 2 }).error).toContain('上限');
    s = finish(s, 'shadow', 'build:dorm');
    s = act(s, { type: 'outpost-reinforce', district: 'district-2', resident: 'echo' });
    s = act(s, { type: 'outpost-assign', resident: 'echo', job: 'assemble', delta: 1 });
    expect(applyAction(s, { type: 'outpost-assign', resident: 'echo', job: 'repair', delta: 1 }).error).toContain('空闲');
    s = act(s, { type: 'outpost-reinforce', district: 'district-2', resident: 'echo' });
    expect(applyAction(s, { type: 'outpost-assign', resident: 'echo', job: 'repair', delta: 1 }).error).toContain('共享');
    expect(applyAction(s, { type: 'outpost-seal', confirmClear: true }).error).toBeNull();
  });
});

describe('V0.4 source-district and local-tool acceptance boundaries', () => {
  it('B02: actual inventory and crew shortages leave opening entirely unchanged', () => {
    let empty = clearHome(foundation());
    empty = act(empty, { type: 'support-plan', enabled: false, queue: [], reserve: amounts() });
    empty = until(empty, state => state.resources.energy < OUTPOST_INITIAL.energy, 'home lighting spends the initial-transfer energy');
    const missingStock = applyAction(empty, { type: 'outpost-open', outpost: 'O01', crew: crewFor('shadow') });
    expect(missingStock.error).toContain('不足'); expect(missingStock.state).toEqual(empty);
    expect(missingStock.state.outposts.sites).toEqual({}); expect(missingStock.state.outposts.crew).toEqual([]);

    const available = foundation();
    expect(freeResidents(available, 'shadow', 'district-0')).toBe(1); // The other two are on power and a real night-network posting.
    const missingCrew = applyAction(available, { type: 'outpost-open', outpost: 'O01', crew: [{ district: 'district-0', resident: 'shadow' }, { district: 'district-0', resident: 'shadow' }] });
    expect(missingCrew.error).toContain('空闲'); expect(missingCrew.state).toEqual(available);
    expect(missingCrew.state.outposts.nextCrew).toBe(available.outposts.nextCrew);
    expect(missingCrew.state.ledger.supportSent).toEqual(available.ledger.supportSent);
  });

  it('B03: real district-0 residents occupy their original beds and return idle after sealing', () => {
    const before = foundation(), originalBeds = localBeds(districtState(before, 'district-0')!, 'district-0');
    let s = act(before, { type: 'outpost-open', outpost: 'O01', crew: [{ district: 'district-0', resident: 'shadow' }, { district: 'district-0', resident: 'echo' }] });
    for (const resident of RESIDENTS) {
      expect(stationedWorkers(s, 'district-0', resident)).toBe(1);
      expect(freeResidents(s, resident, 'district-0')).toBe(freeResidents(before, resident, 'district-0') - 1);
    }
    s = act(s, { type: 'outpost-assign', resident: 'shadow', job: 'power', delta: 1 });
    s = act(s, { type: 'outpost-assign', resident: 'echo', job: 'record', delta: 1 });
    const duplicate = applyAction(s, { type: 'assign', district: 'district-0', resident: 'shadow', job: 'salvage', delta: 1 });
    expect(duplicate.error).toContain('空闲'); expect(duplicate.state).toEqual(s);
    s = wait(s, 130);
    expect(s.population).toEqual(before.population); expect(s.arrivals).toBe(before.arrivals);
    expect(localBeds(districtState(s, 'district-0')!, 'district-0')).toBe(originalBeds);
    s = act(s, { type: 'outpost-seal', confirmClear: true });
    expect(s.outposts.crew).toEqual([]); expect(s.assignments).toEqual(before.assignments);
    for (const resident of RESIDENTS) expect(freeResidents(s, resident, 'district-0')).toBe(freeResidents(before, resident, 'district-0'));
    expect(s.population).toEqual(before.population);
    expect(localBeds(districtState(s, 'district-0')!, 'district-0')).toBe(originalBeds);
    expect(decodeSave(encodeSave(s, s.clock.lastAt)).state).toEqual(s);
  });

  it('B04: both known tools are built and activated locally with their actual recipes and no home ledger leakage', () => {
    let s = foundation(); // L01's real dismantling branch provided the quick-jig blueprint.
    s = act(s, { type: 'assign', district: 'district-0', resident: 'shadow', job: 'assemble', delta: 1 });
    s = act(s, { type: 'assembly-plan', enabled: true, target: 2000, reserve: amounts() });
    s = until(s, state => state.resources.component >= 2000, 'home components for a real existing tool');
    s = act(s, { type: 'assembly-plan', enabled: false, target: 2000, reserve: amounts() });
    s = act(s, { type: 'assign', district: 'district-0', resident: 'shadow', job: 'assemble', delta: -1 });
    s = act(s, { type: 'assign', district: 'district-0', resident: 'echo', job: 'repair', delta: 1 });
    s = act(s, { type: 'enqueue', definition: 'blueprint:thriftBench' });
    s = act(s, { type: 'enqueue', definition: 'mod:quickJig' });
    s = until(s, state => state.queue.length === 0, 'formal blueprint learning and home tool construction');
    s = act(s, { type: 'assembly-mod', district: 'district-0', mod: 'quickJig' });
    s = act(s, { type: 'assign', district: 'district-0', resident: 'echo', job: 'repair', delta: -1 });
    expect(s.experience.blueprints).toEqual(expect.arrayContaining(['quickJig', 'thriftBench']));
    s = open('O01', 'shadow', s);
    const homeControl = structuredClone(s), homeTools = structuredClone(s.experience.benches);
    expect(s.outposts.sites.O01!.bench).toEqual({ built: [], active: null });

    for (const mod of ['quickJig', 'thriftBench'] as const) {
      expect(applyAction(s, { type: 'outpost-mod', mod }).error).toContain('制作');
      const reserved = { ...s.outposts.sites.O01!.ledger.reserved };
      s = finish(s, 'shadow', `mod:${mod}`);
      const site = s.outposts.sites.O01!;
      for (const r of RESOURCES) expect(site.ledger.reserved[r] - reserved[r]).toBe(amounts(10000, 8000, 4000, 2000)[r]);
      expect(site.bench.built).toContain(mod); expect(site.bench.active).toBeNull();
      expect(s.completed).toContain(`O01@mod:${mod}`);
      expect(outpostEnqueueReason(s, 'O01', `mod:${mod}`)).toContain('已经');
    }
    expect(s.outposts.sites.O01!.bench.built).toEqual(['quickJig', 'thriftBench']);
    s = rotate(s, 'shadow', 'assemble');
    s = act(s, { type: 'outpost-assembly', enabled: true, target: 1000, reserve: amounts() });
    for (const [mod, output, parts, energy] of [['quickJig', 30, 360, 180], ['thriftBench', 15, 90, 45], [null, 20, 160, 80]] as const) {
      s = act(s, { type: 'outpost-mod', mod });
      const before = structuredClone(s.outposts.sites.O01!); s = wait(s, 1);
      const site = s.outposts.sites.O01!;
      expect(site.bench.active).toBe(mod);
      expect(site.resources.component - before.resources.component).toBe(output);
      expect(site.ledger.operating.parts - before.ledger.operating.parts).toBe(parts);
      expect(site.ledger.operating.energy - before.ledger.operating.energy).toBe(energy + 50); // Local steady lighting, no other consuming job.
    }
    const elapsed = s.clock.seconds - homeControl.clock.seconds, untouchedHome = wait(homeControl, elapsed);
    expect(s.experience.benches).toEqual(homeTools);
    expect(s.resources).toEqual(untouchedHome.resources); expect(s.ledger).toEqual(untouchedHome.ledger);
    expect(decodeSave(encodeSave(s, s.clock.lastAt)).state).toEqual(s);
  });
});
