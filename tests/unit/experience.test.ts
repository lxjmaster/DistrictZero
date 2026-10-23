import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { amounts, JOBS, RESIDENTS, RESOURCES } from '../../src/game/config';
import { activeDistricts, districtState } from '../../src/game/city';
import { advance, applyAction, capacities, createGame, definitionFor, refundPreview, summarize, view } from '../../src/game/engine';
import { ASSEMBLY, assemblyUnlocked, pendingStories, prefabLimit } from '../../src/game/experience';
import { assertInvariants, decodeSave, encodeSave } from '../../src/game/saves';
import type { Action, AssemblyMod, GameState, Resource } from '../../src/game/types';
import { preExpansion } from '../legacy-shape';

const fixture = (version: number) => readFileSync(new URL(`../fixtures/v0.${version}-chapter.json`, import.meta.url), 'utf8');
function act(state: GameState, action: Action) {
  const result = applyAction(state, action); expect(result.error).toBeNull(); assertInvariants(result.state); return result.state;
}
function stock(s: GameState, resource: Resource, value: number) {
  const delta = value - s.resources[resource]; s.resources[resource] = value;
  if (delta >= 0) { s.ledger.production[resource] += delta; s.earned[resource] += delta; } else s.ledger.operating[resource] -= delta;
}
function opened() { return act(decodeSave(fixture(1)).state, { type: 'story', node: 'L01-1' }); }
function assembly() {
  let s = opened();
  for (const r of RESIDENTS) for (const j of JOBS) s.assignments[r][j] = 0;
  s.assignments.shadow.power = 1; s.assignments.shadow.assemble = 1;
  s = act(s, { type: 'assembly-plan', enabled: true, target: capacities(s).component, reserve: amounts() });
  return s;
}
function finish(s: GameState, definition: `mod:${AssemblyMod}` | `blueprint:${AssemblyMod}`) {
  for (const r of RESIDENTS) for (const j of JOBS) s.assignments[r][j] = 0;
  s.assignments.shadow.power = 1; s.assignments.echo.repair = 1;
  s = act(s, { type: 'enqueue', definition }); s = advance(s, 60000);
  expect(s.queue).toHaveLength(0); assertInvariants(s); return s;
}
function thriftAssembly() {
  let s = act(decodeSave(fixture(2)).state, { type: 'story', node: 'L01-1' });
  s = act(s, { type: 'story', node: 'L01-2', choice: 'dismantle' });
  s = finish(s, 'blueprint:thriftBench'); s = finish(s, 'mod:thriftBench');
  for (const id of activeDistricts(s)) for (const r of RESIDENTS) for (const j of JOBS) districtState(s, id)!.assignments[r][j] = 0;
  s.assignments.echo.assemble = 1;
  return act(s, { type: 'assembly-mod', district: 'district-0', mod: 'thriftBench' });
}

describe('V0.3.1 production, targets, shared labor and recovery', () => {
  it('UX01/03: stays locked until the player reads the paper; pending stories do not run automatically', () => {
    const start = createGame();
    expect(applyAction(start, { type: 'story', node: 'L01-1' }).error).not.toBeNull();
    const old = decodeSave(fixture(1)).state, after = advance(old, 900000);
    expect(assemblyUnlocked(after)).toBe(false); expect(after.experience.story).toEqual({});
    expect(pendingStories(after)).toEqual(['L01-1']);
    expect(assemblyUnlocked(act(old, { type: 'story', node: 'L01-1' }))).toBe(true);
    const assembling = assembly(), queued = act(assembling, { type: 'enqueue', definition: 'P04' });
    const waiting = advance(queued, 10000);
    expect(waiting.queue[0].progress).toBe(0); expect(waiting.queue[0].reserved).toEqual(amounts());
  });
  it('UX01: repair and assembly share slots, and failed templates preserve the entire arrangement', () => {
    let s = opened(); s.assignments.echo.repair = 0; s.assignments.echo.record = 0;
    s = act(s, { type: 'assign', resident: 'echo', job: 'assemble', delta: 1 });
    s = act(s, { type: 'assign', resident: 'echo', job: 'repair', delta: 1 });
    s.assignments.shadow.salvage = 0;
    expect(applyAction(s, { type: 'assign', resident: 'shadow', job: 'repair', delta: 1 }).error).toContain('共享');
    s = act(s, { type: 'template-save', district: 'district-0', name: '共享工位' });
    s.city.templates[0].assignments.echo.assemble = 2; s.city.templates[0].assignments.echo.repair = 0;
    s.city.templates[0].assignments.shadow.repair = 1;
    const failed = applyAction(s, { type: 'template-apply', name: '共享工位' });
    expect(failed.error).toContain('共享'); expect(failed.state).toEqual(s);
  });
  it('UX02: produces exact fixed-point recipes and stops inputs at an exact quantity target', () => {
    let s = assembly(); s = act(s, { type: 'assembly-plan', enabled: true, target: 25, reserve: amounts() });
    const after = advance(s, 10000), report = summarize(s, after, 10000);
    expect(after.resources.component).toBe(25); expect(report.flows.production.component).toBe(25);
    expect(report.flows.operating.parts).toBe(200); expect(after.queue).toHaveLength(0);
    expect(view(after).output.assemble).toBe(0); assertInvariants(after);
  });
  it('UX02: honors fractional supply and reserves without free output or crossing the line', () => {
    let s = assembly(); s.assignments.shadow.power = 0;
    stock(s, 'energy', 104); stock(s, 'parts', 18);
    s = act(s, { type: 'assembly-plan', enabled: true, target: 1000, reserve: amounts(0, 10) });
    const after = advance(s, 1000);
    expect(after.resources.component).toBe(1); expect(after.resources.parts).toBe(10); expect(after.resources.energy).toBe(0);
    expect(after.ledger.operating.parts - s.ledger.operating.parts).toBe(8);
    assertInvariants(after);
  });
  it('UX02: charges the discounted unit recipe once for a partial assembly target', () => {
    const s = act(thriftAssembly(), { type: 'assembly-plan', enabled: true, target: 4, reserve: amounts() });
    const current = view(s), after = advance(s, 1000);
    expect(current.services['district-0']!.public.relay).toBe(true);
    expect(current.output.assemble).toBe(4); expect(current.costs.assemble.energy).toBe(9);
    expect(after.resources.component).toBe(4);
    expect(after.ledger.operating.parts - s.ledger.operating.parts).toBe(24);
    expect(after.ledger.operating.energy - s.ledger.operating.energy).toBe(current.lightingCost + current.publicCost + 9);
    assertInvariants(after);
  });
  it.each([0, 10000])('UX02: completes an exactly affordable assembly target with %i energy reserved', reserve => {
    let s = act(thriftAssembly(), { type: 'assembly-plan', enabled: true, target: 4, reserve: amounts(reserve) });
    const current = view(s);
    stock(s, 'energy', current.lightingCost + current.publicCost + reserve + 9);
    const after = advance(s, 1000);
    expect(after.resources.component).toBe(4); expect(after.resources.energy).toBe(reserve);
    expect(view(s).costs.assemble.energy).toBe(9); assertInvariants(after);
  });
  it('UX02/21: charges cumulative unit costs when a reservation opens assembly space in the same second', () => {
    let s = thriftAssembly(); s.assignments.shadow.repair = 1;
    stock(s, 'component', 998);
    s = act(s, { type: 'assembly-plan', enabled: true, target: 1000, reserve: amounts() });
    s = act(s, { type: 'priority', order: ['assemble', 'repair', 'record', 'salvage'] });
    s = act(s, { type: 'enqueue', definition: 'build:workbench', prefab: 1 });
    const current = view(s), payment = definitionFor(s, 'build:workbench', undefined, 'district-0', 1).cost;
    stock(s, 'energy', current.lightingCost + current.publicCost + payment.energy + current.costs.repair.energy + 9);
    const actual = view(s), after = advance(s, 1000), report = summarize(s, after, 1000);
    expect(actual.output.assemble).toBe(4); expect(actual.costs.assemble.energy).toBe(9);
    expect(report.flows.production.component).toBe(4); expect(report.flows.reserved.component).toBe(1000);
    expect(after.resources.component).toBe(2); expect(after.resources.energy).toBe(0);
    expect(after.queue[0].status).toBe('running'); assertInvariants(after);
  });
  it('UX02: a full output store costs no assembly materials and target settings survive reopening', () => {
    let s = assembly(); stock(s, 'component', capacities(s).component);
    s = act(s, { type: 'assembly-plan', enabled: true, target: ASSEMBLY.maxSetting, reserve: amounts(10000, 20000) });
    const after = advance(s, 10000);
    expect(after.resources.parts).toBe(s.resources.parts); expect(after.ledger.operating.parts).toBe(s.ledger.operating.parts);
    expect(decodeSave(encodeSave(after, 0)).state.experience.assembly).toEqual(s.experience.assembly);
  });
  it('UX02/21: reuses only this second\'s capacity when a project opens component space', () => {
    let s = assembly(); stock(s, 'component', capacities(s).component); s.assignments.echo.repair = 1;
    s = act(s, { type: 'priority', order: ['assemble', 'repair', 'record', 'salvage'] });
    s = act(s, { type: 'enqueue', definition: 'P04', prefab: 3 });
    const after = advance(s, 1000), flows = summarize(s, after, 1000).flows;
    expect(flows.production.component).toBe(20); expect(flows.reserved.component).toBe(3000);
    expect(flows.operating.parts).toBe(160); expect(after.resources.component).toBe(capacities(s).component - 3000 + 20);
    assertInvariants(after);
  });
  it('UX01/02: workbench upgrades scale assembly and its inputs without applying research or light bonuses', () => {
    let s = opened(); s = act(s, { type: 'enqueue', definition: 'build:workbench' }); s = advance(s, 120000);
    expect(s.facilities.workbench).toBe(2);
    for (const r of RESIDENTS) for (const j of JOBS) s.assignments[r][j] = 0;
    s.assignments.shadow.power = 1; s.assignments.echo.assemble = 1;
    s = act(s, { type: 'assembly-plan', enabled: true, target: 5000, reserve: amounts() });
    const before = structuredClone(s), after = advance(s, 1000);
    expect(after.resources.component - before.resources.component).toBe(23);
    expect(after.ledger.operating.parts - before.ledger.operating.parts).toBe(23 * 8);
    expect(after.ledger.operating.energy - before.ledger.operating.energy).toBe(100 + 23 * 4);
    expect(s.completed).toEqual(expect.arrayContaining(['R01', 'R02'])); assertInvariants(after);
  });
  it('UX02: shares a single target and reserve across two districts', () => {
    let s = act(decodeSave(fixture(2)).state, { type: 'story', node: 'L01-1' });
    for (const id of activeDistricts(s)) for (const r of RESIDENTS) for (const j of JOBS) districtState(s, id)!.assignments[r][j] = 0;
    // Use a real construction to give the second district a valid shared workbench.
    s.assignments.echo.repair = 1; s.assignments.shadow.power = 1;
    s = act(s, { type: 'enqueue', definition: 'build:workbench', district: 'district-1' }); s = advance(s, 130000);
    expect(districtState(s, 'district-1')!.facilities.workbench).toBe(1);
    s.assignments.echo.repair = 0; s.assignments.shadow.assemble = 1;
    districtState(s, 'district-1')!.assignments.shadow.assemble = 1;
    stock(s, 'parts', 20008);
    s = act(s, { type: 'assembly-plan', enabled: true, target: 1000, reserve: amounts(0, 20000) });
    const after = advance(s, 1000);
    expect(after.resources.component).toBe(1); expect(after.resources.parts).toBe(20000); assertInvariants(after);
  });
  it('UX02: dismantles only whole affordable units, checks room first and never increases earned', () => {
    const s = assembly(); stock(s, 'component', 2000); stock(s, 'parts', capacities(s).parts);
    const failed = applyAction(s, { type: 'scrap', count: 1 }); expect(failed.error).toContain('空间'); expect(failed.state).toEqual(s);
    stock(s, 'parts', capacities(s).parts - 4000);
    const after = act(s, { type: 'scrap', count: 1 });
    expect(after.resources.component).toBe(1000); expect(after.resources.parts).toBe(capacities(s).parts);
    expect(after.earned).toEqual(s.earned); expect(after.ledger.refunds.parts - s.ledger.refunds.parts).toBe(4000);
  });
});

describe('V0.3.1 resident choices and distinct workbench recipes', () => {
  it.each(['waiting', 'running', 'paused'] as const)('UX01/04/19: blocks workbench removal while its modification is %s', status => {
    let s = act(decodeSave(fixture(2)).state, { type: 'story', node: 'L01-1' });
    s = act(s, { type: 'story', node: 'L01-2', choice: 'dismantle' });
    s = advance(act(s, { type: 'enqueue', definition: 'build:workbench', district: 'district-1' }), 50000);
    s = act(s, { type: 'enqueue', definition: 'mod:quickJig', district: 'district-1' });
    if (status !== 'waiting') s = advance(s, 1000);
    if (status === 'paused') s = act(s, { type: 'pause', uid: s.queue[0].uid });
    expect(s.queue[0].status).toBe(status);
    const blocked = applyAction(s, { type: 'dismantle', district: 'district-1', facility: 'workbench' });
    expect(blocked.error).toContain('未完成'); expect(blocked.state).toEqual(s);
    expect(decodeSave(encodeSave(blocked.state, 0)).state).toEqual(s);
    s = act(s, { type: 'cancel', uid: s.queue[0].uid });
    s = act(s, { type: 'dismantle', district: 'district-1', facility: 'workbench' });
    expect(s.city.districts['district-1']!.facilities.workbench).toBe(0);
    expect(decodeSave(encodeSave(s, 0)).state).toEqual(s);
  });
  it.each(['restore', 'dismantle'] as const)('UX03: completes all four %s nodes atomically and never repeats a claim', choice => {
    let s = opened(); stock(s, 'component', 1000);
    const before = structuredClone(s); s = act(s, { type: 'story', node: 'L01-2', choice });
    expect(s.resources.component - before.resources.component).toBe(choice === 'restore' ? -1000 : 2000);
    expect(s.experience.blueprints).toEqual([choice === 'restore' ? 'thriftBench' : 'quickJig']);
    s = act(s, { type: 'story', node: 'L01-3' }); s = act(s, { type: 'story', node: 'L01-4' });
    expect(pendingStories(s)).toEqual([]);
    const again = applyAction(s, { type: 'story', node: 'L01-2', choice });
    expect(again.error).not.toBeNull(); expect(again.state).toEqual(s);
    expect(decodeSave(encodeSave(s, 0)).state).toEqual(s);
  });
  it('UX03: insufficient supplies or reward space leave the whole story unchanged', () => {
    const s = opened(); expect(applyAction(s, { type: 'story', node: 'L01-2', choice: 'restore' }).state).toEqual(s);
    stock(s, 'component', capacities(s).component - 1000);
    const full = applyAction(s, { type: 'story', node: 'L01-2', choice: 'dismantle' });
    expect(full.error).toContain('容量'); expect(full.state.experience).toEqual(s.experience); expect(full.state.resources).toEqual(s.resources);
  });
  it.each(['quickJig', 'thriftBench'] as const)('UX04: %s changes actual processing speed and unit costs without stacking', mod => {
    let s = act(opened(), { type: 'story', node: 'L01-2', choice: 'dismantle' });
    if (mod === 'thriftBench') s = finish(s, 'blueprint:thriftBench');
    s = finish(s, `mod:${mod}`);
    expect(s.experience.benches['district-0'].active).toBeNull();
    s = act(s, { type: 'assembly-mod', district: 'district-0', mod });
    s.assignments.echo.repair = 0; s.assignments.echo.assemble = 1;
    s = act(s, { type: 'assembly-plan', enabled: true, target: 5000, reserve: amounts() });
    const before = decodeSave(encodeSave(s, 0)).state, after = advance(before, 10000), recipe = ASSEMBLY.recipes[mod];
    const produced = recipe.rate * 10;
    expect(after.resources.component - before.resources.component).toBe(produced);
    expect(after.ledger.operating.parts - before.ledger.operating.parts).toBe(produced * recipe.parts);
    const ordinary = act(before, { type: 'assembly-mod', district: 'district-0', mod: null });
    expect(advance(ordinary, 10000).resources.component - ordinary.resources.component).toBe(200);
    expect(applyAction(after, { type: 'enqueue', definition: `mod:${mod}` }).error).not.toBeNull();
  });
  it('UX01/04: dismantling checks assembly staff, retains ownership, and rebuilding restores a single selectable mod', () => {
    let s = act(decodeSave(fixture(2)).state, { type: 'story', node: 'L01-1' });
    s = act(s, { type: 'story', node: 'L01-2', choice: 'dismantle' });
    for (const id of activeDistricts(s)) for (const r of RESIDENTS) for (const j of JOBS) districtState(s, id)!.assignments[r][j] = 0;
    s.assignments.shadow.power = 1; s.assignments.echo.repair = 1;
    s = advance(act(s, { type: 'enqueue', definition: 'build:workbench', district: 'district-1' }), 100000);
    s = advance(act(s, { type: 'enqueue', definition: 'mod:quickJig', district: 'district-1' }), 50000);
    s = act(s, { type: 'assembly-mod', district: 'district-1', mod: 'quickJig' });
    s = act(s, { type: 'assign', district: 'district-1', resident: 'shadow', job: 'assemble', delta: 1 });
    expect(applyAction(s, { type: 'dismantle', district: 'district-1', facility: 'workbench' }).error).toContain('装配工');
    s = act(s, { type: 'assign', district: 'district-1', resident: 'shadow', job: 'assemble', delta: -1 });
    s = act(s, { type: 'dismantle', district: 'district-1', facility: 'workbench' });
    const restored = decodeSave(encodeSave(s, 0)).state;
    expect(restored.experience.benches['district-1']).toEqual({ built: ['quickJig'], active: null });
    const forged = JSON.parse(encodeSave(restored, 0)); forged.state.experience.benches['district-1'].active = 'quickJig';
    expect(() => decodeSave(JSON.stringify(forged))).toThrow('没有维修台');
    s = advance(act(restored, { type: 'enqueue', definition: 'build:workbench', district: 'district-1' }), 100000);
    s = act(s, { type: 'assembly-mod', district: 'district-1', mod: 'quickJig' });
    expect(s.experience.benches['district-1']).toEqual({ built: ['quickJig'], active: 'quickJig' });
  });
});

describe('V0.3.1 prefabricated construction and save boundaries', () => {
  it('UX04/21: measures complete P04 preparation plus construction across all four arrangements', () => {
    let prepared = act(opened(), { type: 'story', node: 'L01-2', choice: 'dismantle' });
    prepared = finish(prepared, 'mod:quickJig'); prepared = finish(prepared, 'blueprint:thriftBench');
    stock(prepared, 'component', 2000); prepared = finish(prepared, 'mod:thriftBench');
    for (const r of RESIDENTS) for (const j of JOBS) prepared.assignments[r][j] = 0;
    prepared.assignments.shadow.power = 1; prepared.assignments.echo.repair = 1; prepared.assignments.echo.assemble = 1;
    stock(prepared, 'parts', 200000); stock(prepared, 'energy', 300000);
    for (const [mod, prefab, seconds, parts, energy] of [
      [null, 0, 375, 100000, 153750], [null, 3, 375, 100000, 143250], ['quickJig', 3, 325, 112000, 144250], ['thriftBench', 3, 425, 94000, 145250]
    ] as const) {
      let s = act(prepared, { type: 'assembly-mod', district: 'district-0', mod });
      s = act(s, { type: 'assembly-plan', enabled: prefab > 0, target: 3000, reserve: amounts() });
      s = act(s, { type: 'enqueue', definition: 'P04', prefab }); const start = structuredClone(s);
      const preparation = prefab ? seconds - 225 : 0;
      if (preparation) {
        s = advance(s, preparation * 1000); expect(s.resources.component).toBe(3000);
        s = act(s, { type: 'assembly-plan', ...s.experience.assembly, enabled: false });
      }
      s = advance(s, (seconds - preparation - 1) * 1000); expect(s.completed).not.toContain('P04'); s = advance(s, 1000);
      expect(s.completed).toContain('P04'); expect(s.clock.seconds - start.clock.seconds).toBe(seconds);
      expect(start.resources.parts - s.resources.parts).toBe(parts);
      const flows = summarize(start, s, seconds * 1000).flows;
      expect(flows.reserved.energy + flows.operating.energy).toBe(energy);
      expect(flows.reserved.memory).toBe(20000); assertInvariants(s);
    }
  });
  it('UX21: quotes and reserves an alternative P04 that changes both materials and actual completion time', () => {
    let s = opened(); stock(s, 'component', 3000);
    const plain = definitionFor(s, 'P04'), prefab = definitionFor(s, 'P04', 1, 'district-0', 3);
    expect(prefabLimit(plain)).toBe(3); expect(prefab.cost.parts).toBe(76000); expect(prefab.work).toBe(270000);
    const ordinary = act(s, { type: 'enqueue', definition: 'P04' });
    s = act(s, { type: 'enqueue', definition: 'P04', prefab: 3 });
    const started = advance(s, 1000); expect(started.queue[0].reserved).toEqual(prefab.cost);
    const after = advance(s, 225000), baseline = advance(ordinary, 225000);
    expect(after.completed).toContain('P04'); expect(baseline.completed).not.toContain('P04');
    expect(after.resources.component).toBe(0); assertInvariants(after);
    expect(advance(after, 10000).completed.filter(id => id === 'P04')).toHaveLength(1);
  });
  it('UX21: missing components wait without partial reservation, and invalid prefabrication cannot mutate state', () => {
    const s = opened(), waiting = act(s, { type: 'enqueue', definition: 'P04', prefab: 2 });
    const after = advance(waiting, 10000);
    expect(after.queue[0].status).toBe('waiting'); expect(after.queue[0].reserved).toEqual(amounts());
    for (const prefab of [-1, 0.5, 4]) expect(applyAction(s, { type: 'enqueue', definition: 'P04', prefab }).state).toEqual(s);
    expect(applyAction(s, { type: 'enqueue', definition: 'mod:quickJig', prefab: 1 }).error).not.toBeNull();
  });
  it('UX21: pause, reload and cancellation use the selected work and refund actual reserved components once', () => {
    let s = opened(); stock(s, 'component', 3000);
    s = advance(act(s, { type: 'enqueue', definition: 'P04', prefab: 3 }), 60000);
    s = act(s, { type: 'pause', uid: s.queue[0].uid });
    const restored = decodeSave(encodeSave(s, 0)).state, later = advance(restored, 90000);
    expect(later.queue).toEqual(restored.queue);
    const preview = refundPreview(later, later.queue[0]), canceled = act(later, { type: 'cancel', uid: later.queue[0].uid });
    expect(canceled.resources.component - later.resources.component).toBe(preview.actual.component);
    expect(canceled.earned).toEqual(later.earned); expect(applyAction(canceled, { type: 'cancel', uid: s.queue[0].uid }).state).toEqual(canceled);
  });
  it.each([1, 2, 3])('UX05: genuine schema %i retains its original numbers, arrangements, reports and offline rules', version => {
    const text = fixture(version), raw = JSON.parse(text), migrated = decodeSave(text);
    expect(migrated.migratedFrom).toBe(version); expect(migrated.schemaVersion).toBe(8);
    expect(migrated.state.resources).toEqual({ ...raw.state.resources, component: 0, rainFilm: 0, railCore: 0 });
    expect(migrated.state.priority).toEqual([...raw.state.priority, 'assemble']);
    expect(migrated.state.experience.story).toEqual({}); expect(migrated.state.experience.assembly.enabled).toBe(false);
    expect(preExpansion(migrated.state.queue)).toEqual(version === 1 ? raw.state.queue.map((p: object) => ({ ...p, district: 'district-0' })) : raw.state.queue);
    const roundTrip = decodeSave(encodeSave(migrated.state, 0)).state;
    expect(roundTrip).toEqual(migrated.state); assertInvariants(advance(roundTrip, 900000));
  });
  it('UX05: refuses fake old content and unknown versions without relaxing integrity checks', () => {
    const old = JSON.parse(fixture(3)); old.state.resources.component = 1;
    expect(() => decodeSave(JSON.stringify(old))).toThrow('旧版');
    const raw = JSON.parse(encodeSave(opened(), 0)); raw.schemaVersion = 99;
    expect(() => decodeSave(JSON.stringify(raw))).toThrow('版本不兼容');
    for (const change of [
      (v: typeof raw) => { v.state.experience.story['L01-4'] = {}; },
      (v: typeof raw) => { v.state.experience.blueprints = ['quickJig']; },
      (v: typeof raw) => { v.state.experience.benches['district-0'].active = 'quickJig'; },
      (v: typeof raw) => { v.state.experience.assembly.reserve.parts = -1; }
    ]) { const forged = JSON.parse(encodeSave(opened(), 0)); change(forged); expect(() => decodeSave(JSON.stringify(forged))).toThrow(); }
  });
  it.each([900, 86400])('UX08: continuous and segmented %i-second assembly conserve all flows and wait for stories', seconds => {
    const s = assembly(), whole = advance(s, seconds * 1000);
    let split = s; for (let elapsed = 0; elapsed < seconds;) { const step = Math.min(137, seconds - elapsed); split = advance(split, step * 1000); elapsed += step; }
    expect(split).toEqual(whole); expect(whole.experience.story['L01-2']).toBeUndefined();
    const report = summarize(s, whole, seconds * 1000);
    for (const r of RESOURCES) expect(report.end[r]).toBe(report.start[r] + report.flows.production[r] + report.flows.rewards[r] + report.flows.refunds[r] + report.flows.imports[r] - report.flows.exports[r] - report.flows.operating[r] - report.flows.reserved[r] - report.flows.fulfillment[r]);
    expect(report.highlights.length).toBeLessThanOrEqual(3); expect(report.stories).toContain('L01-2');
    expect(decodeSave(encodeSave({ ...whole, report }, 0)).state.report).toEqual(report); assertInvariants(whole);
  });
});
