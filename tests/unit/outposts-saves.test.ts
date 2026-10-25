import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { amounts, JOBS, RESIDENTS, RESOURCES } from '../../src/game/config';
import { activeDistricts } from '../../src/game/city';
import { activateNetworkRules, advance, applyAction, createGame, summarize } from '../../src/game/engine';
import { createOutposts, OUTPOST_INITIAL, outpostCapacities } from '../../src/game/outposts';
import { assertInvariants, decodeSave, encodeSave, SaveVersionError } from '../../src/game/saves';
import { BACKUP_KEY, SAVE_KEY, SaveStorage } from '../../src/app/storage';
import type { Action, GameState, Resource } from '../../src/game/types';
import type { OutpostId, OutpostProject } from '../../src/game/outpost-types';
import { preFreight, preOutposts } from '../legacy-shape';

const versions = ['0.1', '0.2', '0.3', '0.3.1', '0.3.2', '0.3.3'];
const fixture = (version: string) => readFileSync(new URL(`../fixtures/v${version}-chapter.json`, import.meta.url), 'utf8');
function act(s: GameState, action: Action): GameState {
  const result = applyAction(s, action);
  expect(result.error, JSON.stringify(action)).toBeNull(); assertInvariants(result.state); return result.state;
}
function reject(state: GameState, mutate: (s: GameState) => void) {
  const raw = JSON.parse(encodeSave(state, state.clock.lastAt)); mutate(raw.state);
  expect(() => decodeSave(JSON.stringify(raw))).toThrow(/存档无效/);
}
let registration: GameState | undefined;
function registered(): GameState {
  if (!registration) {
    let s = decodeSave(fixture('0.3.3')).state;
    for (const id of activeDistricts(s)) s = act(s, { type: 'auto-repair', district: id, enabled: false });
    for (const route of ['rain', 'station'] as const) s = act(s, { type: 'route-auto', route, enabled: false });
    s = act(s, { type: 'story', node: 'L04-1' });
    s = act(s, { type: 'enqueue', definition: 'P12' }); s = advance(s, 400000);
    expect(s.completed).toContain('P12'); expect(s.queue).toHaveLength(0); assertInvariants(s);
    registration = act(s, { type: 'story', node: 'L04-2' });
  }
  return structuredClone(registration);
}
function opened(id: OutpostId = 'O01') {
  return act(registered(), { type: 'outpost-open', outpost: id, crew: [{ district: 'district-1', resident: 'shadow' }, { district: 'district-2', resident: 'echo' }] });
}
function localStock(s: GameState, id: OutpostId, resource: Resource, value: number) {
  const site = s.outposts.sites[id]!, delta = value - site.resources[resource]; site.resources[resource] = value;
  if (delta >= 0) { site.ledger.production[resource] += delta; site.earned[resource] += delta; }
  else site.ledger.operating[resource] -= delta;
}
function complete(s: GameState, id: OutpostId, definition: OutpostProject, proof?: 'local' | 'relay') {
  const site = s.outposts.sites[id]!;
  for (const r of RESOURCES) localStock(s, id, r, outpostCapacities(s, id)[r]);
  for (const type of RESIDENTS) for (const job of JOBS) site.assignments[type][job] = 0;
  s = act(s, { type: 'outpost-assign', resident: 'shadow', job: 'power', delta: 1 });
  s = act(s, { type: 'outpost-assign', resident: 'echo', job: 'repair', delta: 1 });
  s = act(s, { type: 'outpost-enqueue', definition, ...(proof ? { proof } : {}) });
  s = advance(s, 400000); expect(s.outposts.sites[id]!.completed).toContain(definition); assertInvariants(s); return s;
}

describe('V0.4 genuine source migration and old offline settlement', () => {
  it.each(versions)('B09: validates real V%s before adding empty scope and zero support flows', version => {
    const raw = JSON.parse(fixture(version)), decoded = decodeSave(fixture(version)), s = decoded.state;
    expect(raw.schemaVersion).toBe(versions.indexOf(version) + 1);
    expect(decoded.schemaVersion).toBe(9); expect(decoded.balanceVersion).toBe('0.6.0'); expect(decoded.migratedFrom).toBe(raw.schemaVersion);
    expect(s.outposts).toEqual(createOutposts()); expect(s.ledger.supportSent).toEqual(amounts()); expect(s.ledger.supportReceived).toEqual(amounts());
    expect(s.queue.every(p => !p.outpost && !p.proof)).toBe(true);
    expect(s.completed).not.toContain('P12'); expect(s.experience.story['L04-1']).toBeUndefined();
    expect(s.network.legacyPending).toBe(raw.schemaVersion < 6);
    if (raw.schemaVersion === 6) expect(preOutposts(s)).toEqual(raw.state);
    expect(decodeSave(encodeSave(s, decoded.savedAt)).state).toEqual(s);
  });
  it('B01/B09: retains every old field over the released V0.3.3 day and remainder', () => {
    const reference = JSON.parse(readFileSync(new URL('../fixtures/v0.3.3-offline-reference.json', import.meta.url), 'utf8'));
    const before = decodeSave(fixture('0.3.3')).state, after = advance(before, reference.elapsed);
    after.report = summarize(before, after, reference.elapsed);
    expect(reference.source).toBe('d2dca809df0694718079830dbd3c99e060eb2ff3');
    expect(preOutposts(after)).toEqual(reference.state); expect(after.outposts).toEqual(createOutposts()); assertInvariants(after);
  });
  it('B09: retains the pre-schema-6 bridge and activates freight only afterward', () => {
    const reference = JSON.parse(readFileSync(new URL('../fixtures/v0.3.2-offline-reference.json', import.meta.url), 'utf8'));
    const before = decodeSave(fixture('0.3.2')).state, after = advance(before, reference.elapsed);
    after.report = summarize(before, after, reference.elapsed);
    expect(preFreight(after)).toEqual(reference.state); expect(after.network.legacyPending).toBe(true);
    const active = activateNetworkRules(after, before.clock.lastAt + reference.elapsed);
    expect(active.outposts).toEqual(createOutposts()); expect(active.ledger.supportSent).toEqual(amounts()); expect(active.resources).toEqual(after.resources); assertInvariants(active);
  });
  it.each(versions)('B09/B10: rejects V0.4 content disguised as real V%s', version => {
    const mutations = [
      (s: any) => { s.outposts = createOutposts(); }, (s: any) => { s.ledger.supportSent = amounts(); }, (s: any) => { s.ledger.supportReceived = amounts(); },
      (s: any) => { s.queue.push({ outpost: null }); }, (s: any) => { s.queue.push({ definition: 'P12' }); }, (s: any) => { s.queue.push({ definition: 'O01-1' }); },
      (s: any) => { s.completed.push('O01@build:generator:2'); }, (s: any) => { s.completed.push('P12'); },
      (s: any) => { s.experience = { ...s.experience, story: { ...s.experience?.story, 'L04-1': {} } }; }
    ];
    for (const mutate of mutations) { const raw = JSON.parse(fixture(version)); mutate(raw.state); expect(() => decodeSave(JSON.stringify(raw))).toThrow(); }
  });
  it('B10: unknown and mismatched versions cannot replace primary or recovery bytes', () => {
    const prior = fixture('0.3.3'), future = JSON.parse(prior); future.schemaVersion = 10; future.balanceVersion = '0.7.0';
    const entries = new Map<string, string>([[SAVE_KEY, JSON.stringify(future)], [BACKUP_KEY, prior]]);
    const store = new SaveStorage({ getItem: key => entries.get(key) ?? null, setItem: (key, value) => { entries.set(key, value); }, removeItem: key => { entries.delete(key); } });
    expect(store.load().blocked).toBe(true); expect(() => store.save(createGame(), 0)).toThrow(SaveVersionError);
    expect(entries.get(SAVE_KEY)).toBe(JSON.stringify(future)); expect(entries.get(BACKUP_KEY)).toBe(prior);
    const mismatch = JSON.parse(prior); mismatch.balanceVersion = '0.4.0'; expect(() => decodeSave(JSON.stringify(mismatch))).toThrow(SaveVersionError);
  });
  it('B10: first migration save and failed write preserve the genuine recovery copy', () => {
    const prior = fixture('0.3.3'), entries = new Map<string, string>([[SAVE_KEY, prior]]); let fail = false;
    const store = new SaveStorage({ getItem: key => entries.get(key) ?? null, setItem: (key, value) => { if (fail && key === SAVE_KEY) throw new Error('quota'); entries.set(key, value); }, removeItem: key => { entries.delete(key); } });
    const loaded = store.load(); expect(loaded.warning).toContain('V0.3.3');
    fail = true; expect(() => store.save(loaded.state!, loaded.state!.clock.lastAt)).toThrow('quota');
    expect(entries.get(SAVE_KEY)).toBe(prior); expect(entries.get(BACKUP_KEY)).toBe(prior);
    fail = false; store.save(loaded.state!, loaded.state!.clock.lastAt);
    expect(JSON.parse(entries.get(SAVE_KEY)!).schemaVersion).toBe(9); expect(entries.get(BACKUP_KEY)).toBe(prior); expect(store.recovery()).toEqual(loaded.state);
  });
});

describe('V0.4 strict scope, people, support and report validation', () => {
  it('B02/B07/B10: live and sealed round-trips do not reissue the initial package', () => {
    let s = opened(); const original = s.outposts.sites.O01;
    s = act(s, { type: 'outpost-seal', confirmClear: true }); s = decodeSave(encodeSave(s, s.clock.lastAt)).state;
    s = act(s, { type: 'outpost-open', outpost: 'O01', crew: [{ district: 'district-1', resident: 'shadow' }, { district: 'district-2', resident: 'echo' }] });
    expect(s.outposts.sites.O01).toEqual(original); expect(s.outposts.sites.O01!.ledger.supportReceived).toEqual(OUTPOST_INITIAL);
    reject(s, v => { v.outposts.sites.O01!.initialTransferred = false; });
    reject(s, v => { v.outposts.active = null; v.outposts.crew = []; v.outposts.nextCrew = 1; });
    reject(s, v => { v.outposts.sites.O01!.ledger.supportReceived.energy += 20000; v.outposts.sites.O01!.resources.energy += 20000; v.ledger.supportSent.energy += 20000; v.resources.energy -= 20000; });
  });
  it('B03/B10: rejects duplicate, nonexistent and multiply occupied source residents', () => {
    const s = opened();
    reject(s, v => { v.outposts.crew[1].uid = v.outposts.crew[0].uid; });
    reject(s, v => { v.outposts.crew[0].uid = `o-person-${v.outposts.nextCrew}`; });
    reject(s, v => { v.outposts.crew[0].district = 'district-9' as any; });
    reject(s, v => { v.outposts.crew[0].district = 'district-0'; });
    reject(s, v => { v.outposts.sites.O01!.assignments.shadow.power = 2; });
    reject(s, v => { v.outposts.crew.push({ uid: `o-person-${v.outposts.nextCrew++}`, district: 'district-1', resident: 'shadow' }); });
  });
  it('B04/B10: rejects illegal capacities, core facilities, specialty imports and shared jobs', () => {
    const s = opened();
    reject(s, v => { v.outposts.sites.O01!.facilities.generator = 0; }); reject(s, v => { v.outposts.sites.O01!.facilities.warehouse = 1; });
    reject(s, v => { localStock(v, 'O01', 'energy', 80001); }); reject(s, v => { localStock(v, 'O01', 'rainFilm', 1); });
    reject(s, v => { v.outposts.sites.O01!.assignments.shadow.repair = 1; v.outposts.sites.O01!.assignments.echo.assemble = 2; });
    reject(s, v => { v.outposts.sites.O01!.assembly.reserve.memory = 1; });
  });
  it('B05/B10: checks queue scope, reservation snapshots, prefab and paused round-trip', () => {
    let s = opened(); localStock(s, 'O01', 'parts', 60000);
    s = act(s, { type: 'outpost-assign', resident: 'shadow', job: 'power', delta: 1 });
    s = act(s, { type: 'outpost-assign', resident: 'echo', job: 'repair', delta: 1 });
    s = act(s, { type: 'outpost-enqueue', definition: 'O01-1' }); s = advance(s, 1000);
    s = act(s, { type: 'pause', uid: s.queue[0].uid }); s = act(s, { type: 'enqueue', definition: 'build:generator' });
    expect(decodeSave(encodeSave(s, s.clock.lastAt)).state).toEqual(s);
    reject(s, v => { v.queue[0].outpost = 'O02'; }); reject(s, v => { v.queue[0].district = 'district-1'; });
    reject(s, v => { v.queue[0].reserved.parts++; }); reject(s, v => { v.queue[0].prefab = 6; });
    reject(s, v => { v.queue[0].proof = 'local'; }); reject(s, v => { v.queue[1].status = 'running'; });
    reject(s, v => { v.outposts.active = null; v.outposts.crew = []; v.outposts.sites.O01!.assignments.echo.repair = 0; });
  });
  it('B06/B10: keeps waiting proof choices but rejects unsupported progress and outcomes', () => {
    let s = complete(opened('O02'), 'O02', 'O02-1');
    s = act(s, { type: 'outpost-enqueue', definition: 'O02-2', proof: 'relay' });
    expect(decodeSave(encodeSave(s, s.clock.lastAt)).state.queue[0].proof).toBe('relay');
    reject(s, v => { v.queue[0].proof = null; }); reject(s, v => { v.queue[0].proof = 'unknown' as any; });
    reject(s, v => { v.outposts.sites.O02!.proof = 'relay'; }); reject(s, v => { v.queue[0].status = 'paused'; });
    s = act(s, { type: 'cancel', uid: s.queue[0].uid }); s = complete(s, 'O02', 'O02-2', 'local');
    expect(s.outposts.sites.O02!.proof).toBe('local'); reject(s, v => { v.outposts.sites.O02!.proof = 'relay'; });
  });
  it('B07/B10: conserves each map and global support during shipment, pause and reentry', () => {
    let s = opened(); s = act(s, { type: 'support-plan', enabled: true, queue: ['light'], reserve: amounts() });
    s = advance(s, 1000); expect(s.outposts.support.trip).not.toBeNull(); assertInvariants(s);
    s = act(s, { type: 'support-pause' }); s = decodeSave(encodeSave(s, s.clock.lastAt)).state;
    const trip = structuredClone(s.outposts.support.trip); expect(s.outposts.support.enabled).toBe(false);
    reject(s, v => { v.outposts.support.trip!.cargo.energy--; }); reject(s, v => { v.outposts.support.trip!.remaining = 61; });
    reject(s, v => { v.outposts.support.trip!.outpost = 'O02'; }); reject(s, v => { v.outposts.sites.O01!.sent.light = 5; });
    reject(s, v => { localStock(v, 'O01', 'energy', 50000); }); reject(s, v => { v.outposts.active = null; v.outposts.crew = []; });
    s = advance(s, 60000); expect(s.outposts.support.trip).toBeNull();
    expect(s.outposts.sites.O01!.ledger.supportReceived.energy).toBe(OUTPOST_INITIAL.energy + trip!.cargo.energy); assertInvariants(s);
    s = act(s, { type: 'outpost-seal', confirmClear: true });
    s = act(s, { type: 'outpost-open', outpost: 'O02', crew: [{ district: 'district-1', resident: 'shadow' }, { district: 'district-2', resident: 'echo' }] });
    expect(s.ledger.supportSent.energy).toBe(OUTPOST_INITIAL.energy * 2 + trip!.cargo.energy);
    expect(decodeSave(encodeSave(s, s.clock.lastAt)).state).toEqual(s);
    reject(s, v => { v.outposts.sites.O02!.ledger.supportReceived.energy = v.ledger.supportSent.energy; });
  });
  it('B02/B08/B10: map results must precede handoffs, tools and shared knowledge', () => {
    const s = opened();
    reject(s, v => { v.outposts.knowledge.manifest = true; }); reject(s, v => { v.outposts.sites.O01!.handoff = true; v.outposts.knowledge.manifest = true; });
    reject(s, v => { v.outposts.sites.O01!.completed.push('O02-1'); v.completed.push('O01@O02-1'); });
    reject(s, v => { v.outposts.sites.O01!.lightFrame = true; }); reject(s, v => { v.outposts.sites.O01!.bench.active = 'thriftBench'; });
    reject(s, v => { v.outposts.support.queue = ['light', 'light']; });
    let done = complete(complete(complete(s, 'O01', 'O01-1'), 'O01', 'O01-2'), 'O01', 'O01-3');
    done = act(done, { type: 'outpost-handoff', outpost: 'O01' });
    expect(done.outposts.knowledge.manifest).toBe(true); expect(decodeSave(encodeSave(done, done.clock.lastAt)).state).toEqual(done);
    reject(done, v => { v.outposts.knowledge.manifest = false; }); reject(done, v => { v.outposts.sites.O01!.roofPrefab = null; });
  });
  it('B10/B11: preserves scoped reports and rejects invented outcomes or transfer imbalance', () => {
    let before = opened(); before = act(before, { type: 'support-plan', enabled: true, queue: ['materials'], reserve: amounts() });
    const after = advance(before, 62000); after.report = summarize(before, after, 62000); assertInvariants(after);
    expect(after.report.outposts?.[0].flows.supportReceived.parts).toBe(20000);
    expect(after.report.outposts?.[0].support).toEqual({ sent: 1, remaining: 3, queued: 0, inTransit: amounts() });
    expect(decodeSave(encodeSave(after, after.clock.lastAt)).state).toEqual(after);
    reject(after, v => { v.report!.outposts![0].end.parts++; }); reject(after, v => { v.report!.outposts!.push(v.report!.outposts![0]); });
    reject(after, v => { v.report!.outposts![0].completed.push('O02-1'); }); reject(after, v => { v.report!.completed.push('O02@build:warehouse:3'); });
    reject(after, v => { v.report!.flows.supportReceived.energy = 1; });
    reject(after, v => { v.report!.outposts![0].support.remaining = 4; });
    reject(after, v => { v.report!.outposts![0].support.inTransit.energy = 1; });
    reject(after, v => { delete (v.report!.outposts![0] as any).support; });
    reject(after, v => { delete (v.report!.outposts![0] as any).pending; });
    reject(after, v => { (v.report!.outposts![0] as any).reasons = 'not an array'; });
    reject(after, v => { v.report!.completed.push('O01@O01-1'); });
  });
  it('B02/B09: sealed maps remain unchanged during a day of old-city advancement', () => {
    let s = opened(); s = act(s, { type: 'outpost-seal', confirmClear: true });
    const site = structuredClone(s.outposts.sites.O01), after = advance(s, 86400517);
    expect(after.outposts.sites.O01).toEqual(site); assertInvariants(after);
    reject(after, v => { v.outposts.sites.O01!.assembly.enabled = true; }); reject(after, v => { v.outposts.sites.O01!.assignments.shadow.power = 1; });
  });
});
