import { preExpansion, preOutposts } from '../legacy-shape';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { RESOURCES } from '../../src/game/config';
import { activeDistricts, CITY_RULES, cityCount, districtState, localFree, scopedKey } from '../../src/game/city';
import { advance, applyAction, capacities, completionName, definitionFor, enqueueReason, refundPreview, servicePreview, summarize, view } from '../../src/game/engine';
import { assertInvariants, decodeSave, encodeSave } from '../../src/game/saves';
import type { Action, DefinitionId, DistrictId, Facility, GameState } from '../../src/game/types';

const oldText = readFileSync(new URL('../fixtures/v0.1-chapter.json', import.meta.url), 'utf8');
const old = () => decodeSave(oldText).state;
function act(s: GameState, action: Action) {
  const result = applyAction(s, action); expect(result.error).toBeNull(); assertInvariants(result.state); return result.state;
}
function stock(s: GameState, resource: keyof GameState['resources'], value: number) {
  const difference = value - s.resources[resource];
  if (difference >= 0) { s.ledger.production[resource] += difference; s.earned[resource] += difference; }
  else s.ledger.operating[resource] -= difference;
  s.resources[resource] = value;
}
function fill(s: GameState) { const cap = capacities(s); for (const r of RESOURCES) if (r !== 'component') stock(s, r, cap[r]); }
function finish(state: GameState, definition: DefinitionId, district: DistrictId = 'district-0') {
  let s = structuredClone(state); fill(s); s = act(s, { type: 'enqueue', definition, district });
  const uid = s.queue.at(-1)!.uid;
  for (let i = 0; s.queue.some(p => p.uid === uid) && i < 4000; i++) s = advance(s, 1000);
  expect(s.queue.some(p => p.uid === uid)).toBe(false); assertInvariants(s); return s;
}
function expanded() { return finish(finish(old(), 'P04'), 'P05'); }
function fixtureFacility(s: GameState, district: DistrictId, facility: Facility, level: number) {
  const d = districtState(s, district)!;
  for (let l = d.facilities[facility] + 1; l <= level; l++) s.completed.push(scopedKey(`build:${facility}:${l}`, district));
  d.facilities[facility] = level;
}
function specialized() {
  let s = expanded();
  fixtureFacility(s, 'district-1', 'dorm', 2); fixtureFacility(s, 'district-1', 'recycler', 2);
  fixtureFacility(s, 'district-2', 'dorm', 2); fixtureFacility(s, 'district-2', 'mailbox', 2);
  const salvage = districtState(s, 'district-1')!, record = districtState(s, 'district-2')!;
  salvage.population.shadow = 2; record.population.echo = 2; s.arrivals = 6;
  salvage.assignments.shadow.salvage = 2; salvage.lighting = 'dim';
  record.assignments.echo.record = 2; record.lighting = 'bright'; fill(s);
  s = act(s, { type: 'event', event: 'E07', choice: 'individual' }); return s;
}
function equipment() {
  let s = finish(finish(old(), 'public:relay'), 'R04');
  s.publicWorks.relay.condition = CITY_RULES.repairThreshold; fill(s); return s;
}

describe('V0.2 migration and address network', () => {
  it('C01/FR-11: rejects unknown report completions and displays them safely', () => {
    for (const key of ['district-9/build:dorm:1', 'public:unknown', 'district-1/public:unknown', 'district-1/P04', 'district-1/build:dorm:4', 'district-1/build:dorm:1/extra']) {
      const raw = JSON.parse(encodeSave(old(), 0)); raw.state.report.completed = [key];
      expect(() => decodeSave(JSON.stringify(raw))).toThrow('报告完工记录');
      const state = old(); state.report!.completed = [key];
      expect(() => encodeSave(state, 0)).toThrow('报告完工记录');
      expect(completionName(key)).toBe(key);
    }
  });
  it('C01/FR-11: validates legacy report completions before migration', () => {
    for (const key of ['district-9/build:dorm:1', 'public:unknown', 'district-1/build:dorm:1', 'P04']) {
      const raw = JSON.parse(oldText); raw.state.report.completed = [key];
      expect(() => decodeSave(JSON.stringify(raw))).toThrow('报告完工记录');
    }
  });
  it.each([
    ['build:generator', 'generator', 'district-1/build:generator:1', '旧巷 · 手摇发电机 · 1级'],
    ['public:relay', 'relay', 'district-1/public:relay', '旧巷 · 建设配电亭']
  ] as const)('C01/03: retains report completions after a branch %s is dismantled', (definition, facility, key, name) => {
    const before = expanded();
    let s = finish(before, definition, 'district-1');
    s.report = summarize(before, s, 100000);
    expect(s.report.completed).toContain(key);
    s = act(s, { type: 'dismantle', district: 'district-1', facility });
    const restored = decodeSave(encodeSave(s, 0)).state;
    expect(restored.completed).not.toContain(key);
    expect(restored.report!.completed).toContain(key);
    expect(completionName(restored.report!.completed[0])).toBe(name);
  });
  it('C01: migrates a genuine V0.1 browser save without changing original progress', () => {
    const raw = JSON.parse(oldText), migrated = decodeSave(oldText);
    expect(migrated.migratedFrom).toBe(1); expect(migrated.schemaVersion).toBe(10);
    for (const key of ['resources', 'earned', 'facilities', 'population', 'assignments', 'events', 'completed', 'clock', 'history', 'address'] as const) expect(preExpansion(migrated.state[key])).toEqual(raw.state[key]);
    expect(preExpansion(migrated.state.ledger)).toEqual(preExpansion({ ...raw.state.ledger, exports: { energy: 0, parts: 0, memory: 0 }, imports: { energy: 0, parts: 0, memory: 0 } }));
    expect(migrated.state.city).toEqual({ districts: {}, templates: [], maintenance: 0 });
    expect(decodeSave(encodeSave(migrated.state, 0)).state).toEqual(migrated.state);
    const nearFull = migrated.state; stock(nearFull, 'energy', capacities(nearFull).energy - 50);
    expect(advance(nearFull, 1000).resources.energy).toBe(capacities(nearFull).energy);
  });
  it('C01: migration preserves a paused reservation, subsecond remainder, and return report', () => {
    let s = advance(act(old(), { type: 'enqueue', definition: 'build:generator' }), 70000);
    s = act(s, { type: 'pause', uid: s.queue[0].uid }); s.clock.remainderMs = 721;
    s.report = summarize(old(), s, 70000);
    const raw = preExpansion(JSON.parse(encodeSave(s, 0))); raw.schemaVersion = 1; raw.balanceVersion = '0.1.0';
    delete raw.state.network; delete raw.state.city; delete raw.state.publicWorks; delete raw.state.autoRepair; delete raw.state.report.maintenance;
    raw.state.queue.forEach((p: Record<string, unknown>) => { delete p.district; });
    const migrated = decodeSave(JSON.stringify(raw)).state;
    expect(preOutposts(migrated.queue)).toEqual(preOutposts(s.queue)); expect(migrated.queue.every(p => !p.outpost && !p.proof)).toBe(true); expect(migrated.clock).toEqual(s.clock); expect(migrated.ledger).toEqual(s.ledger); expect(preExpansion(migrated.report)).toEqual(preExpansion(s.report));
    const resumed = act(migrated, { type: 'resume', uid: migrated.queue[0].uid });
    expect(advance(resumed, 100000).facilities.generator).toBe(2);
    const broken = structuredClone(raw); broken.state.queue[0].reserved.parts++;
    expect(() => decodeSave(JSON.stringify(broken))).toThrow('预留');
  });
  it('C01/04: a developed legacy district gains a pending discovery without free rewards', () => {
    let developed = act(old(), { type: 'lighting', lighting: 'dim' });
    developed = finish(developed, 'build:recycler');
    const envelope = preExpansion(JSON.parse(encodeSave(developed, 0)));
    envelope.schemaVersion = 1; envelope.balanceVersion = '0.1.0';
    delete envelope.state.network; delete envelope.state.city; delete envelope.state.publicWorks; delete envelope.state.autoRepair; delete envelope.state.events.E08;
    const migrated = decodeSave(JSON.stringify(envelope)).state;
    expect(migrated.events.E08).toEqual({ status: 'pending' });
    expect(preExpansion(migrated.resources)).toEqual(preExpansion(developed.resources)); expect(preExpansion(migrated.earned)).toEqual(preExpansion(developed.earned)); expect(preExpansion(migrated.ledger)).toEqual(preExpansion(developed.ledger));
    const bad = structuredClone(envelope); bad.state.earned.parts++;
    expect(() => decodeSave(JSON.stringify(bad))).toThrow('累计取得');
  });
  it('C02/03: surveys both branches and scopes duplicate facilities and reservations', () => {
    let s = expanded();
    expect(activeDistricts(s)).toHaveLength(3); expect(s.events.E07?.status).toBe('pending');
    s = act(s, { type: 'enqueue', district: 'district-1', definition: 'build:dorm' });
    s = act(s, { type: 'enqueue', district: 'district-2', definition: 'build:dorm' });
    expect(s.queue.map(p => p.district)).toEqual(['district-1', 'district-2']);
    expect(applyAction(s, { type: 'enqueue', district: 'district-1', definition: 'build:dorm' }).error).toContain('队列');
    s = advance(s, 210000);
    expect(districtState(s, 'district-1')!.facilities.dorm).toBe(1); expect(districtState(s, 'district-2')!.facilities.dorm).toBe(1);
    expect(s.completed).toContain('district-1/build:dorm:1'); assertInvariants(s);
  });
  it('C03: reserves limited plots, refuses occupied demolition, and permits rebuilding', () => {
    let s = expanded(); fixtureFacility(s, 'district-1', 'dorm', 1);
    for (const definition of ['build:generator', 'build:recycler', 'build:workbench'] as const) s = act(s, { type: 'enqueue', district: 'district-1', definition });
    s = advance(s, 75000); // generator completes; two planned plots still reserved
    expect(districtState(s, 'district-1')!.facilities.generator).toBe(1);
    expect(enqueueReason(s, 'build:mailbox', 'district-1')).toContain('预留');
    s = advance(s, 45000); // the first resident arrives while the next plot is still under construction
    expect(applyAction(s, { type: 'dismantle', district: 'district-1', facility: 'dorm' }).error).toContain('居民');
    s = act(s, { type: 'dismantle', district: 'district-1', facility: 'generator' });
    expect(districtState(s, 'district-1')!.facilities.generator).toBe(0);
    expect(s.completed).not.toContain('district-1/build:generator:1');
    s = act(s, { type: 'enqueue', district: 'district-1', definition: 'build:mailbox' }); assertInvariants(s);
  });
  it('C03/04: preferences direct arrivals and relocation respects idle residents and beds', () => {
    let s = expanded(); fixtureFacility(s, 'district-0', 'dorm', 2); fixtureFacility(s, 'district-1', 'dorm', 1);
    s = act(s, { type: 'lighting', district: 'district-0', lighting: 'steady' });
    s = act(s, { type: 'lighting', district: 'district-1', lighting: 'dim' });
    const after = advance(s, 120000);
    expect(districtState(after, 'district-1')!.population.shadow).toBe(1); expect(after.population.shadow).toBe(2);
    expect(applyAction(after, { type: 'relocate', resident: 'echo', from: 'district-0', to: 'district-1' }).error).toContain('空闲');
    let moved = act(after, { type: 'assign', resident: 'echo', job: 'record', delta: -1 });
    moved = act(moved, { type: 'relocate', resident: 'echo', from: 'district-0', to: 'district-1' });
    expect(cityCount(moved)).toBe(cityCount(after)); expect(localFree(districtState(moved, 'district-1')!, 'echo')).toBe(1);
    expect(applyAction(moved, { type: 'relocate', resident: 'shadow', from: 'district-1', to: 'district-1' }).error).toContain('不同');
  });
});
describe('district economy, decisions, and automation', () => {
  it('C02/04: specialization and the name choice change actual outputs and ledger flows', () => {
    const s = specialized(); stock(s, 'parts', 100000); stock(s, 'memory', 20000);
    districtState(s, 'district-1')!.assignments.shadow.salvage = 1; districtState(s, 'district-2')!.assignments.echo.record = 1;
    const sameNames = view(s), withoutSpecialty = structuredClone(s);
    districtState(withoutSpecialty, 'district-1')!.population.shadow -= 1; withoutSpecialty.population.shadow += 1;
    districtState(withoutSpecialty, 'district-2')!.population.echo -= 1; withoutSpecialty.population.echo += 1;
    expect(sameNames.output.salvage).toBeGreaterThan(view(withoutSpecialty).output.salvage);
    expect(sameNames.output.record).toBeGreaterThan(view(withoutSpecialty).output.record);
    const unlit = structuredClone(s); districtState(unlit, 'district-1')!.lighting = 'steady'; districtState(unlit, 'district-2')!.lighting = 'steady';
    expect(sameNames.output.salvage).toBeGreaterThan(view(unlit).output.salvage);
    expect(sameNames.output.record).toBeGreaterThan(view(unlit).output.record);
    const common = structuredClone(s); common.events.E07!.choice = 'common';
    expect(view(common).lightingCost).toBeLessThan(sameNames.lightingCost);
    expect(view(common).output.record).toBeLessThan(sameNames.output.record);
    expect(applyAction(s, { type: 'event', event: 'E07', choice: 'common' }).error).toContain('处理');
    const empty = structuredClone(s); for (const id of activeDistricts(empty)) districtState(empty, id)!.assignments = { shadow: { power: 0, salvage: 0, repair: 0, record: 0, assemble: 0 }, echo: { power: 0, salvage: 0, repair: 0, record: 0, assemble: 0 } };
    stock(empty, 'energy', 0); expect(view(empty).services['district-1']!.light).toBe(false); assertInvariants(advance(empty, 1000));
  });
  it('C02/04: partial space and supply scale multi-district inputs, and rewards stay atomic', () => {
    let s = specialized(); stock(s, 'parts', capacities(s).parts - 10); stock(s, 'memory', capacities(s).memory - 10);
    const after = advance(s, 1000); expect(after.resources.parts).toBe(capacities(s).parts); expect(after.resources.memory).toBe(capacities(s).memory); assertInvariants(after);
    expect(applyAction(after, { type: 'event', event: 'E08' }).error).toContain('容量');
    stock(after, 'memory', capacities(after).memory - 8000);
    const failed = applyAction(after, { type: 'event', event: 'E08' }); expect(failed.state).toEqual(after); // parts still full
    stock(after, 'parts', capacities(after).parts - 30000);
    s = act(after, { type: 'event', event: 'E08' }); expect(s.ledger.rewards.parts - after.ledger.rewards.parts).toBe(30000);
    expect(applyAction(decodeSave(encodeSave(s, 0)).state, { type: 'event', event: 'E08' }).error).not.toBeNull();
  });
  it('C05: disabling preserves condition, exhaustion removes bonuses, and maintenance restores once', () => {
    let s = equipment(); s.publicWorks.relay.condition = 1;
    const paused = act(s, { type: 'public-toggle', district: 'district-0', facility: 'relay' });
    expect(advance(paused, 30000).publicWorks.relay.condition).toBe(1);
    const worn = advance(s, 1000); expect(worn.publicWorks.relay.condition).toBe(0); expect(servicePreview(worn)['district-0']!.public.relay).toBe(false);
    s = act(worn, { type: 'enqueue', definition: 'maintain:relay' });
    const before = s; s = advance(s, 50000);
    expect(s.city.maintenance).toBe(1); expect(s.publicWorks.relay.condition).toBe(CITY_RULES.condition);
    expect(summarize(before, s, 50000).maintenance).toBe(1);
    expect(advance(s, 1000).city.maintenance).toBe(1); assertInvariants(s);
  });
  it('C05: automatic inspections respect queue order and pause, and do not duplicate', () => {
    let s = act(equipment(), { type: 'auto-repair', district: 'district-0', enabled: true });
    s = act(s, { type: 'enqueue', definition: 'build:generator' });
    s = act(s, { type: 'enqueue', definition: 'build:recycler' });
    s = advance(s, 1000); expect(s.queue.map(p => p.definition)).toEqual(['build:generator', 'build:recycler', 'maintain:relay']);
    s = act(s, { type: 'pause', uid: s.queue[0].uid });
    const later = advance(s, 3600000); expect(later.city.maintenance).toBe(0); expect(later.queue).toHaveLength(3); expect(later.publicWorks.relay.condition).toBe(0);
    s = act(later, { type: 'resume', uid: later.queue[0].uid }); fill(s); s = advance(s, 260000);
    expect(s.city.maintenance).toBe(1); expect(s.queue).toHaveLength(0); assertInvariants(s);
  });
  it('C05: maintenance cancellation refunds only remaining costs without raising earned', () => {
    const before = act(equipment(), { type: 'enqueue', definition: 'maintain:relay' }), running = advance(before, 10000);
    const refund = refundPreview(running, running.queue[0]);
    const canceled = act(running, { type: 'cancel', uid: running.queue[0].uid });
    expect(canceled.city.maintenance).toBe(0); expect(canceled.earned).toEqual(running.earned); expect(refund.full.parts).toBe(4000); assertInvariants(canceled);
  });
  it('C06: templates persist and apply fees atomically; insufficient residents keep the old state', () => {
    let s = act(expanded(), { type: 'template-save', district: 'district-0', name: '记忆班' });
    s = act(s, { type: 'lighting', lighting: 'dim' });
    const before = s; s = act(s, { type: 'template-apply', name: '记忆班' });
    expect(s.lighting).toBe('bright'); expect(s.resources.parts).toBe(before.resources.parts - 5000);
    expect(decodeSave(encodeSave(s, 0)).state.city.templates).toEqual(s.city.templates);
    fixtureFacility(s, 'district-1', 'dorm', 1);
    s = act(s, { type: 'assign', resident: 'echo', job: 'record', delta: -1 });
    s = act(s, { type: 'relocate', resident: 'echo', from: 'district-0', to: 'district-1' });
    const result = applyAction(s, { type: 'template-apply', name: '记忆班' }); expect(result.error).toContain('居民不足'); expect(result.state).toEqual(s);
    s = act(s, { type: 'template-delete', name: '记忆班' }); expect(s.city.templates).toHaveLength(0);
  });
  it('C07: multi-district production, maintenance and reports match segmented offline time', () => {
    let s = specialized(); s = finish(s, 'public:relay'); s = finish(s, 'R04');
    s = act(s, { type: 'auto-repair', district: 'district-0', enabled: true }); fill(s);
    const whole = advance(s, 86400123); let split = s;
    for (const elapsed of [123, 601000, 14203000, 71596000]) split = advance(split, elapsed);
    expect(split).toEqual(whole); expect(whole.city.maintenance).toBeGreaterThan(1);
    const report = summarize(s, whole, 86400123);
    for (const r of RESOURCES) expect(report.end[r]).toBe(report.start[r] + report.flows.production[r] + report.flows.rewards[r] + report.flows.refunds[r] - report.flows.operating[r] - report.flows.reserved[r]);
    expect(decodeSave(encodeSave({ ...whole, report }, 0)).state.report).toEqual(report); assertInvariants(whole);
  });
  it('C01/03: rejects inconsistent branch saves, future versions, equipment, and forged templates', () => {
    const raw = JSON.parse(encodeSave(specialized(), 0));
    for (const mutate of [
      (o: typeof raw) => { o.state.city.districts['district-2'].population.echo = 8; },
      (o: typeof raw) => { o.state.city.districts['district-1'].facilities.generator = 3; },
      (o: typeof raw) => { o.state.city.districts['district-1'].publicWorks.relay.condition = 1801; },
      (o: typeof raw) => { o.state.city.districts['district-1'].autoRepair = true; },
      (o: typeof raw) => { o.state.events.E07.choice = 'bright'; },
      (o: typeof raw) => { o.state.city.templates.push({ name: '伪造', district: 'district-9' }); },
      (o: typeof raw) => { o.schemaVersion = 99; }
    ]) { const broken = structuredClone(raw); mutate(broken); expect(() => decodeSave(JSON.stringify(broken))).toThrow(); }
    expect(definitionFor(decodeSave(oldText).state, 'P07').cost.memory).toBe(50000);
  });
});
