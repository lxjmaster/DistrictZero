import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { amounts, BALANCE_VERSION, RESOURCES, resourceNames, SAVE_SCHEMA_VERSION } from '../../src/game/config';
import { advance, applyAction, summarize } from '../../src/game/engine';
import { ARCHIVES, archiveUnlocked, archivesUnlocked, LEGACY_ARCHIVE_IDS, remainingSpecialtyUses } from '../../src/game/journey';
import { assertInvariants, decodeSave, encodeSave } from '../../src/game/saves';
import { BACKUP_KEY, SAVE_KEY, SaveStorage } from '../../src/app/storage';
import type { Action, GameState, Resource } from '../../src/game/types';

const fixture = (name = 'v0.6-ready') => readFileSync(new URL(`../fixtures/${name}.json`, import.meta.url), 'utf8');
const load = (name?: string) => decodeSave(fixture(name)).state;
function act(s: GameState, action: Action) {
  const result = applyAction(s, action); expect(result.error, JSON.stringify(action)).toBeNull(); assertInvariants(result.state); return result.state;
}
function rejected(s: GameState, action: Action) {
  const result = applyAction(s, action); expect(result.error).not.toBeNull(); expect(result.state).toBe(s);
}
function consume(s: GameState, r: Resource, remaining: number) {
  s.ledger.operating[r] += s.resources[r] - remaining; s.resources[r] = remaining; assertInvariants(s);
}
const handOver: Action = { type: 'archive', id: 'A04' };
const versions = ['0.1', '0.2', '0.3', '0.3.1', '0.3.2', '0.3.3', '0.4', '0.5', '0.6'];

describe('V0.6.1 finite manual epilogue', () => {
  it('T01: uses its own chapter gate without unlocking any previous optional archive', () => {
    const ready = load(); expect(archivesUnlocked(ready)).toBe(false); expect(archiveUnlocked(ready, 'A04')).toBe(true);
    for (const id of LEGACY_ARCHIVE_IDS) { expect(archiveUnlocked(ready, id)).toBe(false); rejected(ready, { type: 'archive', id }); }
    for (const modify of [(s: GameState) => { delete s.experience.story['L06-4']; }, (s: GameState) => { s.completed = s.completed.filter(id => id !== 'P19'); }, (s: GameState) => { s.network.legacyPending = true; }]) {
      const locked = structuredClone(ready); modify(locked); expect(archiveUnlocked(locked, 'A04')).toBe(false); rejected(locked, handOver);
    }
    const old = load('v0.3.3-chapter'); expect(archivesUnlocked(old)).toBe(true); expect(archiveUnlocked(old, 'A04')).toBe(false); rejected(old, handOver);
  });
  it('T02/T05: pays exactly once from existing stock, keeps every other system and reports only fulfillment', () => {
    const before = load(), after = act(before, handOver);
    expect(ARCHIVES.A04.cost).toEqual(amounts(0, 0, 4000, 1000, 2000, 2000));
    const expected = structuredClone(before);
    for (const r of RESOURCES) { expected.resources[r] -= ARCHIVES.A04.cost[r]; expected.ledger.fulfillment[r] += ARCHIVES.A04.cost[r]; }
    expected.experience.archives.push('A04'); expected.history = after.history;
    expect(after).toEqual(expected); expect(after.history.length).toBe(Math.min(40, before.history.length + 1));
    expect(after.history.at(-1)?.text).toContain('三地候车回执'); rejected(after, handOver);
    const report = summarize(before, after, 0);
    expect(report.flows.fulfillment).toEqual(ARCHIVES.A04.cost); expect(report.flows.rewards).toEqual(amounts());
    expect(report.flows.imports).toEqual(amounts()); expect(report.completed).toEqual([]);
    expect(decodeSave(encodeSave(after, after.clock.lastAt)).state).toEqual(after);
    rejected(before, { type: 'archive', id: 'unknown' } as unknown as Action);
  });
  it.each(['memory', 'component', 'rainFilm', 'railCore'] as Resource[])('T02: one smallest missing %s unit rejects the entire payment', r => {
    const s = load(); consume(s, r, ARCHIVES.A04.cost[r] - 1); rejected(s, handOver);
    expect(applyAction(s, handOver).error).toBe(`缺少 0.001 ${resourceNames[r]}`);
  });
  it('T03: does not count in-transit or held local supply and preserves real promises on a successful handoff', () => {
    const boundary = load('v0.6-boundary'); expect(boundary.network.routes.station.trip).not.toBeNull();
    expect(boundary.calendar.orders[0].prepared).toBe(true); rejected(boundary, handOver);
    let ready = load();
    ready = act(ready, { type: 'calendar-add', route: 'rain', mode: 'specialty', delay: 2 });
    ready = act(ready, { type: 'calendar-toggle', enabled: true });
    ready = act(ready, { type: 'covenant-confirm', selected: ['extend', 'coexist'], reserve: amounts() });
    ready = advance(ready, 1000);
    for (const route of ['rain', 'station'] as const) ready = act(ready, { type: 'dispatch', route, direction: 'outbound', loads: 1 });
    ready = advance(ready, 120000); ready = act(ready, { type: 'calendar-toggle', enabled: false });
    expect(ready.calendar.orders[0].prepared).toBe(true); expect(ready.network.routes.station.trip).not.toBeNull();
    const after = act(ready, handOver);
    expect(after.network).toEqual(ready.network); expect(after.calendar).toEqual(ready.calendar); expect(after.covenants).toEqual(ready.covenants);
  });
  it('T04: runs six actual ordinary logistics actions then the actual seventh archive action', () => {
    let s = load('v0.6-chapter'); const start = s, actions: Action[] = [];
    const send = (action: Action) => { actions.push(action); s = act(s, action); };
    for (const route of ['rain', 'station'] as const) send({ type: 'production-mode', route, mode: 'specialty' });
    for (const route of ['rain', 'station'] as const) send({ type: 'dispatch', route, direction: 'outbound', loads: 1 });
    const returned = new Set();
    for (let second = 1; second <= 600; second++) {
      s = advance(s, 1000);
      for (const [route, resource] of [['rain', 'rainFilm'], ['station', 'railCore']] as const) if (!returned.has(route) && !s.network.routes[route].trip && s.network.routes[route].node.resources[resource] >= 2000) {
        send({ type: 'dispatch', route, direction: 'inbound', loads: { normal: 0, specialty: 1 } }); returned.add(route);
      }
      if (s.resources.rainFilm >= 2000 && s.resources.railCore >= 2000) break;
    }
    expect(s.clock.seconds - start.clock.seconds).toBe(360); expect(actions).toHaveLength(6); expect(s).toEqual(load());
    send(handOver); expect(actions).toHaveLength(7); expect(s.experience.archives).toEqual(['A04']);
    expect(s.calendar.boosts).toEqual(start.calendar.boosts); expect(s.covenants).toEqual(start.covenants);
  });
  it('T05: distinguishes pending A04 from old archives in both completion orders without early spoilers', () => {
    const chapter = load(); expect(remainingSpecialtyUses(chapter)).toContain('三地候车回执（可选尾声）');
    const a04 = act(chapter, handOver); expect(remainingSpecialtyUses(a04)).toContain('尚未复原的档案'); expect(remainingSpecialtyUses(a04)).not.toContain('三地候车回执（可选尾声）');
    const allOld = structuredClone(chapter);
    // Display-only combinations; invalid manufactured progression is never decoded.
    allOld.experience.archives = [...LEGACY_ARCHIVE_IDS];
    expect(remainingSpecialtyUses(allOld)).not.toContain('尚未复原的档案'); expect(remainingSpecialtyUses(allOld)).toContain('三地候车回执（可选尾声）');
    expect(remainingSpecialtyUses(load('v0.5-chapter'))).not.toContain('三地候车回执（可选尾声）');
  });
  it.each([false, true])('T07: %s completion is passive and preserves full/irregular time settlement', completed => {
    const before = completed ? act(load(), handOver) : load(), total = 900517;
    const full = advance(before, total); const split = advance(advance(advance(before, 517), 123000), 777000);
    expect(split).toEqual(full); expect(full.ledger.fulfillment).toEqual(before.ledger.fulfillment);
    expect(full.experience.archives).toEqual(before.experience.archives); expect(full.covenants).toEqual(before.covenants);
    expect(full.calendar).toEqual(before.calendar); assertInvariants(full);
  });
});

describe('V0.6.1 genuine migrations and archive source boundaries', () => {
  it.each(versions)('T06: genuine V%s migrates without granting A04', version => {
    const raw = JSON.parse(fixture(`v${version}-chapter`)), decoded = decodeSave(JSON.stringify(raw));
    expect(decoded.schemaVersion).toBe(SAVE_SCHEMA_VERSION); expect(decoded.balanceVersion).toBe(BALANCE_VERSION);
    expect(decoded.migratedFrom).toBe(raw.schemaVersion); expect(decoded.state.experience.archives).not.toContain('A04');
    expect(decodeSave(encodeSave(decoded.state, decoded.savedAt)).state).toEqual(decoded.state);
    if (version === '0.6') expect(decoded.state).toEqual(raw.state);
  });
  it.each(versions)('T06: rejects A04 hidden in genuine V%s rather than accepting a forged source', version => {
    const raw = JSON.parse(fixture(`v${version}-chapter`)); raw.state.experience = { ...raw.state.experience, archives: ['A04'] };
    expect(() => decodeSave(JSON.stringify(raw))).toThrow(/存档无效/);
  });
  it('T06: rejects duplicate, unpaid, missing-predecessor and old-archive gate forgeries in schema 10', () => {
    const done = act(load(), handOver), valid = encodeSave(done, done.clock.lastAt);
    for (const mutate of [(s: GameState) => { s.experience.archives.push('A04'); }, (s: GameState) => { delete s.experience.story['L06-4']; }, (s: GameState) => { s.ledger.fulfillment.memory -= 1; s.resources.memory += 1; }, (s: GameState) => { s.experience.archives.push('A01'); s.ledger.fulfillment.memory += 4000; s.ledger.fulfillment.rainFilm += 2000; }]) {
      const raw = JSON.parse(valid); mutate(raw.state); expect(() => decodeSave(JSON.stringify(raw))).toThrow(/存档无效/);
    }
  });
  it('T06: A04 cannot reuse commission payments, while independently paid results round-trip', () => {
    let s = load();
    for (const stage of ['CM05-1', 'CM06-1'] as const) {
      s = act(s, { type: 'commission-track', stage });
      s = act(s, { type: 'commission-deliver', stage });
    }
    const forged = JSON.parse(encodeSave(s, s.clock.lastAt));
    forged.state.experience.archives.push('A04');
    expect(() => decodeSave(JSON.stringify(forged))).toThrow(/三地候车回执缺少独立支付/);

    // Both consumed specialties must be produced and returned a second time;
    // no fabricated resources or ledger entries are used for the valid case.
    for (const route of ['rain', 'station'] as const) s = act(s, { type: 'dispatch', route, direction: 'outbound', loads: 1 });
    const returned = new Set<string>();
    for (let second = 1; second <= 600; second++) {
      s = advance(s, 1000);
      for (const [route, resource] of [['rain', 'rainFilm'], ['station', 'railCore']] as const) if (!returned.has(route) && !s.network.routes[route].trip && s.network.routes[route].node.resources[resource] >= 2000) {
        s = act(s, { type: 'dispatch', route, direction: 'inbound', loads: { normal: 0, specialty: 1 } }); returned.add(route);
      }
      if (s.resources.rainFilm >= 2000 && s.resources.railCore >= 2000) break;
    }
    const paid = act(s, handOver);
    expect(decodeSave(encodeSave(paid, paid.clock.lastAt)).state).toEqual(paid);
    const unpaidOldArchive = JSON.parse(encodeSave(paid, paid.clock.lastAt));
    unpaidOldArchive.state.experience.archives.push('A01');
    expect(() => decodeSave(JSON.stringify(unpaidOldArchive))).toThrow(/三地候车回执缺少独立支付/);
  });
  it('T06: A04 payment is separate from a claimed first visit and the radio restoration', () => {
    let visit = load();
    visit = act(visit, { type: 'assign', resident: 'echo', job: 'repair', delta: -1, district: 'district-0' });
    visit = act(visit, { type: 'field-start', site: 'F03', kind: 'first', resident: 'echo', district: 'district-0' });
    visit = advance(visit, 180000);
    visit = act(visit, { type: 'field-claim', uid: visit.neighborhood.field.pending[0].uid, choice: 'b' });
    visit = act(visit, handOver);
    const firstVisitForgery = JSON.parse(encodeSave(visit, visit.clock.lastAt));
    firstVisitForgery.state.ledger.fulfillment.component -= 1;
    firstVisitForgery.state.resources.component += 1;
    expect(() => decodeSave(JSON.stringify(firstVisitForgery))).toThrow(/三地候车回执缺少独立支付/);

    // A display-independent synthetic alternate branch: reverse the dismantle
    // reward and record the actual restore payment before completing A04.
    const restored = load();
    restored.experience.story['L01-2'] = { choice: 'restore' };
    restored.experience.blueprints = ['thriftBench'];
    restored.ledger.rewards.component -= 2000; restored.earned.component -= 2000; restored.resources.component -= 2000;
    for (const [r, amount] of [['parts', 6000], ['memory', 4000], ['component', 1000]] as const) {
      restored.ledger.fulfillment[r] += amount; restored.resources[r] -= amount;
    }
    assertInvariants(restored);
    const paid = act(restored, handOver);
    expect(decodeSave(encodeSave(paid, paid.clock.lastAt)).state).toEqual(paid);
    const radioForgery = JSON.parse(encodeSave(paid, paid.clock.lastAt));
    radioForgery.state.ledger.fulfillment.memory -= 1; radioForgery.state.resources.memory += 1;
    expect(() => decodeSave(JSON.stringify(radioForgery))).toThrow(/三地候车回执缺少独立支付/);
  });
  it.each(['chapter', 'ready', 'boundary'])('T06/T07: %s matches the independent released 24h+517ms complete state/report', name => {
    const reference = JSON.parse(fixture('v0.6-offline-reference')), expected = reference.cases.find((r: { name: string }) => r.name === name);
    const before = load(`v0.6-${name}`), after = advance(before, reference.elapsed); assertInvariants(after);
    expect(after).toEqual(expected.state); expect(summarize(before, after, reference.elapsed)).toEqual(expected.report);
  });
  it('T05/T06: migration retry preserves original bytes, recovery and the completed archive', () => {
    const original = fixture(), values = new Map([[SAVE_KEY, original]]); let fail = true;
    const store = new SaveStorage({ getItem: key => values.get(key) ?? null, setItem: (key, text) => { if (key === SAVE_KEY && fail) throw Error('quota'); values.set(key, text); }, removeItem: key => { values.delete(key); } });
    const loaded = store.load(); expect(loaded.warning).toContain('V0.6'); expect(loaded.warning).not.toContain('undefined');
    expect(() => store.save(loaded.state!, 0)).toThrow('quota'); expect(values.get(SAVE_KEY)).toBe(original); expect(values.get(BACKUP_KEY)).toBe(original);
    fail = false; store.save(loaded.state!, 0); expect(store.recovery()).toEqual(loaded.state);
    const completed = act(loaded.state!, handOver); store.save(completed, 0);
    expect(decodeSave(values.get(SAVE_KEY)!).state).toEqual(completed); rejected(store.load().state!, handOver);
    expect(store.recovery()).toEqual(loaded.state);
  });
});
