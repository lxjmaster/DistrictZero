import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { amounts, RESOURCES } from '../../src/game/config';
import { advance, applyAction, createGame, definitionFor, summarize, view } from '../../src/game/engine';
import { COVENANT_IDS, COVENANT_RULES, covenantActive, covenantCost, covenantProof, covenantWorkFactor, createCovenants } from '../../src/game/covenants';
import { assertInvariants, decodeSave, encodeSave } from '../../src/game/saves';
import { SAVE_KEY, BACKUP_KEY, SaveStorage } from '../../src/app/storage';
import type { Action, CovenantId, GameState } from '../../src/game/types';
import { preCovenants } from '../legacy-shape';

const fixture = (name = 'v0.5-chapter') => readFileSync(new URL(`../fixtures/${name}.json`, import.meta.url), 'utf8');
function act(s: GameState, action: Action) { const result = applyAction(s, action); expect(result.error, JSON.stringify(action)).toBeNull(); assertInvariants(result.state); return result.state; }
function run(s: GameState, seconds: number) { const after = advance(s, seconds * 1000); assertInvariants(after); return after; }
function until(s: GameState, id: string) { for (let i = 0; i < 30 && !s.completed.includes(id); i++) s = run(s, 60); expect(s.completed).toContain(id); return s; }
let registered: GameState | undefined;
function ready() {
  if (!registered) {
    let s = decodeSave(fixture()).state;
    s = act(s, { type: 'story', node: 'L06-1' }); s = act(s, { type: 'enqueue', definition: 'P17' }); s = until(s, 'P17');
    registered = act(s, { type: 'story', node: 'L06-2' });
  }
  return structuredClone(registered);
}
const choose = (s: GameState, selected: CovenantId[], reserve = amounts()) => act(s, { type: 'covenant-confirm', selected, reserve });
function dual() {
  let s = run(choose(ready(), ['preserve']), 60);
  s = act(s, { type: 'enqueue', definition: 'P18' }); s = choose(s, ['extend']); s = until(s, 'P18');
  return act(s, { type: 'story', node: 'L06-3' });
}
function rejects(s: GameState, action: Action) { const result = applyAction(s, action); expect(result.error).not.toBeNull(); expect(result.state).toBe(s); }
function invalid(s: GameState, mutate: (s: GameState) => void) { const raw = JSON.parse(encodeSave(s, s.clock.lastAt)); mutate(raw.state); expect(() => decodeSave(JSON.stringify(raw))).toThrow(/存档无效/); }

describe('V0.6 covenant runtime and complete chapter', () => {
  it('G01/G04: locks progress, requires manual confirmation and applies on the next paid second', () => {
    const fresh = createGame(); rejects(fresh, { type: 'enqueue', definition: 'P17' }); rejects(fresh, { type: 'story', node: 'L06-2' }); rejects(fresh, { type: 'covenant-confirm', selected: ['preserve'], reserve: amounts() });
    const before = ready(), selected = choose(before, ['preserve']);
    expect(covenantActive(selected, 'preserve')).toBe(false);
    expect(selected.covenants.changes).toBe(1); expect(selected.covenants.paid.preserve).toBe(0);
    for (const r of RESOURCES) expect(before.resources[r] - selected.resources[r]).toBe(COVENANT_RULES.adjustment[r]);
    const after = run(selected, 1); expect(covenantActive(after, 'preserve')).toBe(true); expect(after.covenants.lightSaved).toBeGreaterThan(0);
    expect(after.covenants.upkeep).toEqual(covenantCost(['preserve']));
    rejects(selected, { type: 'enqueue', definition: 'P18' }); expect(before.covenants).toEqual(createCovenants());
  });
  it('G01/G02/G08: completes every direction, all three projects and four letters using actual production', () => {
    let s = dual(); expect(covenantProof(s, 'preserve')).toBe(true); expect(covenantProof(s, 'extend')).toBe(true);
    s = run(choose(s, ['coexist']), 60); expect(covenantProof(s, 'coexist')).toBe(false);
    s = act(s, { type: 'dispatch', route: 'rain', direction: 'outbound', loads: 1 }); expect(covenantProof(s, 'coexist')).toBe(true);
    s = run(choose(s, ['extend', 'coexist']), 60); expect(s.covenants.combined).toBe(60);
    s = act(s, { type: 'enqueue', definition: 'P19' }); s = until(s, 'P19'); s = act(s, { type: 'story', node: 'L06-4' });
    for (const id of ['P17', 'P18', 'P19']) expect(s.completed.filter(v => v === id)).toHaveLength(1);
    rejects(s, { type: 'story', node: 'L06-4' }); expect(decodeSave(encodeSave(s, s.clock.lastAt)).state).toEqual(s);
  });
  it('G02: changes real repair, record, salvage and lighting results and restores them on pause', () => {
    const base = act(dual(), { type: 'covenant-pause' }), waiting = act(base, { type: 'enqueue', definition: 'public:registry', district: 'district-2' });
    const plain = view(act(waiting, { type: 'covenant-pause' }));
    const preserve = view(choose(waiting, ['preserve'])), extend = view(choose(waiting, ['extend'])), coexist = view(choose(waiting, ['coexist']));
    expect(preserve.lightingCost).toBeLessThan(plain.lightingCost); expect(preserve.output.repair).toBeLessThan(plain.output.repair);
    expect(extend.output.repair).toBeGreaterThan(plain.output.repair); expect(extend.output.record).toBeLessThan(plain.output.record);
    expect(coexist.output.salvage).toBeLessThan(plain.output.salvage);
    expect(view(act(choose(waiting, ['preserve']), { type: 'covenant-pause' })).output).toEqual(plain.output);
  });
  it('G02/FR-06: district lighting costs preview the next payment, recover after shortage, and sum to the city cost', () => {
    const base = act(ready(), { type: 'covenant-pause' }), preserved = choose(base, ['preserve']);
    const plain = view(base), discounted = view(preserved);
    for (const id of ['district-0', 'district-1', 'district-2'] as const) {
      expect(plain.services[id]!.lightingCost).toBe(80);
      expect(discounted.services[id]!.lightingCost).toBe(60);
    }
    expect(Object.values(discounted.services).reduce((sum, service) => sum + service!.lightingCost, 0)).toBe(discounted.lightingCost);
    const blocked = choose(base, ['preserve'], { ...base.resources, energy: base.resources.energy - 6000, parts: 0, memory: 0, component: 0, rainFilm: 0, railCore: 0 });
    expect(view(blocked).services['district-0']!.lightingCost).toBe(80);
    const recovered = run(blocked, 1); expect(recovered.covenants.paidSecond).toBeNull();
    expect(view(recovered).services['district-0']!.lightingCost).toBe(60);
    expect(view(act(preserved, { type: 'covenant-pause' })).services['district-0']!.lightingCost).toBe(80);
    const unpowered = run(act(createGame(), { type: 'assign', resident: 'shadow', job: 'power', delta: -1 }), 1000);
    expect(view(unpowered).services['district-0']).toMatchObject({ light: false, lightingCost: 0 });
  });
  it.each([['preserve', 'extend'], ['preserve', 'coexist'], ['extend', 'coexist']] as CovenantId[][])('G02: permits the %s + %s combination with one summed payment', (a, b) => {
    const before = choose(dual(), [a, b]), after = run(before, 1);
    expect(after.covenants.combined - before.covenants.combined).toBe(1);
    for (const r of RESOURCES) expect(after.covenants.upkeep[r] - before.covenants.upkeep[r]).toBe(covenantCost([a, b])[r]);
    expect(covenantWorkFactor(after)).toBe(a === 'preserve' && b === 'extend' ? 0.9375 : a === 'preserve' ? 0.75 : 1.25);
  });
  it('G03/G04: rejects invalid settings atomically, cannot bypass upkeep with same-second switches, and pauses with bad drafts', () => {
    const base = ready();
    for (const selected of [[], ['preserve', 'extend'], ['preserve', 'preserve'], ['bad']]) rejects(base, { type: 'covenant-confirm', selected: selected as CovenantId[], reserve: amounts() });
    for (const r of RESOURCES) for (const value of [-1, 0.5, NaN, Infinity, 1_000_000_001]) rejects(base, { type: 'covenant-confirm', selected: ['preserve'], reserve: { ...amounts(), [r]: value } });
    let s = run(choose(base, ['preserve']), 1); const snapshot = structuredClone(s.covenants);
    rejects(s, { type: 'covenant-confirm', selected: ['preserve'], reserve: amounts() });
    s = choose(s, ['extend']); expect(s.covenants.paidSecond).toBeNull(); s = choose(s, ['coexist']); expect(s.covenants.paid).toEqual(snapshot.paid); expect(s.covenants.feeSaved).toBe(0);
    const before = structuredClone(s); s = act(s, { type: 'covenant-pause' }); expect(s.resources).toEqual(before.resources); expect(s.covenants.paidSecond).toBeNull();
    rejects(dual(), { type: 'covenant-confirm', selected: COVENANT_IDS, reserve: amounts() });
  });
  it('G03: pays before generation, blocks the whole group and automatically recovers without debt', () => {
    let s = choose(dual(), ['extend', 'coexist']);
    // This derived boundary state consumes stock through its real operating ledger.
    const consumed = s.resources.energy; s.resources.energy = 0; s.ledger.operating.energy += consumed; assertInvariants(s);
    const start = structuredClone(s.covenants); s = run(s, 1);
    expect(s.covenants.upkeep).toEqual(start.upkeep); expect(s.covenants.paid).toEqual(start.paid); expect(s.covenants.blocked).toBe(start.blocked + 1);
    expect(s.resources.energy).toBeGreaterThan(0); s = run(s, 1); expect(s.covenants.paid.extend).toBe(start.paid.extend + 1);
    s = run(s, 60);
    const held = { ...s.resources, energy: Math.max(0, s.resources.energy - 6000), parts: Math.max(0, s.resources.parts - 4000), memory: Math.max(0, s.resources.memory - 2000) };
    s = choose(s, ['preserve'], held); const payment = structuredClone(s.covenants.upkeep); s = run(s, 1);
    expect(s.covenants.upkeep).toEqual(payment); // Adjustment leaves exactly the reserve, then upkeep must wait.
  });
  it('G05: preserves in-transit snapshots across switching, shortage and pause', () => {
    let s = run(choose(dual(), ['coexist']), 1); s = act(s, { type: 'dispatch', route: 'rain', direction: 'outbound', loads: 1 });
    const trip = structuredClone(s.network.routes.rain.trip!); expect(trip.fee).toBe(4800); // The genuine source has the +2-energy freight rack.
    s = choose(s, ['preserve']); expect(s.network.routes.rain.trip).toEqual(trip);
    s = act(s, { type: 'covenant-pause' }); expect(decodeSave(encodeSave(s, s.clock.lastAt)).state.network.routes.rain.trip).toEqual(trip);
    s = run(s, trip.duration); expect(s.network.routes.rain.trip).toBeNull();
  });
  it('G02/G05: preserves whole prepared calendar holds and independent outpost rules', () => {
    let s = ready();
    s = act(s, { type: 'calendar-add', route: 'rain', mode: 'specialty', delay: 2 });
    s = act(s, { type: 'calendar-toggle', enabled: true }); s = act(s, { type: 'dispatch', route: 'rain', direction: 'outbound', loads: 1 });
    s = run(s, 120); expect(s.calendar.orders[0].prepared).toBe(true);
    s = act(s, { type: 'calendar-toggle', enabled: false }); const before = structuredClone(s);
    const plain = run(before, 60), changed = run(choose(before, ['preserve']), 60);
    expect(changed.outposts).toEqual(plain.outposts); expect(changed.network).toEqual(plain.network);
    expect(changed.calendar.orders).toEqual(before.calendar.orders);
    const paused = act(changed, { type: 'covenant-pause' }); expect(paused.calendar.orders).toEqual(before.calendar.orders);
    expect(decodeSave(encodeSave(paused, paused.clock.lastAt)).state).toEqual(paused);
  });
  it('G02: slows actual resident arrival time while preserving resident provenance', () => {
    let s = ready();
    // Derive one vacant bed at the real next-arrival boundary, with the correct
    // resident sequence. No source fixture or full-route economy is changed.
    s = act(s, { type: 'assign', resident: 'echo', job: 'assemble', delta: -1 });
    s.population.echo -= 1; s.arrivals -= 1; s.arrivalSeconds = 0; assertInvariants(s);
    const plain = run(s, 5), preserved = run(choose(s, ['preserve']), 5);
    expect(plain.arrivalSeconds).toBe(5); expect(preserved.arrivalSeconds).toBe(4);
    expect(preserved.population).toEqual(plain.population);
  });
  it.each([900_517, 86_400_517, 604_800_517])('G06/G10: %i milliseconds are identical across irregular segments and additive reports', elapsed => {
    const before = choose(dual(), ['extend', 'coexist'], amounts(10_000, 390_000, 80_000));
    before.ledger.operating.energy += before.resources.energy; before.resources.energy = 0;
    const continuous = advance(before, elapsed); assertInvariants(continuous);
    let split = before, left = elapsed; const paid = { preserve: 0, extend: 0, coexist: 0 }, upkeep = amounts(); let blocked = 0, combined = 0;
    for (const size of [517, 123_456, 776_027, 6_000_001, elapsed]) {
      if (!left) break; const ms = Math.min(left, size), next = advance(split, ms), report = summarize(split, next, ms); left -= ms;
      for (const id of COVENANT_IDS) paid[id] += report.covenants!.paid[id];
      for (const r of RESOURCES) upkeep[r] += report.covenants!.upkeep[r]; blocked += report.covenants!.blocked; combined += report.covenants!.combined; split = next;
    }
    expect(split).toEqual(continuous); const report = summarize(before, continuous, elapsed).covenants!;
    expect({ paid, upkeep, blocked, combined }).toEqual({ paid: report.paid, upkeep: report.upkeep, blocked: report.blocked, combined: report.combined });
    expect(continuous.clock.remainderMs).toBe(517);
    expect(report.blocked).toBeGreaterThan(0); expect(report.paid.extend).toBeGreaterThan(0);
  }, 60_000);
});

describe('V0.6 genuine migrations and source validation', () => {
  const versions = ['0.1', '0.2', '0.3', '0.3.1', '0.3.2', '0.3.3', '0.4', '0.5'];
  it.each(versions)('G07: migrates genuine V%s with only empty, disabled covenants', version => {
    const text = fixture(`v${version}-chapter`), raw = JSON.parse(text), loaded = decodeSave(text);
    expect(loaded.migratedFrom).toBe(raw.schemaVersion); expect(loaded.schemaVersion).toBe(10); expect(loaded.state.covenants).toEqual(createCovenants());
    expect(decodeSave(encodeSave(loaded.state, loaded.savedAt)).state).toEqual(loaded.state);
    if (version === '0.5') expect(preCovenants(loaded.state)).toEqual(raw.state);
  });
  it.each(versions)('G07: rejects V0.6 content disguised as V%s in all retained source positions', version => {
    for (const mutate of [(s: any) => { s.covenants = createCovenants(); }, (s: any) => { s.completed.push('P17'); }, (s: any) => { s.queue.push({ definition: 'P18' }); }, (s: any) => { s.experience = { ...s.experience, story: { ...s.experience?.story, 'L06-1': {} } }; }, (s: any) => { s.report = { ...s.report, covenants: {} }; }, (s: any) => { s.report = { ...s.report, stories: ['L06-4'] }; }, (s: any) => { s.report = { ...s.report, completed: ['district-1/P19'] }; }]) {
      const raw = JSON.parse(fixture(`v${version}-chapter`)); mutate(raw.state); expect(() => decodeSave(JSON.stringify(raw))).toThrow(/存档无效/);
    }
  });
  it.each(['chapter', 'in-transit'])('G05/G07: matches the published V0.5 whole old interval with %s state', name => {
    const ref = JSON.parse(fixture('v0.5-offline-reference')), before = decodeSave(fixture(`v0.5-${name}`)).state, after = advance(before, ref.elapsed), expected = name === 'chapter' ? ref : ref.boundary;
    expect(preCovenants(after)).toEqual(expected.state); expect(preCovenants(summarize(before, after, ref.elapsed))).toEqual(expected.report); expect(after.covenants).toEqual(createCovenants()); assertInvariants(after);
  });
  it('G07: retains original V0.5 bytes for failed migration writes and recovery', () => {
    const prior = fixture(), values = new Map([[SAVE_KEY, prior]]); let fail = true;
    const store = new SaveStorage({ getItem: k => values.get(k) ?? null, setItem: (k, v) => { if (fail && k === SAVE_KEY) throw Error('quota'); values.set(k, v); }, removeItem: k => { values.delete(k); } });
    const loaded = store.load(); expect(loaded.warning).toContain('V0.5'); expect(() => store.save(loaded.state!, loaded.state!.clock.lastAt)).toThrow('quota'); expect(values.get(BACKUP_KEY)).toBe(prior); expect(values.get(SAVE_KEY)).toBe(prior);
    fail = false; store.save(loaded.state!, loaded.state!.clock.lastAt); expect(JSON.parse(values.get(SAVE_KEY)!).schemaVersion).toBe(10); expect(store.recovery()).toEqual(loaded.state);
  });
  it('G10: rejects unpaid, impossible and unproven runtime, story, project and report changes', () => {
    const s = run(choose(ready(), ['preserve']), 60);
    for (const mutate of [(v: GameState) => { v.covenants.paid.preserve++; }, (v: GameState) => { v.covenants.adjustments.energy++; }, (v: GameState) => { v.covenants.paidSecond = v.clock.seconds + 1; }, (v: GameState) => { v.covenants.selected = ['preserve', 'extend']; }, (v: GameState) => { v.covenants.feeSaved = 1; }, (v: GameState) => { v.covenants.combined++; }, (v: GameState) => { v.completed.push('P19'); }, (v: GameState) => { v.experience.story['L06-4'] = {}; }]) invalid(s, mutate);
    const after = run(s, 10); after.report = summarize(s, after, 10000); assertInvariants(after);
    invalid(after, v => { v.report!.covenants!.upkeep.memory++; }); invalid(after, v => { v.report!.covenants!.paid.preserve = 11; });
    expect(definitionFor(after, 'P19').work).toBe(600000);
  });
});
