import { preFreight } from '../legacy-shape';
import { readFileSync } from 'node:fs';
import { setImmediate } from 'node:timers/promises';
import { describe, expect, it } from 'vitest';
import { amounts, JOBS, RESIDENTS, RESOURCES, UNIT } from '../../src/game/config';
import { activeDistricts, dismantleReason, districtState } from '../../src/game/city';
import { advance, applyAction, capacities, chapterProofs, freeResidents, legacyChapterReady, summarize, unlockReason } from '../../src/game/engine';
import { awayWorkers } from '../../src/game/network';
import { pendingStories } from '../../src/game/experience';
import { blueprintSources, COMMISSION_GROUPS, COMMISSION_IDS, createNeighborhood, FIELD_IDS, FIELD_SITES, fieldClueKnown, fieldRefund, heldFieldSupplies } from '../../src/game/neighborhood';
import { assertInvariants, decodeSave, encodeSave } from '../../src/game/saves';
import type { Action, CommissionStage, FieldSite, GameState, Resource } from '../../src/game/types';

const fixture = (v: string) => readFileSync(new URL(`../fixtures/v${v}-chapter.json`, import.meta.url), 'utf8');
function act(s: GameState, action: Action) { const r = applyAction(s, action); expect(r.error, JSON.stringify(action)).toBeNull(); assertInvariants(r.state); return r.state; }
function stock(s: GameState, resource: Resource, value: number) {
  const delta = value - s.resources[resource]; s.resources[resource] = value;
  if (delta >= 0) { s.ledger.production[resource] += delta; s.earned[resource] += delta; } else s.ledger.operating[resource] -= delta;
}
function base(v = '0.2') {
  let s = decodeSave(fixture(v)).state;
  for (const id of activeDistricts(s)) for (const r of RESIDENTS) for (const j of JOBS) districtState(s, id)!.assignments[r][j] = 0;
  s.assignments.shadow.power = 1;
  for (const [r, n] of [['energy', 100000], ['parts', 120000], ['memory', 30000], ['component', 15000]] as const) stock(s, r, n);
  if (!s.experience.story['L01-1']) s = act(s, { type: 'story', node: 'L01-1' });
  return s;
}
function deliver(s: GameState, stage: CommissionStage) { return act(act(s, { type: 'commission-track', stage }), { type: 'commission-deliver', stage }); }
function visit(s: GameState, site: FieldSite, kind: 'first' | 'clue' | 'supply', choice?: 'a' | 'b') {
  s = act(s, { type: 'field-start', site, kind, district: 'district-0', resident: 'shadow' });
  s = advance(s, FIELD_SITES[site].seconds * 1000); assertInvariants(s);
  const p = s.neighborhood.field.pending.find(p => p.site === site)!;
  return act(s, { type: 'field-claim', uid: p.uid, ...(choice ? { choice } : {}) });
}
function delegateReady() {
  let s = deliver(base(), 'CM03-1'); s.assignments.echo.repair = 1;
  s = act(s, { type: 'enqueue', definition: 'mailmod:dispatchBox' }); s = advance(s, 90000); assertInvariants(s);
  expect(s.neighborhood.mailboxes['district-0'].active).toBeNull();
  return act(s, { type: 'mailbox-mod', district: 'district-0', mod: 'dispatchBox' });
}

describe('V0.3.2 commissions, people and finite field results', () => {
  it('UX09/13: completes all nine different stages and four L02 nodes without auto-accepting or repeating rewards', () => {
    expect(COMMISSION_GROUPS).toHaveLength(6); expect(COMMISSION_IDS).toHaveLength(18);
    let s = base(); const before = structuredClone(s);
    s = act(s, { type: 'story', node: 'L01-2', choice: 'dismantle' }); s = act(s, { type: 'story', node: 'L01-3' });
    for (const id of ['CM01-1', 'CM02-1', 'CM03-1'] as CommissionStage[]) s = deliver(s, id);
    expect(s.neighborhood.commissions.tracked).toEqual([]);
    for (const id of ['F01', 'F03', 'F04'] as FieldSite[]) { s = visit(s, id, 'first', 'b'); s = visit(s, id, 'clue'); }
    for (const id of ['CM01-2', 'CM02-2', 'CM03-2', 'CM01-3', 'CM02-3'] as CommissionStage[]) s = deliver(s, id);
    for (const node of ['L02-1', 'L02-2', 'L02-3', 'L02-4'] as const) s = act(s, { type: 'story', node });
    s = deliver(s, 'CM03-3');
    expect(s.neighborhood.commissions.completed).toHaveLength(9); expect(pendingStories(s)).toContain('L01-4');
    expect(s.neighborhood.commissions.tracked).toEqual([]);
    const replay = applyAction(s, { type: 'commission-deliver', stage: 'CM03-3' }); expect(replay.error).toBeTruthy(); expect(replay.state).toEqual(s);
    expect(blueprintSources(s, 'dispatchBox')).toEqual(expect.arrayContaining(['CM03-1 邮递员', 'L02-3 邮递员']));
    expect(s.ledger.fulfillment.parts - before.ledger.fulfillment.parts).toBe(9000);
    expect(decodeSave(encodeSave(s, 0)).state).toEqual(s);
  });
  it('UX09: tracking is free and reward-space failure leaves the entire stage, inventory and ledgers intact', () => {
    let s = base(); const resources = { ...s.resources };
    s = act(s, { type: 'commission-track', stage: 'CM01-1' }); expect(s.resources).toEqual(resources);
    s = act(s, { type: 'commission-untrack', stage: 'CM01-1' }); expect(s.resources).toEqual(resources);
    s = deliver(s, 'CM01-1'); s = visit(visit(s, 'F01', 'first', 'a'), 'F01', 'clue');
    s = act(s, { type: 'commission-track', stage: 'CM01-2' }); stock(s, 'memory', capacities(s).memory);
    expect(applyAction(s, { type: 'commission-deliver', stage: 'CM01-2' })).toEqual({ state: s, error: '整份奖励所需仓储空间不足' });
    stock(s, 'memory', capacities(s).memory - 4000); const done = act(s, { type: 'commission-deliver', stage: 'CM01-2' });
    expect(done.resources.memory).toBe(capacities(s).memory); expect(done.neighborhood.commissions.tracked).toEqual([]);
    expect(applyAction(done, { type: 'commission-track', stage: 'CM04-1' }).state).toEqual(done);
  });
  it.each(FIELD_IDS.slice(0, 4).flatMap(site => (['a', 'b'] as const).map(choice => [site, choice] as const)))('UX10: %s first branch %s is explicit, atomic and retains its choice', (site, choice) => {
    let s = base(), initial = s.resources.component;
    s = act(s, { type: 'field-start', site, kind: 'first', district: 'district-0', resident: 'shadow' });
    expect(freeResidents(s, 'shadow')).toBe(s.population.shadow - 2);
    const bad = applyAction(s, { type: 'field-start', site, kind: 'first', district: 'district-0', resident: 'echo' }); expect(bad.state).toEqual(s);
    s = advance(s, FIELD_SITES[site].seconds * 1000); assertInvariants(s);
    expect(s.neighborhood.field.sites[site].first).toBeNull(); expect(s.neighborhood.field.active).toBeNull();
    const uid = s.neighborhood.field.pending[0].uid;
    expect(applyAction(s, { type: 'field-claim', uid }).state).toEqual(s);
    s = act(s, { type: 'field-claim', uid, choice }); expect(s.neighborhood.field.sites[site].first).toBe(choice);
    expect(applyAction(s, { type: 'field-claim', uid, choice }).state).toEqual(s);
    if (site === 'F03' && choice === 'b') expect(s.resources.component).toBe(initial - UNIT);
    s = visit(s, site, 'supply'); expect(s.neighborhood.field.sites[site].supplies).toBe(1);
    expect(decodeSave(encodeSave(s, 0)).state).toEqual(s);
  });
  it('UX10: preserves a full first-visit package and checks the extra branch component only at confirmation', () => {
    let s = base(); s = act(s, { type: 'field-start', site: 'F03', kind: 'first', district: 'district-0', resident: 'shadow' }); s = advance(s, 180000);
    stock(s, 'component', 0); const uid = s.neighborhood.field.pending[0].uid;
    expect(applyAction(s, { type: 'field-claim', uid, choice: 'b' }).state).toEqual(s);
    stock(s, 'parts', capacities(s).parts); const old = structuredClone(s);
    expect(applyAction(s, { type: 'field-claim', uid, choice: 'a' }).state).toEqual(old);
    stock(s, 'component', 1000); s = act(s, { type: 'field-claim', uid, choice: 'b' });
    expect(s.resources.parts).toBe(capacities(s).parts); // Pure knowledge succeeds at full stores.
  });
  it('UX10: four finite clues have reachable sources and cannot be farmed', () => {
    let s = base(); s = act(s, { type: 'story', node: 'L02-1' });
    for (const id of ['CM01-1', 'CM02-1', 'CM03-1'] as CommissionStage[]) s = deliver(s, id);
    for (const id of FIELD_IDS.slice(0, 4)) {
      expect(fieldClueKnown(s, id)).toBe(true); s = visit(visit(s, id, 'first', 'b'), id, 'clue');
      expect(applyAction(s, { type: 'field-start', site: id, kind: 'clue', district: 'district-0', resident: 'shadow' }).state).toEqual(s);
    }
    expect(blueprintSources(s, 'voiceBox')).toEqual(['F04 首访', 'F02 半层回信']);
  });
  it('UX10/01: field people cannot also fill jobs, staff routes, relocate or apply a full-person template', () => {
    let s = base('0.3');
    for (const r of RESIDENTS) for (const j of JOBS) s.assignments[r][j] = 0;
    s.assignments.shadow.power = s.population.shadow - awayWorkers(s, 'district-0', 'shadow') - 1; s.assignments.shadow.salvage = 1;
    s = act(s, { type: 'template-save', district: 'district-0', name: '全员' });
    s = act(s, { type: 'assign', resident: 'shadow', job: 'salvage', delta: -1 });
    s = act(s, { type: 'field-start', site: 'F01', kind: 'first', district: 'district-0', resident: 'shadow' });
    for (const action of [
      { type: 'assign', resident: 'shadow', job: 'salvage', delta: 1 },
      { type: 'network-staff', route: 'rain', district: 'district-0', resident: 'shadow', delta: 1 },
      { type: 'relocate', resident: 'shadow', from: 'district-0', to: 'district-1' },
      { type: 'template-apply', name: '全员' }
    ] as Action[]) expect(applyAction(s, action).state).toEqual(s);
    const returned = advance(s, 90000); expect(freeResidents(returned, 'shadow')).toBe(1); assertInvariants(returned);
  });
  it.each([0, 1000, 45500])('UX10: recall at %i ms conserves whole unused supplies, pending refunds and earned totals', ms => {
    let s = act(base(), { type: 'field-start', site: 'F01', kind: 'first', district: 'district-0', resident: 'shadow' });
    s = advance(s, ms); stock(s, 'parts', capacities(s).parts); stock(s, 'energy', capacities(s).energy);
    const expected = fieldRefund(s), earned = { ...s.earned }, reserved = { ...s.ledger.fieldReserved };
    s = act(s, { type: 'field-recall' }); expect(s.earned).toEqual(earned); expect(s.neighborhood.field.active).toBeNull();
    expect(s.neighborhood.field.pending[0]).toMatchObject({ kind: 'refund', refund: expected });
    expect(heldFieldSupplies(s)).toEqual(expected);
    expect(decodeSave(encodeSave(s, 0)).state).toEqual(s);
    for (const r of RESOURCES) stock(s, r, Math.max(0, s.resources[r] - expected[r]));
    const before = structuredClone(s); s = act(s, { type: 'field-claim', uid: s.neighborhood.field.pending[0].uid });
    expect(s.earned).toEqual(before.earned); expect(s.ledger.fieldReserved).toEqual(reserved); expect(heldFieldSupplies(s)).toEqual(amounts());
    for (const r of RESOURCES) expect(s.resources[r] - before.resources[r]).toBe(expected[r]);
  });
  it('UX10: reserves result space, blocks unresolved sites and runs at most three explicit known revisits', () => {
    let s = base(); for (const id of ['F01', 'F02', 'F03'] as FieldSite[]) s = visit(s, id, 'first', 'b');
    const orders = ['F01', 'F02', 'F03'].map(site => ({ site: site as FieldSite, district: 'district-0' as const, resident: 'shadow' as const }));
    expect(applyAction(s, { type: 'field-queue', orders: [...orders, orders[0]] }).state).toEqual(s);
    s = act(s, { type: 'field-queue', orders }); s = advance(s, 393000); assertInvariants(s);
    expect(s.neighborhood.field.pending).toHaveLength(3); expect(s.neighborhood.field.queue).toEqual([]); expect(s.neighborhood.field.active).toBeNull();
    expect(applyAction(s, { type: 'field-start', site: 'F04', kind: 'first', district: 'district-0', resident: 'shadow' }).state).toEqual(s);
    s = act(s, { type: 'field-queue', orders: [orders[0]] }); expect(advance(s, 1000).neighborhood.field.queue).toHaveLength(1);
    s = act(s, { type: 'field-claim', uid: s.neighborhood.field.pending[0].uid }); s = advance(s, 1000);
    expect(s.neighborhood.field.active?.site).toBe('F01'); expect(s.neighborhood.field.queue).toEqual([]);
  });
});

describe('V0.3.2 mailbox, delegation and second-chapter compatibility', () => {
  it('UX11: automatic clear-list execution is one stage per second, stops at reserves and never accepts a successor', () => {
    let s = delegateReady();
    for (const stage of ['CM01-1', 'CM02-1', 'CM03-2'] as CommissionStage[]) s = act(s, { type: 'commission-track', stage });
    const stages = [...s.neighborhood.commissions.tracked];
    const future = applyAction(s, { type: 'delegate-plan', district: 'district-0', stages: ['CM01-2'], reserve: amounts() }); expect(future.state).toEqual(s);
    s = act(s, { type: 'delegate-plan', district: 'district-0', stages, reserve: { ...s.resources } });
    expect(advance(s, 1000).neighborhood.delegation.deliveries).toBe(0);
    s = act(s, { type: 'delegate-plan', district: 'district-0', stages, reserve: amounts(10001, 20001, 5001, 1) });
    s = advance(s, 1000); expect(s.neighborhood.delegation.deliveries).toBe(1); expect(s.neighborhood.delegation.stages).toEqual(stages.slice(1)); assertInvariants(s);
    s = advance(s, 1000); expect(s.neighborhood.delegation.deliveries).toBe(2); expect(s.neighborhood.delegation.stages).toEqual(['CM03-2']);
    const after = advance(s, 900000); expect(after.neighborhood.delegation.deliveries).toBe(2); expect(after.neighborhood.commissions.tracked).toEqual(['CM03-2']);
    expect(after.experience.story['L02-1']).toBeUndefined(); assertInvariants(after);
    const manual = act(s, { type: 'delegate-pause' }); expect(manual.neighborhood.delegation.reserve).toEqual(s.neighborhood.delegation.reserve);
    const stopped = advance(manual, 1000); expect(stopped.neighborhood.delegation.stages).toEqual(manual.neighborhood.delegation.stages);
  });
  it('UX11: manual delivery ignores automatic reserves; untracking removes its saved list entry', () => {
    let s = delegateReady(); s = act(s, { type: 'commission-track', stage: 'CM01-1' });
    s = act(s, { type: 'delegate-plan', district: 'district-0', stages: ['CM01-1'], reserve: { ...s.resources } });
    s = act(s, { type: 'commission-deliver', stage: 'CM01-1' }); expect(s.neighborhood.delegation.stages).toEqual([]); expect(s.neighborhood.delegation.deliveries).toBe(0);
    s = act(s, { type: 'commission-track', stage: 'CM02-1' }); s = act(s, { type: 'delegate-plan', district: 'district-0', stages: ['CM02-1'], reserve: amounts() });
    s = act(s, { type: 'commission-untrack', stage: 'CM02-1' }); expect(s.neighborhood.delegation.stages).toEqual([]);
  });
  it('UX11: disabled modification and missing light pause an unchanged explicit list', () => {
    let s = delegateReady(); s = act(s, { type: 'commission-track', stage: 'CM01-1' }); s = act(s, { type: 'delegate-plan', district: 'district-0', stages: ['CM01-1'], reserve: amounts() });
    const disabled = act(s, { type: 'mailbox-mod', district: 'district-0', mod: null }); expect(advance(disabled, 1000).neighborhood.delegation.stages).toEqual(['CM01-1']);
    for (const id of activeDistricts(s)) for (const r of RESIDENTS) districtState(s, id)!.assignments[r].power = 0;
    stock(s, 'energy', 0); const dark = advance(s, 1000); expect(dark.neighborhood.delegation.deliveries).toBe(0); expect(dark.neighborhood.delegation.stages).toEqual(['CM01-1']); assertInvariants(dark);
  });
  it('UX04/11: voice box changes real output and parts use, without stacking or changing base energy', () => {
    let s = visit(base(), 'F04', 'first', 'b'); s.assignments.echo.repair = 1;
    s = act(s, { type: 'enqueue', definition: 'mailmod:voiceBox' }); s = advance(s, 90000);
    s.assignments.echo.repair = 0; s.assignments.echo.record = 1;
    const before = advance(s, 1000), active = act(s, { type: 'mailbox-mod', district: 'district-0', mod: 'voiceBox' }), after = advance(active, 1000);
    expect(after.resources.memory - s.resources.memory).toBeGreaterThan(before.resources.memory - s.resources.memory);
    expect(after.ledger.operating.parts - s.ledger.operating.parts).toBe(45); expect(before.ledger.operating.parts - s.ledger.operating.parts).toBe(30);
    expect(after.ledger.operating.energy - s.ledger.operating.energy).toBe(before.ledger.operating.energy - s.ledger.operating.energy); assertInvariants(after);
    expect(applyAction(active, { type: 'enqueue', definition: 'mailmod:voiceBox' }).state).toEqual(active);
  });
  it.each(['waiting', 'running', 'paused'] as const)('UX10/19: a %s mailbox project blocks removal and ownership survives rebuilding', status => {
    let s = visit(base(), 'F04', 'first', 'b'); s.assignments.echo.repair = 1;
    s = act(s, { type: 'enqueue', definition: 'mailmod:voiceBox', district: 'district-2' });
    if (status !== 'waiting') s = advance(s, 1000);
    if (status === 'paused') s = act(s, { type: 'pause', uid: s.queue[0].uid });
    expect(dismantleReason(s, 'district-2', 'mailbox')).toContain('未完成');
    s = act(s, { type: 'cancel', uid: s.queue[0].uid }); expect(dismantleReason(s, 'district-2', 'mailbox')).toBeNull();
    s = act(s, { type: 'enqueue', definition: 'mailmod:voiceBox', district: 'district-2' }); s = advance(s, 90000);
    s = act(s, { type: 'mailbox-mod', district: 'district-2', mod: 'voiceBox' });
    s = act(s, { type: 'dismantle', district: 'district-2', facility: 'mailbox' }); expect(s.neighborhood.mailboxes['district-2']).toEqual({ built: ['voiceBox'], active: null });
    s = act(s, { type: 'enqueue', definition: 'build:mailbox', district: 'district-2' }); s = advance(s, 150000); s = act(s, { type: 'mailbox-mod', district: 'district-2', mod: 'voiceBox' }); expect(s.neighborhood.mailboxes['district-2'].active).toBe('voiceBox');
  });
  it('UX12: a full specialized output store proves production with staff; cooperation is a real alternative', () => {
    let s = base();
    expect(chapterProofs(s).production).toBe(false); s.city.districts['district-1']!.assignments.shadow.salvage = 1;
    stock(s, 'parts', capacities(s).parts); stock(s, 'energy', 0); s.assignments.shadow.power = 1;
    expect(chapterProofs(s).production).toBe(true);
    s.city.districts['district-1']!.assignments.shadow.salvage = 0; stock(s, 'energy', 100000);
    s = deliver(deliver(s, 'CM02-1'), 'CM03-1'); expect(chapterProofs(s).cooperation).toBe(true); expect(chapterProofs(s).production).toBe(false);
    s.completed = s.completed.filter(id => id !== 'P07'); delete s.events.E10;
    expect(unlockReason(s, 'P07')).toBeNull();
    s.assignments.shadow.power = 0; stock(s, 'energy', 0); expect(unlockReason(s, 'P07')).toContain('照明');
  });
  it.each(['P06', 'P07'] as const)('UX12/05: a genuine old queued %s gains a narrow compatibility flag, preserving reservations and time', id => {
    // Derive a legal pre-0.3.2 queue from the genuine chapter fixture; retain its
    // original content shape, then explicitly remove only the later chapter.
    const old = JSON.parse(fixture('0.2'));
    old.state.completed = old.state.completed.filter((key: string) => id === 'P06' ? !['P06', 'P07'].includes(key) : key !== 'P07');
    delete old.state.events.E10; if (id === 'P06') delete old.state.events.E09;
    old.state.queue = [{ uid: 'q-99', definition: id, district: 'district-0', targetLevel: 1, status: 'waiting', progress: 0, reserved: { energy: 0, parts: 0, memory: 0 } }]; old.state.nextProject = 100;
    let s = decodeSave(JSON.stringify(old)).state; expect(s.queue[0].legacyChapter).toBe(true); expect(legacyChapterReady(s, id)).toBe(true);
    s.publicWorks.relay.enabled = false; s.publicWorks.registry.enabled = false;
    for (const branch of ['district-1', 'district-2'] as const) for (const r of RESIDENTS) s.city.districts[branch]!.assignments[r].salvage = s.city.districts[branch]!.assignments[r].record = 0;
    s = advance(s, 900000); expect(s.completed).toContain(id); assertInvariants(s);
  });
});

describe('V0.3.2 source-version validation, report and elapsed-time equivalence', () => {
  it.each(['0.1', '0.2', '0.3', '0.3.1'])('UX05/19: genuine %s migration preserves old simulation state and starts new work disabled', version => {
    const raw = JSON.parse(fixture(version)), loaded = decodeSave(fixture(version));
    expect(loaded.schemaVersion).toBe(9); expect(loaded.balanceVersion).toBe('0.6.0');
    expect(loaded.migratedFrom).toBe(version === '0.3.1' ? 4 : Number(version.split('.')[1]));
    expect(loaded.state.resources).toEqual({ ...raw.state.resources, component: raw.state.resources.component ?? 0, rainFilm: 0, railCore: 0 });
    expect(loaded.state.neighborhood).toEqual(createNeighborhood());
    if (version === '0.3.1') expect(preFreight(loaded.state.experience)).toEqual(raw.state.experience);
    expect(decodeSave(encodeSave(loaded.state, 0)).state).toEqual(loaded.state);
  });
  it('UX05/19: rejects hidden new content, forged field packages, double-used residents and false discoveries', () => {
    const old = JSON.parse(fixture('0.3.1')); old.state.neighborhood = createNeighborhood(); expect(() => decodeSave(JSON.stringify(old))).toThrow('旧版');
    const valid = encodeSave(act(base(), { type: 'field-start', site: 'F01', kind: 'first', district: 'district-0', resident: 'shadow' }), 0);
    const mutations = [
      (s: GameState) => { s.neighborhood.field.active!.reserved.parts += 1; },
      (s: GameState) => { s.neighborhood.field.active!.remaining = 91; },
      (s: GameState) => { s.neighborhood.field.nextTrip = 1; },
      (s: GameState) => { s.neighborhood.field.sites.F02.clue = true; },
      (s: GameState) => { s.neighborhood.field.pending.push({ uid: 'f-1', site: 'F01', kind: 'first' }); },
      (s: GameState) => { s.assignments.shadow.salvage = 2; },
      (s: GameState) => { s.experience.blueprints.push('voiceBox'); }
    ];
    for (const mutate of mutations) { const bad = JSON.parse(valid); mutate(bad.state); expect(() => decodeSave(JSON.stringify(bad))).toThrow(); }
  });
  // Hosted runners took 69s for this same finite week after files were serialized.
  for (const seconds of [900, 86400, 604800]) it(`UX08/11/18/20: ${seconds} seconds match irregular segments, preserve pending choices and reconcile held supplies`, async () => {
    // Let Vitest receive worker messages between CPU-bound simulations on CI.
    await setImmediate();
    let s = delegateReady(); s = act(s, { type: 'commission-track', stage: 'CM01-1' }); s = act(s, { type: 'delegate-plan', district: 'district-0', stages: ['CM01-1'], reserve: amounts() });
    s = act(s, { type: 'field-start', site: 'F02', kind: 'first', district: 'district-0', resident: 'shadow' });
    const one = advance(s, seconds * 1000);
    await setImmediate();
    let segmented = s, left = seconds * 1000;
    for (const size of [123, 997, 4011, 17003, 30137]) { if (left <= 0) break; const n = Math.min(size, left); segmented = advance(segmented, n); left -= n; }
    segmented = advance(segmented, left); expect(segmented).toEqual(one); assertInvariants(one);
    expect(one.neighborhood.field.sites.F02.first).toBeNull(); expect(one.neighborhood.field.pending).toHaveLength(1); expect(one.neighborhood.delegation.deliveries).toBe(1);
    const report = summarize(s, one, seconds * 1000); expect(report.neighborhood).toMatchObject({ fieldReturns: 1, deliveries: 1, pending: 1 });
    for (const r of RESOURCES) expect(report.end[r]).toBe(report.start[r] + report.flows.production[r] + report.flows.rewards[r] + report.flows.refunds[r] + report.flows.imports[r] - report.flows.exports[r] - report.flows.operating[r] - report.flows.reserved[r] - report.flows.fulfillment[r] - report.flows.fieldReserved[r]);
    one.report = report; expect(decodeSave(encodeSave(one, 0)).state).toEqual(one);
  }, process.env.CI === 'true' && seconds === 604800 ? 180000 : 60000);
});
