import { describe, expect, it } from 'vitest';
import { FACILITY_IDS, FLOWS, RESOURCES } from '../../src/game/config';
import { advance, advanceTo, applyAction, capacities, createGame, definitionFor, enqueueReason, refundPreview, summarize, view } from '../../src/game/engine';
import { assertInvariants, decodeSave, encodeSave } from '../../src/game/saves';
import type { Action, Facility, GameState } from '../../src/game/types';

function act(s: GameState, a: Action) {
  const result = applyAction(s, a); expect(result.error).toBeNull(); return result.state;
}
function stock(s: GameState, resource: 'energy' | 'parts' | 'memory', value: number) {
  const difference = value - s.resources[resource];
  if (difference >= 0) { s.ledger.production[resource] += difference; s.earned[resource] += difference; }
  else s.ledger.operating[resource] -= difference;
  s.resources[resource] = value;
}
function facility(s: GameState, f: Facility, level: number) {
  const initial = createGame().facilities[f]; s.facilities[f] = level;
  for (let l = initial + 1; l <= level; l++) if (!s.completed.includes(`build:${f}:${l}`)) s.completed.push(`build:${f}:${l}`);
}
function ready(): GameState {
  const s = createGame();
  s.completed.push('P01', 'P02'); s.events.E01 = { status: 'pending' }; s.events.E02 = { status: 'pending' };
  facility(s, 'dorm', 2); facility(s, 'warehouse', 1); facility(s, 'mailbox', 1);
  s.population = { shadow: 3, echo: 3 }; s.arrivals = 4; s.events.E03 = { status: 'pending' };
  stock(s, 'energy', 250000); stock(s, 'parts', 200000); stock(s, 'memory', 45000);
  s.memoryProduced = true; s.events.E04 = { status: 'pending' };
  s.assignments = { shadow: { power: 1, salvage: 1, repair: 1, record: 0 }, echo: { power: 0, salvage: 0, repair: 0, record: 1 } };
  assertInvariants(s); return s;
}
describe('economy, assignment, and lighting', () => {
  it('UT-01/02: starts with two workers and produces actual resources without mutating input', () => {
    const s = createGame(), after = advance(s, 10000);
    expect(after.resources).toEqual({ energy: 33500, parts: 12400, memory: 0 });
    expect(after.earned).toEqual({ energy: 5000, parts: 2400, memory: 0 });
    expect(s.clock.seconds).toBe(0); assertInvariants(after);
  });
  it('UT-03: resident, facility, lighting, and research effects combine', () => {
    const s = ready(); facility(s, 'recycler', 2); facility(s, 'mailbox', 2);
    const dim = act(s, { type: 'event', event: 'E03', choice: 'dim' });
    const dimView = view(dim);
    expect(dimView.output.salvage).toBe(345); expect(dimView.output.record).toBe(62);
    const bright = act(dim, { type: 'lighting', lighting: 'bright' });
    expect(bright.resources.parts).toBe(dim.resources.parts - 5000);
    bright.completed.push('R02');
    expect(view(bright).output.record).toBe(104);
    expect(advance(dim, 60000).earned.parts).toBeGreaterThan(advance(bright, 60000).earned.parts);
    expect(advance(bright, 60000).earned.memory).toBeGreaterThan(advance(dim, 60000).earned.memory);
  });
  it('FR-02: rejects overassignment, missing facilities, and invalid priorities', () => {
    let s = createGame(); expect(applyAction(s, { type: 'assign', resident: 'shadow', job: 'repair', delta: 1 }).error).toContain('空闲');
    s = act(s, { type: 'assign', resident: 'shadow', job: 'salvage', delta: -1 });
    expect(applyAction(s, { type: 'assign', resident: 'shadow', job: 'record', delta: 1 }).error).toContain('岗位');
    expect(applyAction(s, { type: 'priority', order: ['repair', 'repair', 'record'] }).error).not.toBeNull();
    const full = ready(); full.assignments.echo.repair = 1;
    expect(applyAction(full, { type: 'assign', resident: 'echo', job: 'repair', delta: 1 }).error).toContain('容量');
  });
  it('UT-04/05: partial output scales inputs and full storage costs nothing', () => {
    const s = createGame(); stock(s, 'parts', 99940);
    const partial = advance(s, 1000);
    expect(partial.resources.parts).toBe(100000);
    expect(partial.ledger.operating.energy).toBe(75); // lighting 50 + quarter of recycler input 100
    const full = advance(partial, 1000);
    expect(full.earned.parts).toBe(partial.earned.parts);
    expect(full.ledger.operating.energy - partial.ledger.operating.energy).toBe(50);
    assertInvariants(full);
  });
  it('UT-05: positive net production fills energy to its exact capacity', () => {
    const after = advance(createGame(), 600000);
    expect(after.resources.energy).toBe(capacities(after).energy);
    expect(after.resources.parts).toBe(capacities(after).parts);
    expect(view(after).net.energy).toBe(0);
    assertInvariants(after);
  });
  it('UT-04/05: same-second consumption frees capacity without charging rounded inputs twice', () => {
    const s = ready(), cap = capacities(s);
    stock(s, 'energy', cap.energy); stock(s, 'parts', cap.parts - 20);
    const after = advance(s, 1000), report = summarize(s, after, 1000);
    expect(after.resources.parts).toBe(cap.parts);
    expect(after.resources.energy).toBe(cap.energy);
    expect(report.flows.production.parts).toBe(50); // 20 headroom + 30 consumed by the recorder
    expect(report.flows.operating.energy).toBe(121); // lighting 50 + ceil(100 * 50 / 240) + recorder 50
    expect(report.flows.production.energy).toBe(121);
    expect(report.flows.operating.parts).toBe(30);
    expect(report.flows.production.memory).toBe(60);
    assertInvariants(after);
    expect(decodeSave(encodeSave(after, 0)).state).toEqual(after);
  });
  it('UT-05/06: a later reservation reuses capacity-blocked production within the same tick budget', () => {
    const s = ready(), cap = capacities(s);
    for (const r of RESOURCES) stock(s, r, cap[r]);
    s.priority = ['salvage', 'record', 'repair'];
    const planned = act(s, { type: 'enqueue', definition: 'R01' });
    const after = advance(planned, 1000), report = summarize(planned, after, 1000);
    expect(report.flows.production).toEqual({ energy: 350, parts: 240, memory: 60 });
    expect(report.flows.operating).toEqual({ energy: 350, parts: 30, memory: 0 });
    expect(report.flows.reserved).toEqual({ energy: 0, parts: 50000, memory: 20000 });
    expect(after.queue[0].progress).toBe(1000);
    const settled = advance(after, 3600000);
    expect(settled.resources).toEqual(cap);
    assertInvariants(after); assertInvariants(settled);
  });
  it('UT-04/05: capacity refill cannot exceed generation or hide a supply deficit', () => {
    const s = ready(), cap = capacities(s);
    facility(s, 'workbench', 3); s.assignments.echo.repair = 3;
    s.population = { shadow: 4, echo: 4 }; s.arrivals = 6; facility(s, 'dorm', 3);
    for (const r of RESOURCES) stock(s, r, cap[r]);
    const running = advance(act(s, { type: 'enqueue', definition: 'P03' }), 1000);
    stock(running, 'energy', cap.energy);
    const after = advance(running, 1000), report = summarize(running, after, 1000);
    expect(report.flows.production.energy).toBe(500);
    expect(report.flows.operating.energy).toBe(800);
    expect(after.resources.energy).toBe(cap.energy - 300);
    expect(after.resources.parts).toBe(running.resources.parts + 210);
    expect(report.flows.production.memory).toBe(60);
    assertInvariants(after);
  });
  it('UT-04: priorities allocate scarce input and lighting fails without power', () => {
    const s = ready(); s.assignments.shadow.power = 0; stock(s, 'energy', 175);
    const normal = advance(s, 1000), recordFirst = advance(act(s, { type: 'priority', order: ['record', 'salvage', 'repair'] }), 1000);
    expect(normal.ledger.production.memory - s.ledger.production.memory).toBe(30);
    expect(recordFirst.ledger.production.memory - s.ledger.production.memory).toBe(60);
    expect(view(advance(normal, 1000)).lightOn).toBe(false);
    assertInvariants(normal); assertInvariants(recordFirst);
  });
  it('UT-05: a full memory store also stops record inputs', () => {
    const s = ready(); stock(s, 'memory', capacities(s).memory); s.assignments.shadow.salvage = 0;
    const after = advance(s, 1000);
    expect(after.ledger.operating.parts).toBe(s.ledger.operating.parts);
    expect(after.ledger.operating.energy - s.ledger.operating.energy).toBe(50);
    expect(view(s).reasons.join()).toContain('记忆满仓');
  });
});
describe('projects, population, and one-time decisions', () => {
  it('UT-06: queue waits for workers and supplies, then reserves once', () => {
    let s = act(createGame(), { type: 'enqueue', definition: 'P01' });
    expect(advance(s, 30000).queue[0].status).toBe('waiting');
    s = advance(s, 30000);
    s = act(s, { type: 'assign', resident: 'shadow', job: 'salvage', delta: -1 });
    s = act(s, { type: 'assign', resident: 'shadow', job: 'repair', delta: 1 });
    const started = advance(s, 1000), continued = advance(started, 1000);
    expect(started.queue[0].status).toBe('running'); expect(started.ledger.reserved.parts).toBe(15000);
    expect(continued.ledger.reserved).toEqual(started.ledger.reserved); assertInvariants(continued);
  });
  it('UT-07: pause preserves work and reservations; cancel refunds only unfinished work', () => {
    const s = act(ready(), { type: 'enqueue', definition: 'R01' }), running = advance(s, 100000);
    const paused = act(running, { type: 'pause', uid: running.queue[0].uid }), later = advance(paused, 10000);
    expect(later.queue[0].progress).toBe(paused.queue[0].progress);
    const resumed = act(later, { type: 'resume', uid: later.queue[0].uid });
    const preview = refundPreview(resumed, resumed.queue[0]), canceled = act(resumed, { type: 'cancel', uid: resumed.queue[0].uid });
    expect(preview.full.parts).toBe(33000); expect(preview.full.memory).toBe(13000);
    expect(canceled.earned).toEqual(resumed.earned);
    expect(canceled.ledger.refunds.parts).toBe(33000);
    expect(canceled.ledger.operating.energy).toBe(resumed.ledger.operating.energy);
    assertInvariants(canceled);
  });
  it('UT-07: refunds show capacity overflow and clamp without increasing earned', () => {
    let s = advance(act(ready(), { type: 'enqueue', definition: 'R01' }), 1000);
    stock(s, 'parts', capacities(s).parts - 1000);
    const p = refundPreview(s, s.queue[0]); expect(p.overflow.parts).toBeGreaterThan(0); expect(p.actual.parts).toBe(1000);
    const canceled = act(s, { type: 'cancel', uid: s.queue[0].uid });
    expect(canceled.resources.parts).toBe(capacities(s).parts); expect(canceled.earned.parts).toBe(s.earned.parts); assertInvariants(canceled);
  });
  it('UT-08: completed results apply once, and excess work never transfers to the next project', () => {
    let s = ready(); s.assignments.echo.repair = 1;
    s = act(act(s, { type: 'enqueue', definition: 'R01' }), { type: 'enqueue', definition: 'R02' });
    const boundary = advance(s, 150000);
    expect(boundary.completed.filter(id => id === 'R01')).toHaveLength(1);
    expect(boundary.queue[0].definition).toBe('R02'); expect(boundary.queue[0].progress).toBe(0); expect(boundary.queue[0].status).toBe('waiting');
    const next = advance(boundary, 1000); expect(next.queue[0].progress).toBe(2400);
    expect(applyAction(next, { type: 'enqueue', definition: 'R01' }).error).toContain('完成'); assertInvariants(next);
  });
  it('FR-04/05: facility costs grow, unlocks, duplicates, limits and reordering are enforced', () => {
    let s = ready(); const upgrade = definitionFor(s, 'build:generator');
    expect(upgrade.cost.parts).toBe(29000); expect(upgrade.work).toBe(104000);
    s = act(act(s, { type: 'enqueue', definition: 'build:generator' }), { type: 'enqueue', definition: 'build:recycler' });
    expect(applyAction(s, { type: 'enqueue', definition: 'build:generator' }).error).toContain('队列');
    const moved = act(s, { type: 'move', uid: s.queue[1].uid, direction: -1 }); expect(moved.queue[0].definition).toBe('build:recycler');
    s = act(s, { type: 'enqueue', definition: 'R01' }); expect(enqueueReason(s, 'R02')).toContain('满');
    const started = advance(moved, 1000); expect(applyAction(started, { type: 'move', uid: started.queue[1].uid, direction: -1 }).error).not.toBeNull();
    expect(enqueueReason(createGame(), 'build:workbench')).toContain('首次');
    const upgraded = advance(started, 104000); expect(upgraded.facilities.recycler).toBe(2); assertInvariants(upgraded);
  });
  it('UT-09: arrival order, full housing, and a fresh timer when space opens', () => {
    const s = ready(); // six residents, six beds
    expect(advance(s, 100000).arrivalSeconds).toBe(0);
    facility(s, 'dorm', 3);
    const before = advance(s, 119000); expect(before.population).toEqual(s.population);
    const first = advance(before, 1000); expect(first.population.shadow).toBe(4);
    const second = advance(first, 120000); expect(second.population.echo).toBe(4); expect(second.arrivalSeconds).toBe(0); assertInvariants(second);
  });
  it('UT-10: events wait, free choice applies once, and claimed rewards remain one-time after reload', () => {
    const s = ready(), before = advance(s, 3600000);
    expect(before.lighting).toBe('steady'); expect(before.events.E03?.status).toBe('pending');
    const chosen = act(before, { type: 'event', event: 'E03', choice: 'bright' });
    expect(chosen.resources.parts).toBe(before.resources.parts);
    expect(applyAction(chosen, { type: 'event', event: 'E03', choice: 'dim' }).error).not.toBeNull();
    stock(chosen, 'memory', 70000);
    const claimed = act(chosen, { type: 'event', event: 'E01' });
    const reloaded = decodeSave(encodeSave(claimed, 0)).state;
    expect(applyAction(reloaded, { type: 'event', event: 'E01' }).state.earned).toEqual(claimed.earned);
    expect(reloaded.events.E01?.status).toBe('claimed');
  });
  it('UT-10: overflowing rewards remain pending until capacity is available', () => {
    const s = ready(); stock(s, 'memory', 79000);
    expect(applyAction(s, { type: 'event', event: 'E01' }).error).toContain('容量'); expect(s.events.E01?.status).toBe('pending');
  });
  it('FR-07/14: all six facilities can reach their limits and chapter outcome survives reopening', () => {
    let s = ready();
    // Finish chapter before upgrades, using the same queue and production rules.
    s = advance(act(s, { type: 'enqueue', definition: 'P03' }), 900000);
    expect(s.address).toBe('0-001'); expect(s.events.E05?.status).toBe('pending');
    s = act(s, { type: 'event', event: 'E05' });
    for (const f of FACILITY_IDS) while (s.facilities[f] < 3) {
      for (const r of RESOURCES) stock(s, r, capacities(s)[r]);
      s = advance(act(s, { type: 'enqueue', definition: `build:${f}` }), 180000);
    }
    expect(Object.values(s.facilities)).toEqual([3, 3, 3, 3, 3, 3]);
    expect(decodeSave(encodeSave(s, 0)).state.address).toBe('0-001'); assertInvariants(s);
  });
});
describe('time, reporting, and save boundaries', () => {
  it('UT-11: continuous and irregular segmented time yield identical state and additive flows', () => {
    const s = act(act(ready(), { type: 'enqueue', definition: 'R01' }), { type: 'enqueue', definition: 'build:dorm' });
    const totalMs = 3600347, one = advance(s, totalMs);
    let segmented = s, remaining = totalMs; const combined = structuredClone(s.ledger);
    while (remaining > 0) { const ms = Math.min(remaining, 17239); const next = advance(segmented, ms); const report = summarize(segmented, next, ms);
      for (const f of FLOWS) for (const r of RESOURCES) combined[f][r] += report.flows[f][r]; segmented = next; remaining -= ms;
    }
    expect(segmented).toEqual(one); expect(combined).toEqual(one.ledger); assertInvariants(one);
  });
  it('UT-12: subsecond remainder is preserved; clock reversal cannot duplicate time', () => {
    let s = advance(createGame(10000), 600); expect(s.clock.seconds).toBe(0); expect(s.clock.remainderMs).toBe(600);
    s = advance(s, 500); expect(s.clock.seconds).toBe(1); expect(s.clock.remainderMs).toBe(100);
    expect(advanceTo(s, 9000)).toEqual(s);
    expect(advanceTo(s, 11000).clock.seconds).toBe(2);
    expect(() => advance(s, Infinity)).toThrow();
  });
  it.each([3600, 86400, 604800])('UT-13/FR-10: %i seconds of offline production reconcile exact report flows', seconds => {
    const s = act(ready(), { type: 'enqueue', definition: 'R01' });
    const after = advance(s, seconds * 1000), report = summarize(s, after, seconds * 1000);
    for (const r of RESOURCES) expect(report.end[r]).toBe(report.start[r] + report.flows.production[r] + report.flows.rewards[r] + report.flows.refunds[r] - report.flows.operating[r] - report.flows.reserved[r]);
    expect(report.completed).toContain('R01'); expect(report.seconds).toBe(seconds); expect(report.reasons.length).toBeGreaterThan(0); assertInvariants(after);
    expect(decodeSave(encodeSave({ ...after, report }, 0)).state.report).toEqual(report);
  });
  it('UT-14: invalid versions, resources, queue states, population and earned counters are rejected', () => {
    const valid = JSON.parse(encodeSave(ready(), 123));
    for (const mutate of [
      (s: typeof valid) => { s.schemaVersion = 99; },
      (s: typeof valid) => { s.balanceVersion = 'future'; },
      (s: typeof valid) => { s.state.resources.parts = -1; },
      (s: typeof valid) => { s.state.resources.parts = 999999999; },
      (s: typeof valid) => { s.state.earned.memory++; },
      (s: typeof valid) => { s.state.population.shadow = 8; },
      (s: typeof valid) => { s.state.assignments.shadow.power = 9; },
      (s: typeof valid) => { s.state.completed.push('R99'); },
      (s: typeof valid) => { s.state.clock.remainderMs = 1000; }
    ]) { const broken = structuredClone(valid); mutate(broken); expect(() => decodeSave(JSON.stringify(broken))).toThrow(); }
    expect(decodeSave(JSON.stringify(valid)).state).toEqual(ready()); expect(() => decodeSave('{')).toThrow();
  });
});
