import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { amounts, RESOURCES } from '../../src/game/config';
import { activeDistricts } from '../../src/game/city';
import { boostCount, calendarClock, createCalendar } from '../../src/game/calendar-config';
import { advance, applyAction, capacities, createGame, summarize } from '../../src/game/engine';
import { assertInvariants, decodeSave, encodeSave, SaveVersionError } from '../../src/game/saves';
import { BACKUP_KEY, SAVE_KEY, SaveStorage } from '../../src/app/storage';
import type { Action, GameState } from '../../src/game/types';
import { preCalendar } from '../legacy-shape';

const versions = ['0.1', '0.2', '0.3', '0.3.1', '0.3.2', '0.3.3', '0.4'];
const fixture = (version: string) => readFileSync(new URL(`../fixtures/v${version}-chapter.json`, import.meta.url), 'utf8');
function act(s: GameState, action: Action): GameState {
  const result = applyAction(s, action);
  expect(result.error, JSON.stringify(action)).toBeNull(); assertInvariants(result.state); return result.state;
}
function run(s: GameState, seconds: number) { const next = advance(s, seconds * 1000); assertInvariants(next); return next; }
function reject(state: GameState, mutate: (s: GameState) => void) {
  const raw = JSON.parse(encodeSave(state, state.clock.lastAt)); mutate(raw.state);
  expect(() => decodeSave(JSON.stringify(raw))).toThrow(/存档无效/);
}
// Derived test-state production funds boundary scenarios, never the genuine
// historical fixture or the independent old-engine expectation.
function fund(s: GameState): GameState {
  const next = structuredClone(s), cap = capacities(next);
  for (const r of RESOURCES) { const added = cap[r] - next.resources[r]; next.resources[r] += added; next.ledger.production[r] += added; next.earned[r] += added; }
  return next;
}
let registered: GameState | undefined;
function calendarReady(): GameState {
  if (!registered) {
    let s = decodeSave(fixture('0.4')).state;
    for (const district of activeDistricts(s)) s = act(s, { type: 'auto-repair', district, enabled: false });
    if (s.outposts.active) s = act(s, { type: 'outpost-seal', confirmClear: true });
    s = fund(s); s = act(s, { type: 'story', node: 'L05-1' });
    s = act(s, { type: 'enqueue', definition: 'P13' }); s = run(s, 500);
    expect(s.completed).toContain('P13');
    registered = act(s, { type: 'story', node: 'L05-2' });
  }
  return structuredClone(registered);
}
function prepared(): GameState {
  let s = calendarReady();
  s = act(s, { type: 'calendar-storage', enabled: true, target: 300, reserve: amounts() }); s = run(s, 300);
  s = act(s, { type: 'production-mode', route: 'rain', mode: 'normal' });
  s = act(s, { type: 'calendar-add', route: 'rain', mode: 'normal', delay: 1 });
  s = act(s, { type: 'calendar-toggle', enabled: true });
  s = act(s, { type: 'dispatch', route: 'rain', direction: 'outbound', loads: 1 }); s = run(s, 120);
  expect(s.calendar.orders[0].prepared).toBe(true); expect(boostCount(s)).toBe(0);
  return act(s, { type: 'calendar-toggle', enabled: false });
}
function boosted(): GameState {
  let s = act(prepared(), { type: 'calendar-toggle', enabled: true }); s = run(s, 200);
  expect(boostCount(s)).toBe(1); expect(s.calendar.crossRound).toBe(1); return s;
}

describe('V0.5 genuine migration and recovery', () => {
  it.each(versions)('K08: validates genuine V%s and adds only an empty calendar', version => {
    const raw = JSON.parse(fixture(version)), decoded = decodeSave(fixture(version)), s = decoded.state;
    expect(raw.schemaVersion).toBe(versions.indexOf(version) + 1);
    expect(decoded.schemaVersion).toBe(9); expect(decoded.balanceVersion).toBe('0.6.0'); expect(decoded.migratedFrom).toBe(raw.schemaVersion);
    expect(s.calendar).toEqual(createCalendar()); expect(s.completed).not.toContain('P13'); expect(s.experience.story['L05-1']).toBeUndefined();
    expect(s.network.legacyPending).toBe(raw.schemaVersion < 6);
    if (raw.schemaVersion === 7) expect(preCalendar(s)).toEqual(raw.state);
    expect(decodeSave(encodeSave(s, decoded.savedAt)).state).toEqual(s);
  });
  it('K08: matches the actual V0.4 engine for 24 hours plus 517 milliseconds', () => {
    const reference = JSON.parse(readFileSync(new URL('../fixtures/v0.4-offline-reference.json', import.meta.url), 'utf8'));
    const before = decodeSave(fixture('0.4')).state, after = advance(before, reference.elapsed);
    expect(reference.source).toContain('V0.4 local working tree before V0.5');
    expect(reference.gameSourceSha256['engine.ts']).toMatch(/^[a-f0-9]{64}$/);
    expect(preCalendar(after)).toEqual(reference.state);
    expect(preCalendar(summarize(before, after, reference.elapsed))).toEqual(reference.report);
    expect(after.calendar).toEqual(createCalendar()); expect(after.clock.remainderMs).toBe(517); assertInvariants(after);
  });
  it.each(versions)('K08: rejects calendar fields disguised as genuine V%s', version => {
    const mutations = [
      (s: any) => { s.calendar = createCalendar(); },
      (s: any) => { s.completed.push('P13'); },
      (s: any) => { s.completed.push('district-1/P16'); },
      (s: any) => { s.queue.push({ definition: 'P14' }); },
      (s: any) => { s.queue.push({ definition: 'calendar:service' }); },
      (s: any) => { s.experience = { ...s.experience, story: { ...s.experience?.story, 'L05-1': {} } }; },
      (s: any) => { s.report = { ...s.report, calendar: {} }; },
      (s: any) => { s.report = { ...s.report, stories: ['L05-2'] }; },
      (s: any) => { s.report = { ...s.report, completed: ['P16'] }; }
    ];
    for (const mutate of mutations) { const raw = JSON.parse(fixture(version)); mutate(raw.state); expect(() => decodeSave(JSON.stringify(raw))).toThrow(/存档无效/); }
  });
  it('K10: preserves genuine V0.4 recovery bytes on migration and failed writes', () => {
    const prior = fixture('0.4'), entries = new Map<string, string>([[SAVE_KEY, prior]]); let fail = false;
    const store = new SaveStorage({ getItem: key => entries.get(key) ?? null, setItem: (key, value) => { if (fail && key === SAVE_KEY) throw new Error('quota'); entries.set(key, value); }, removeItem: key => { entries.delete(key); } });
    const loaded = store.load(); expect(loaded.warning).toContain('V0.4');
    fail = true; expect(() => store.save(loaded.state!, loaded.state!.clock.lastAt)).toThrow('quota');
    expect(entries.get(SAVE_KEY)).toBe(prior); expect(entries.get(BACKUP_KEY)).toBe(prior);
    fail = false; store.save(loaded.state!, loaded.state!.clock.lastAt);
    expect(JSON.parse(entries.get(SAVE_KEY)!).schemaVersion).toBe(9); expect(entries.get(BACKUP_KEY)).toBe(prior); expect(store.recovery()).toEqual(loaded.state);
  });
  it('K10: future/mismatched envelopes cannot replace the primary or recovery copy', () => {
    const prior = fixture('0.4'), future = JSON.parse(prior); future.schemaVersion = 10; future.balanceVersion = '0.7.0';
    const entries = new Map<string, string>([[SAVE_KEY, JSON.stringify(future)], [BACKUP_KEY, prior]]);
    const store = new SaveStorage({ getItem: key => entries.get(key) ?? null, setItem: (key, value) => { entries.set(key, value); }, removeItem: key => { entries.delete(key); } });
    expect(store.load().blocked).toBe(true); expect(() => store.save(createGame(), 0)).toThrow(SaveVersionError);
    expect(entries.get(SAVE_KEY)).toBe(JSON.stringify(future)); expect(entries.get(BACKUP_KEY)).toBe(prior);
    const mismatch = JSON.parse(prior); mismatch.balanceVersion = '0.5.0'; expect(() => decodeSave(JSON.stringify(mismatch))).toThrow(SaveVersionError);
  });
});

describe('V0.5 stored-time provenance and finite-order validation', () => {
  it('K01/K08: requires manual story, main-project and unique origin provenance', () => {
    const empty = decodeSave(fixture('0.4')).state, ready = calendarReady();
    reject(empty, s => { s.calendar.allowance = 6; }); reject(empty, s => { s.calendar.storage.target = 0; });
    reject(empty, s => { s.completed.push('P13'); s.calendar.originSecond = s.clock.seconds; s.calendar.allowance = 6; });
    reject(ready, s => { delete s.experience.story['L05-1']; }); reject(ready, s => { s.calendar.originSecond = null; });
    reject(ready, s => { s.calendar.originSecond = s.clock.seconds + 1; }); reject(ready, s => { s.completed.push('P14'); });
    reject(ready, s => { s.experience.story['L05-3'] = {}; }); reject(ready, s => { s.calendar.enabled = true; delete s.experience.story['L05-2']; });
  });
  it('K03/K10: keeps a legitimate zero target and rejects unpaid or invented stored time', () => {
    const s = act(calendarReady(), { type: 'calendar-storage', enabled: true, target: 0, reserve: amounts(1000, 2000, 3000, 4000, 5000, 6000) });
    expect(decodeSave(encodeSave(s, s.clock.lastAt)).state.calendar.storage).toEqual(s.calendar.storage);
    reject(s, v => { v.calendar.stored = 1; }); reject(s, v => { v.calendar.stored = 1; v.calendar.captured = 1; v.ledger.operating.memory = 0; });
    reject(s, v => { v.calendar.storage.target = 0.5; }); reject(s, v => { v.calendar.storage.reserve.railCore = 1_000_000_001; });
    reject(s, v => { v.calendar.services = 1; }); reject(s, v => { v.calendar.allowance = 7; });
  });
  it('K05/K10: round-trips paused whole-batch holds without changing local stock or ledgers', () => {
    const s = prepared(), decoded = decodeSave(encodeSave(s, s.clock.lastAt)).state;
    expect(decoded).toEqual(s); expect(decoded.calendar.orders[0].prepared).toBe(true); expect(decoded.calendar.enabled).toBe(false);
    const next = act(decoded, { type: 'calendar-cancel', uid: decoded.calendar.orders[0].uid });
    expect(next.network).toEqual(s.network); expect(next.resources).toEqual(s.resources); expect(next.ledger).toEqual(s.ledger);
    reject(s, v => { v.calendar.orders[0].supply.parts++; }); reject(s, v => { v.calendar.orders[0].product.memory++; });
    reject(s, v => { v.calendar.orders[0].earliestRound = v.calendar.orders[0].createdRound - 1; });
    reject(s, v => { v.calendar.orders[0].earliestRound = v.calendar.orders[0].createdRound + 3; });
    reject(s, v => { v.calendar.orders[0].createdRound = calendarClock(v).round + 1; });
    reject(s, v => { v.calendar.orders[0].uid = `cal-${v.calendar.nextOrder}`; });
    reject(s, v => { v.calendar.orders.push({ ...v.calendar.orders[0] }); });
    reject(s, v => { v.network.routes.rain.node.resources.parts--; v.network.routes.rain.node.used.parts++; });
  });
  it('K04/K08/K10: ties actual boosts, window history, cross-round evidence and reports together', () => {
    const before = prepared(), after = run(act(before, { type: 'calendar-toggle', enabled: true }), 200);
    after.report = summarize(before, after, 200000); assertInvariants(after);
    expect(after.report.calendar?.used).toBe(60); expect(after.report.calendar?.produced.rain.memory).toBe(12000);
    expect(decodeSave(encodeSave(after, after.clock.lastAt)).state).toEqual(after);
    reject(after, s => { s.calendar.history = []; }); reject(after, s => { s.calendar.crossRound = 0; });
    reject(after, s => { s.calendar.history[0].second = s.clock.seconds + 1; });
    reject(after, s => { s.calendar.history[0].completedRound++; });
    reject(after, s => { s.calendar.history[0].second = s.calendar.originSecond! + 600 + 120; });
    reject(after, s => { s.calendar.history[0].second = s.calendar.originSecond! + 1; s.calendar.history[0].createdRound = 0; s.calendar.history[0].completedRound = 0; s.calendar.crossRound = 0; });
    reject(after, s => { s.calendar.history[0].mode = 'specialty'; });
    reject(after, s => { s.calendar.boosts.rain.normal++; });
    reject(after, s => { s.report!.calendar!.used++; }); reject(after, s => { s.report!.calendar!.produced.rain.memory++; });
    reject(after, s => { s.report!.calendar!.captured = s.report!.seconds + 1; });
    reject(after, s => { s.report!.completed.push('P16'); });
  });
  it('K07/K10: does not turn calibration into a repeatable completed-key or remote project', () => {
    const s = boosted();
    reject(s, v => { v.completed.push('calendar:service'); });
    reject(s, v => { v.calendar.services++; v.calendar.allowance += 3; });
    const p = { uid: `q-${s.nextProject}`, definition: 'calendar:service' as const, district: 'district-0' as const, targetLevel: 1, prefab: 0, legacyChapter: false, outpost: null, proof: null, status: 'waiting' as const, progress: 0, reserved: amounts() };
    reject(s, v => { v.queue.push(p); v.nextProject++; });
  });
  it('K07/K08/K10: validates real repeatable service and preserves totals after twelve-record trimming', () => {
    let s = calendarReady();
    s = act(s, { type: 'production-mode', route: 'rain', mode: 'normal' });
    s = act(s, { type: 'calendar-storage', enabled: true, target: 300, reserve: amounts() });
    s = act(s, { type: 'calendar-toggle', enabled: true });
    s = run(s, 300);
    const maintain = () => {
      if (s.network.routes.rain.condition > 0) return;
      s = act(s, { type: 'enqueue', definition: 'route:rain' }); s = run(s, 200);
      expect(s.queue).toHaveLength(0);
    };
    for (let index = 0; index < 13; index++) {
      s = fund(s);
      if (s.calendar.allowance <= 3) {
        s = act(s, { type: 'enqueue', definition: 'calendar:service' }); s = run(s, 1);
        const project = s.queue[0]; expect(project.definition).toBe('calendar:service');
        s = act(s, { type: 'pause', uid: project.uid });
        expect(decodeSave(encodeSave(s, s.clock.lastAt)).state).toEqual(s);
        reject(s, v => { v.queue[0].district = 'district-1'; }); reject(s, v => { v.queue[0].prefab = 1; });
        reject(s, v => { v.queue[0].reserved.component++; }); reject(s, v => { v.queue[0].outpost = 'O01'; });
        s = act(s, { type: 'resume', uid: project.uid }); s = run(s, 200);
        expect(s.queue).toHaveLength(0);
      }
      maintain();
      s = act(s, { type: 'calendar-add', route: 'rain', mode: 'normal', delay: 0 });
      s = act(s, { type: 'dispatch', route: 'rain', direction: 'outbound', loads: 1 }); s = run(s, 900);
      expect(boostCount(s)).toBe(index + 1); expect(s.calendar.orders).toHaveLength(0);
      // Account for test-state use to leave a whole return package's space.
      const consume = Math.max(0, s.resources.memory + 12000 - capacities(s).memory);
      s.resources.memory -= consume; s.ledger.operating.memory += consume;
      maintain(); s = act(s, { type: 'dispatch', route: 'rain', direction: 'inbound', loads: 1 }); s = run(s, 120);
    }
    expect(s.calendar.services).toBe(4); expect(s.calendar.allowance).toBe(5);
    expect(s.calendar.history).toHaveLength(12); expect(s.calendar.history[0].uid).toBe('cal-2');
    expect(s.calendar.boosts.rain.normal).toBe(13); expect(s.completed).not.toContain('calendar:service');
    expect(decodeSave(encodeSave(s, s.clock.lastAt)).state).toEqual(s);
    reject(s, v => { v.calendar.history[0].uid = v.calendar.history[1].uid; });
    reject(s, v => { v.calendar.history[0].second = v.calendar.history[1].second; });
    reject(s, v => { v.calendar.history.pop(); });
  });
});
