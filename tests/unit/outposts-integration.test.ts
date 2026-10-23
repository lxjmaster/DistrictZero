import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { amounts, JOBS, RESIDENTS, RESOURCES } from '../../src/game/config';
import { activeDistricts, districtState, localCount } from '../../src/game/city';
import { activateNetworkRules, advance, applyAction, freeResidents, projectDefinition, refundPreview, summarize, view } from '../../src/game/engine';
import { pendingStories } from '../../src/game/experience';
import { outpostCapacities, outpostLimits, outpostWorkers } from '../../src/game/outposts';
import { assertInvariants, decodeSave, encodeSave } from '../../src/game/saves';
import type { Action, GameState, OutpostId, Resource } from '../../src/game/types';

function act(s: GameState, action: Action) {
  const result = applyAction(s, action);
  expect(result.error, JSON.stringify(action)).toBeNull(); assertInvariants(result.state); return result.state;
}
function prepared() {
  let s = decodeSave(readFileSync(new URL('../fixtures/v0.3.3-chapter.json', import.meta.url), 'utf8')).state;
  for (const id of ['rain', 'station'] as const) { s = act(s, { type: 'contract-pause', route: id }); s = act(s, { type: 'route-auto', route: id, enabled: false }); }
  for (const id of activeDistricts(s)) s = act(s, { type: 'auto-repair', district: id, enabled: false });
  s = act(s, { type: 'story', node: 'L04-1' }); s = act(s, { type: 'enqueue', definition: 'P12' }); s = advance(s, 500000);
  expect(s.completed).toContain('P12'); s = act(s, { type: 'story', node: 'L04-2' });
  for (const id of activeDistricts(s)) for (const resident of RESIDENTS) for (const job of JOBS) {
    while (districtState(s, id)!.assignments[resident][job]) s = act(s, { type: 'assign', district: id, resident, job, delta: -1 });
  }
  return s;
}
function open(s: GameState, id: OutpostId = 'O01') {
  return act(s, { type: 'outpost-open', outpost: id, crew: [{ district: 'district-1', resident: 'shadow' }, { district: 'district-1', resident: 'shadow' }] });
}
function fill(s: GameState, id: OutpostId) {
  const d = s.outposts.sites[id]!, limits = outpostLimits(s, id);
  for (const r of RESOURCES) { const delta = limits[r] - d.resources[r]; d.resources[r] += delta; d.earned[r] += delta; d.ledger.production[r] += delta; }
  assertInvariants(s); return s;
}
function localJobs(s: GameState) {
  s = act(s, { type: 'outpost-assign', resident: 'shadow', job: 'power', delta: 1 });
  return act(s, { type: 'outpost-assign', resident: 'shadow', job: 'repair', delta: 1 });
}

describe('V0.4 integration boundaries', () => {
  it('B01: P12 and L04 wait for explicit confirmation and retain optional home assembly independence', () => {
    let s = decodeSave(readFileSync(new URL('../fixtures/v0.3-chapter.json', import.meta.url), 'utf8')).state;
    s = activateNetworkRules(s, s.clock.lastAt);
    // Isolate the unlock boundary, not an economic playthrough: seed exactly
    // P12's two components into this genuine pre-assembly chapter state.
    s.resources.component += 2000; s.earned.component += 2000; s.ledger.production.component += 2000;
    expect(applyAction(s, { type: 'enqueue', definition: 'P12' }).error).not.toBeNull();
    for (const node of ['L03-1', 'L03-2', 'L03-3', 'L03-4', 'L04-1'] as const) s = act(s, { type: 'story', node });
    for (const route of ['rain', 'station'] as const) s = act(s, { type: 'contract-pause', route });
    s = act(s, { type: 'enqueue', definition: 'P12' }); s = advance(s, 500000);
    expect(s.completed).toContain('P12'); expect(s.experience.story['L04-2']).toBeUndefined();
    s = act(s, { type: 'story', node: 'L04-2' });
    for (const resident of RESIDENTS) for (const job of JOBS) while (s.city.districts['district-1']!.assignments[resident][job]) s = act(s, { type: 'assign', district: 'district-1', resident, job, delta: -1 });
    s = open(s); expect(s.outposts.sites.O01!.assembly.enabled).toBe(false);
    s = act(s, { type: 'outpost-assign', resident: 'shadow', job: 'assemble', delta: 1 });
    s = act(s, { type: 'outpost-assembly', enabled: true, target: 1000, reserve: amounts() });
    const after = advance(s, 1000);
    expect(after.outposts.sites.O01!.resources.component).toBeGreaterThan(0);
    expect(after.experience.story['L01-1']).toBeUndefined(); expect(after.experience.story['L04-3']).toBeUndefined();
    expect(pendingStories(after)).not.toContain('L04-3'); assertInvariants(after);
  });

  it('B03: home templates, local jobs, relocation, route staff and field work share the same occupied people', () => {
    let s = prepared();
    for (let i = 0; i < 3; i++) s = act(s, { type: 'assign', district: 'district-1', resident: 'shadow', job: 'salvage', delta: 1 });
    s = act(s, { type: 'template-save', district: 'district-1', name: '全巷回收' });
    for (let i = 0; i < 3; i++) s = act(s, { type: 'assign', district: 'district-1', resident: 'shadow', job: 'salvage', delta: -1 });
    const population = localCount(s.city.districts['district-1']!); s = open(s);
    expect(freeResidents(s, 'shadow', 'district-1')).toBe(2);
    expect(localCount(s.city.districts['district-1']!)).toBe(population);
    expect(applyAction(s, { type: 'template-apply', name: '全巷回收' }).state).toEqual(s);
    for (let i = 0; i < 2; i++) s = act(s, { type: 'assign', district: 'district-1', resident: 'shadow', job: 'salvage', delta: 1 });
    const attempts: Action[] = [
      { type: 'assign', district: 'district-1', resident: 'shadow', job: 'salvage', delta: 1 },
      { type: 'relocate', resident: 'shadow', from: 'district-1', to: 'district-0' },
      { type: 'field-start', site: 'F01', kind: 'supply', district: 'district-1', resident: 'shadow' },
      { type: 'dismantle', district: 'district-1', facility: 'dorm' }
    ];
    s = act(s, { type: 'network-staff', route: 'rain', district: 'district-0', resident: 'shadow', delta: -1 });
    attempts.push({ type: 'network-staff', route: 'rain', district: 'district-1', resident: 'shadow', delta: 1 });
    for (const action of attempts) { const failed = applyAction(s, action); expect(failed.error).not.toBeNull(); expect(failed.state).toEqual(s); }
    const after = advance(s, 900000); expect(localCount(after.city.districts['district-1']!)).toBe(population);
    const sealed = act(after, { type: 'outpost-seal', confirmClear: true }); expect(freeResidents(sealed, 'shadow', 'district-1')).toBe(2);
  });

  it.each(['home', 'outpost'] as const)('B05: fixed %s head prevents the other scope working in the completion second', first => {
    let s = localJobs(fill(open(prepared()), 'O01'));
    s = act(s, { type: 'assign', resident: 'echo', job: 'repair', delta: 1 });
    const home: Action = { type: 'enqueue', definition: 'build:generator' }, local: Action = { type: 'outpost-enqueue', definition: 'O01-1' };
    s = act(act(s, first === 'home' ? home : local), first === 'home' ? local : home);
    s = advance(s, 1000); const head = s.queue[0]; expect(head.status).toBe('running');
    head.progress = projectDefinition(s, head).work - 1;
    const next = advance(s, 1000);
    expect(next.queue).toHaveLength(1); expect(next.queue[0]).toMatchObject({ status: 'waiting', progress: 0, reserved: amounts() });
    expect(next.completed).toContain(first === 'home' ? 'build:generator:3' : 'O01@O01-1');
    const following = advance(next, 1000); expect(following.queue[0].progress).toBeGreaterThan(0);
    expect(following.queue[0].outpost ?? null).toBe(first === 'home' ? 'O01' : null); assertInvariants(following);
  });

  it('B05: a paused outpost blocks automatic home work and refunds only its remaining local resources', () => {
    let s = localJobs(fill(open(prepared()), 'O01'));
    s = act(s, { type: 'outpost-enqueue', definition: 'O01-1', prefab: 1 }); s = advance(s, 5000);
    const uid = s.queue[0].uid; s = act(s, { type: 'pause', uid });
    s = act(s, { type: 'assign', resident: 'echo', job: 'repair', delta: 1 });
    s = act(s, { type: 'auto-repair', district: 'district-0', enabled: true });
    s.publicWorks.relay.condition = 1; s = advance(s, 1000);
    expect(s.queue[0].uid).toBe(uid); expect(s.queue.some(p => p.definition === 'maintain:relay')).toBe(true);
    const stopped = advance(s, 5000); expect(stopped.queue.map(p => p.progress)).toEqual(s.queue.map(p => p.progress));
    const homeBefore = { ...stopped.resources }, earned = { ...stopped.outposts.sites.O01!.earned }, refunds = refundPreview(stopped, stopped.queue[0]);
    const next = act(stopped, { type: 'cancel', uid }); expect(next.resources).toEqual(homeBefore); expect(next.outposts.sites.O01!.earned).toEqual(earned);
    for (const r of RESOURCES) expect(next.outposts.sites.O01!.resources[r] - stopped.outposts.sites.O01!.resources[r]).toBe(refunds.actual[r]);
    expect(applyAction(next, { type: 'cancel', uid }).error).not.toBeNull();
  });

  it('B07/B11: support does not enter night-network ledgers and return reports reconcile every scope', () => {
    let s = open(prepared(), 'O02');
    s = act(s, { type: 'support-plan', enabled: true, queue: ['light'], reserve: amounts() });
    const start = structuredClone(s), next = advance(s, 61000), report = summarize(start, next, 61000);
    const local = report.outposts!.find(x => x.id === 'O02')!;
    expect(report.flows.supportSent.energy).toBe(40000); expect(local.flows.supportReceived.energy).toBe(40000);
    expect(next.ledger.exports).toEqual(start.ledger.exports); expect(next.ledger.imports).toEqual(start.ledger.imports);
    const signed = (flows: typeof report.flows, r: Resource) => flows.production[r] + flows.rewards[r] + flows.refunds[r] + flows.imports[r] + flows.supportReceived[r] - flows.operating[r] - flows.reserved[r] - flows.exports[r] - flows.fulfillment[r] - flows.fieldReserved[r] - flows.supportSent[r];
    for (const r of RESOURCES) { expect(report.end[r] - report.start[r]).toBe(signed(report.flows, r)); expect(local.end[r] - local.start[r]).toBe(signed(local.flows, r)); }
    next.report = report; expect(decodeSave(encodeSave(next, next.clock.lastAt)).state).toEqual(next);
    const sealed = act(next, { type: 'outpost-seal', confirmClear: true }), after = advance(sealed, 900000);
    expect(after.outposts.sites.O02).toEqual(sealed.outposts.sites.O02);
    const held = summarize(sealed, after, 900000).outposts![0]; expect(held.active).toBe(false); expect(held.start).toEqual(held.end);
  });

  it('B05/B07: scope estimates and capacity limits retain whole-load reservations', () => {
    let s = localJobs(fill(open(prepared()), 'O01'));
    s = act(s, { type: 'outpost-enqueue', definition: 'O01-1' });
    expect(view(s).output.repair).toBe(0); expect(view(s).projectOutput).toBeGreaterThan(0);
    expect(outpostWorkers(s, 'O01', 'repair')).toBe(1);
    expect(outpostCapacities(s, 'O01')).toEqual(amounts(80000, 80000, 24000, 6000));
    expect(s.outposts.sites.O01!.facilities).toMatchObject({ generator: 1, recycler: 1, workbench: 1, mailbox: 1 });
  });

  it.each([900000, 86400000, 604800000])('B09: %ims and remainder preserve whole-state equivalence across irregular segments', elapsed => {
    let s = localJobs(fill(open(prepared(), 'O02'), 'O02'));
    const local = s.outposts.sites.O02!;
    local.ledger.operating.energy += local.resources.energy - 20000; local.resources.energy = 20000;
    s = act(s, { type: 'assign', resident: 'echo', job: 'repair', delta: 1 });
    s = act(s, { type: 'assign', resident: 'shadow', job: 'power', delta: 1 });
    s = act(s, { type: 'outpost-enqueue', definition: 'O02-1' });
    s = act(s, { type: 'enqueue', definition: 'build:generator' });
    s = act(s, { type: 'support-plan', enabled: true, queue: ['light'], reserve: amounts() });
    s.clock.remainderMs = 731;
    const whole = advance(s, elapsed + 517);
    let split = s, remaining = elapsed + 517, index = 0;
    const intervals = [1234567, 98765, 321001, 713];
    while (remaining > 0) { const step = Math.min(remaining, intervals[index++ % intervals.length]); split = advance(split, step); remaining -= step; }
    expect(split).toEqual(whole); expect(whole.clock.remainderMs).toBe(248);
    expect(whole.completed).toContain('O02@O02-1'); expect(whole.completed).toContain('build:generator:3');
    expect(whole.outposts.sites.O02!.sent.light).toBe(1); expect(whole.outposts.support.trip).toBeNull(); assertInvariants(whole);
  }, 180000);
});
