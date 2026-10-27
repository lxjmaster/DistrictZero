// Reproducible gameplay analysis. Run with supported Node.js 22:
// node scripts/analyze-progression.mjs
// Only public engine actions and elapsed simulation time change game state.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer } from 'vite';

const root = fileURLToPath(new URL('../', import.meta.url));
const results = join(root, 'test-results');
await mkdir(results, { recursive: true });
// Every run owns a fresh directory; historical analysis evidence is never reused.
const runDirectory = process.argv[2] ? resolve(process.argv[2]) : await mkdtemp(join(results, 'analysis-run-'));
if (process.argv[2]) await mkdir(runDirectory);
const output = pathToFileURL(join(runDirectory, 'progression-analysis') + sep);
await mkdir(output);
console.log(`Analysis run directory: ${runDirectory}`);
const server = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false }, appType: 'custom' });
try {
  const engine = await server.ssrLoadModule('/src/game/engine.ts');
  const saves = await server.ssrLoadModule('/src/game/saves.ts');
  const { amounts, RESOURCES, JOBS } = await server.ssrLoadModule('/src/game/config.ts');
  const { districtState } = await server.ssrLoadModule('/src/game/city.ts');
  const outposts = await server.ssrLoadModule('/src/game/outposts.ts');
  const { covenantProof } = await server.ssrLoadModule('/src/game/covenants.ts');
  let state = engine.createGame(0);
  let chapter = 1;
  const actions = [], waits = [], checkpoints = [];
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const digest = createHash('sha256').update(await readFile(new URL(import.meta.url))).digest('hex');
  const sourceHash = createHash('sha256');
  for (const file of (await readdir(new URL('../src/game/', import.meta.url))).filter(f => f.endsWith('.ts')).sort()) {
    sourceHash.update(file).update('\0').update(await readFile(new URL(`../src/game/${file}`, import.meta.url))).update('\0');
  }
  const provenance = { commit, scriptSha256: digest, gameSourceSha256: sourceHash.digest('hex'), node: process.version };
  const act = action => {
    const result = engine.applyAction(state, action);
    assert.equal(result.error, null, `second ${state.clock.seconds}: ${JSON.stringify(action)}: ${result.error}`);
    state = result.state; saves.assertInvariants(state);
    actions.push({ second: state.clock.seconds, chapter, action });
  };
  const run = (seconds, label) => {
    const reasons = engine.view(state).reasons;
    const from = state.clock.seconds;
    state = engine.advance(state, seconds * 1000); saves.assertInvariants(state);
    waits.push({ chapter, from, seconds, label, reasons });
  };
  const until = (predicate, label, limit = 7200) => {
    let elapsed = 0;
    while (!predicate(state) && elapsed < limit) { run(10, label); elapsed += 10; }
    assert(predicate(state), `${label} after ${limit}s: ${JSON.stringify({ resources: state.resources, queue: state.queue, reasons: engine.view(state).reasons, calendar: state.calendar })}`);
  };
  const event = (event, choice) => { until(s => s.events[event]?.status === 'pending', event); act({ type: 'event', event, ...(choice ? { choice } : {}) }); };
  const story = (node, choice) => act({ type: 'story', node, ...(choice ? { choice } : {}) });
  const job = (resident, job, delta, district = 'district-0') => act({ type: 'assign', resident, job, delta, district });
  const roles = (district, desired) => {
    for (const resident of ['shadow', 'echo']) for (const j of JOBS) {
      while (districtState(state, district).assignments[resident][j] > (desired[resident]?.[j] ?? 0)) job(resident, j, -1, district);
    }
    for (const resident of ['shadow', 'echo']) for (const j of JOBS) {
      while (districtState(state, district).assignments[resident][j] < (desired[resident]?.[j] ?? 0)) job(resident, j, 1, district);
    }
  };
  const project = (definition, district = 'district-0') => {
    const before = state;
    act({ type: 'enqueue', definition, district });
    const uid = state.queue.at(-1).uid;
    until(s => !s.queue.some(p => p.uid === uid), `project ${district}/${definition}`);
    const key = definition.startsWith('build:') ? `${definition}:${districtState(state, district).facilities[definition.slice(6)]}` : definition;
    assert(state.completed.includes(district === 'district-0' ? key : `${district}/${key}`));
    return { elapsed: state.clock.seconds - before.clock.seconds };
  };
  const mark = async name => {
    const raw = saves.encodeSave(state, state.clock.lastAt);
    assert.deepEqual(saves.decodeSave(raw).state, state);
    const entry = { name, chapter, second: state.clock.seconds, actionCount: actions.length, state: structuredClone(state), goal: engine.goal(state) };
    checkpoints.push(entry);
    await writeFile(new URL(`${name}.json`, output), raw);
    await writeFile(new URL('progress.json', output), JSON.stringify({ ...provenance, checkpoints, actions, waits }, null, 2));
    console.log(`${name}: ${state.clock.seconds}s, ${actions.length} actions`);
  };
  await mark('new-game');

  // Chapter 1 follows the established first-chapter UI route, without fixtures.
  act({ type: 'enqueue', definition: 'P01' }); run(25, 'first-light parts');
  job('shadow', 'salvage', -1); job('shadow', 'repair', 1); run(60, 'first-light work'); event('E01');
  story('L01-1'); story('L01-2', 'dismantle');
  job('shadow', 'repair', -1); job('shadow', 'salvage', 1); run(130, 'dorm parts');
  act({ type: 'enqueue', definition: 'build:dorm' }); job('shadow', 'salvage', -1); job('shadow', 'repair', 1); run(120, 'dorm work');
  job('shadow', 'repair', -1); job('shadow', 'salvage', 1); run(120, 'first echo arrival'); event('E03', 'bright');
  job('echo', 'repair', 1); project('P02'); event('E02'); story('L01-3');
  until(s => engine.freeResidents(s, 'echo') > 0, 'second echo arrival'); job('echo', 'salvage', 1);
  project('build:warehouse'); project('build:mailbox'); job('echo', 'salvage', -1); job('echo', 'record', 1);
  until(s => !!s.events.E04, 'first 20 earned memory'); event('E04'); project('R01'); project('R02'); project('P03'); event('E05'); story('L01-4');
  await mark('chapter-1');

  chapter = 2;
  project('build:dorm'); project('build:generator');
  until(s => engine.freeResidents(s, 'shadow') > 0, 'home power arrival'); job('shadow', 'power', 1);
  project('build:dorm'); until(s => s.population.shadow === 4 && s.population.echo === 4, 'home eight residents');
  roles('district-0', { shadow: { power: 2, salvage: 2 }, echo: { repair: 2, record: 2 } });
  project('build:workbench'); project('build:warehouse');
  project('P04'); act({ type: 'enqueue', definition: 'P05' }); run(10, 'reserve P05 and make room for E06');
  event('E06'); until(s => s.completed.includes('P05'), 'project P05'); event('E07', 'common');
  for (const [district, facility, lighting] of [['district-1', 'recycler', 'dim'], ['district-2', 'mailbox', 'bright']]) {
    project('build:dorm', district); project(`build:${facility}`, district); act({ type: 'lighting', district, lighting });
    project('build:dorm', district); project(`build:${facility}`, district);
  }
  until(s => districtState(s, 'district-1').population.shadow >= 2 && districtState(s, 'district-2').population.echo >= 2, 'specialist residents');
  roles('district-1', { shadow: { salvage: 2 } }); roles('district-2', { echo: { record: 2 } });
  project('public:relay'); act({ type: 'enqueue', definition: 'public:registry' }); run(10, 'reserve registry and make room for E08');
  event('E08'); until(s => !s.queue.length, 'registry completes'); project('R03'); project('R04');
  act({ type: 'auto-repair', district: 'district-0', enabled: true });
  project('P06'); act({ type: 'enqueue', definition: 'P07' }); run(10, 'reserve P07 and make room for E09');
  event('E09'); until(s => s.completed.includes('P07'), 'project P07'); event('E10'); await mark('chapter-2');

  chapter = 3;
  project('P08'); event('E11'); story('L03-1');
  // Leave room for whole-package returns; staff keep their original home beds.
  roles('district-0', { shadow: { power: 2, salvage: 1 }, echo: { repair: 2 } });
  roles('district-2', {});
  project('build:warehouse'); // Expand actual return space after the stronger Chapter 2 production fills it.
  act({ type: 'network-staff', route: 'rain', district: 'district-0', resident: 'shadow', delta: 1 });
  const supply = route => { until(s => !s.network.routes[route].trip, `${route} free train`); act({ type: 'dispatch', route, direction: 'outbound', loads: 1 }); until(s => !s.network.routes[route].trip, `${route} outbound arrival`); };
  const pickup = route => { act({ type: 'dispatch', route, direction: 'inbound', loads: 1 }); until(s => !s.network.routes[route].trip, `${route} inbound arrival`); };
  supply('rain'); until(s => s.network.routes.rain.node.resources.memory >= 12000, 'rain normal production'); pickup('rain'); event('E12', 'reliable'); story('L03-2');
  roles('district-0', { shadow: { power: 2, salvage: 1 }, echo: { repair: 2, record: 2 } }); roles('district-2', { echo: { record: 2 } });
  project('P09'); event('E13'); story('L03-3');
  act({ type: 'network-staff', route: 'station', district: 'district-2', resident: 'echo', delta: 1 });
  supply('station'); project('R05'); project('R06');
  roles('district-1', {}); roles('district-0', { shadow: { power: 2 }, echo: { repair: 2, record: 2 } });
  project('build:generator'); // Spend real construction inputs to make whole-load parts space.
  until(s => s.network.routes.station.node.resources.parts >= 24000, 'station normal production'); pickup('station');
  roles('district-1', { shadow: { salvage: 2 } }); roles('district-0', { shadow: { power: 2, salvage: 1 }, echo: { repair: 2, record: 2 } });
  project('P10'); event('E14');
  for (const route of ['rain', 'station']) act({ type: 'contract', route, enabled: true, loads: 1, reserve: amounts(50000, 30000, 10000), buffer: 1, manifest: { normal: 1, specialty: 0 }, targets: route === 'rain' ? amounts(0, 0, 60000) : amounts(0, 240000) });
  project('P11'); event('E15'); story('L03-4'); await mark('chapter-3');

  chapter = 4;
  act({ type: 'auto-repair', district: 'district-0', enabled: false });
  for (const route of ['rain', 'station']) act({ type: 'contract-pause', route });
  until(s => Object.values(s.network.routes).every(r => !r.trip), 'stand down existing paid contracts');
  // A home assembler must share existing workbench slots with repair staff.
  roles('district-0', { shadow: { power: 2, salvage: 1 }, echo: { repair: 1, record: 2, assemble: 1 } });
  act({ type: 'assembly-plan', enabled: true, target: 12000, reserve: amounts(30000, 30000) });
  story('L04-1'); project('P12'); story('L04-2');
  roles('district-1', { shadow: { salvage: 1 } }); roles('district-2', { echo: { record: 1 } });
  const localRoles = desired => {
    const id = state.outposts.active;
    for (const resident of ['shadow', 'echo']) for (const j of JOBS) while (state.outposts.sites[id].assignments[resident][j] > (desired[resident]?.[j] ?? 0)) act({ type: 'outpost-assign', resident, job: j, delta: -1 });
    for (const resident of ['shadow', 'echo']) for (const j of JOBS) while (state.outposts.sites[id].assignments[resident][j] < (desired[resident]?.[j] ?? 0)) act({ type: 'outpost-assign', resident, job: j, delta: 1 });
  };
  const localParts = target => {
    if (state.outposts.sites[state.outposts.active].resources.parts >= target) return;
    localRoles({ shadow: { power: 1 }, echo: { salvage: 1 } });
    until(s => s.outposts.sites[s.outposts.active].resources.parts >= target, `local parts ${target}`);
  };
  for (const id of ['O01', 'O02']) {
    until(s => s.resources.energy >= 20000 && s.resources.parts >= 20000 && s.resources.memory >= 8000, 'initial transfer stock');
    act({ type: 'outpost-open', outpost: id, crew: [{ district: 'district-1', resident: 'shadow' }, { district: 'district-2', resident: 'echo' }] });
    for (const definition of [`${id}-1`, `${id}-2`, `${id}-3`]) {
      const quote = outposts.outpostDefinition(state, id, definition);
      if (state.outposts.sites[id].resources.memory < quote.cost.memory) {
        localParts(Math.max(10000, (quote.cost.memory - state.outposts.sites[id].resources.memory) * 2));
        localRoles({ shadow: { power: 1 }, echo: { record: 1 } });
        until(s => s.outposts.sites[id].resources.memory >= quote.cost.memory, 'local memory');
      }
      const missing = quote.cost.component - state.outposts.sites[id].resources.component;
      if (missing > 0) {
        localParts(Math.ceil(missing * outposts.outpostAssemblyRecipe(state, id).parts) + 10000);
        act({ type: 'outpost-assembly', enabled: true, target: quote.cost.component, reserve: amounts(10000, 10000) });
        localRoles({ shadow: { power: 1 }, echo: { assemble: 1 } });
        until(s => s.outposts.sites[id].resources.component >= quote.cost.component, 'local components');
        act({ type: 'outpost-assembly', enabled: false, target: quote.cost.component, reserve: amounts(10000, 10000) });
      }
      localParts(quote.cost.parts); localRoles({ shadow: { power: 1 } });
      until(s => s.outposts.sites[id].resources.energy >= quote.cost.energy, 'local energy');
      localRoles({ shadow: { power: 1 }, echo: { repair: 1 } });
      act({ type: 'outpost-enqueue', definition, ...(definition === 'O02-2' ? { proof: 'local' } : {}) });
      until(s => s.outposts.sites[id].completed.includes(definition), definition);
    }
    if (id === 'O01') story('L04-3');
    act({ type: 'outpost-handoff', outpost: id });
    await mark(`${id}-complete`); act({ type: 'outpost-seal', confirmClear: true });
  }
  story('L04-4'); await mark('chapter-4');

  chapter = 5;
  roles('district-1', { shadow: { salvage: 2 } }); roles('district-2', { echo: { record: 2 } });
  story('L05-1'); project('P13'); story('L05-2');
  act({ type: 'calendar-storage', enabled: true, target: 300, reserve: amounts(30000, 0, 10000) });
  act({ type: 'calendar-toggle', enabled: true });
  for (const [route, delay, definition] of [['rain', 1, 'P14'], ['station', 0, 'P15']]) {
    act({ type: 'calendar-add', route, mode: 'normal', delay });
    supply(route);
    until(s => s.calendar.boosts[route].normal > 0, `${route} calendar overlap`);
    project(definition);
  }
  story('L05-3'); project('P16'); story('L05-4');
  act({ type: 'calendar-storage-pause' }); act({ type: 'calendar-toggle', enabled: false }); await mark('chapter-5');

  chapter = 6;
  story('L06-1'); project('P17'); story('L06-2');
  const select = selected => act({ type: 'covenant-confirm', selected, reserve: amounts() });
  select(['preserve']); run(60, 'preserve paid proof'); assert(covenantProof(state, 'preserve'));
  select(['extend']); project('P18'); story('L06-3'); assert(covenantProof(state, 'extend'));
  await mark('strategy-start');
  select(['coexist']); run(60, 'coexist paid proof'); supply('rain'); assert(covenantProof(state, 'coexist'));
  select(['extend', 'coexist']); run(60, 'dual paid proof'); await mark('strategy-ready'); project('P19'); story('L06-4');
  act({ type: 'covenant-pause' }); await mark('chapter-6');
  for (let i = 1; i <= 19; i++) assert(state.completed.includes(`P${String(i).padStart(2, '0')}`));
  assert.equal(checkpoints[0].state.clock.seconds, 0);
  await writeFile(new URL('route.json', output), JSON.stringify({ status: 'complete', ...provenance, method: 'current engine; one new game; actions and simulated time only; 10-second wait sampling; not human playtesting', checkpoints, actions, waits }, null, 2));

  // Counterfactual branches start from identical genuine route checkpoints.
  // Each uses the same workload/actions, with only the selected covenants varied.
  const variants = [[], ['preserve'], ['extend'], ['coexist'], ['preserve', 'extend'], ['preserve', 'coexist'], ['extend', 'coexist']];
  const comparisons = [];
  for (const scenario of ['construction', 'transport', 'saturated-idle']) for (const selected of variants) {
    let branch = structuredClone(checkpoints.find(p => p.name === (scenario === 'saturated-idle' ? 'chapter-6' : 'strategy-ready')).state);
    const before = structuredClone(branch), operations = [];
    const branchAct = action => {
      const result = engine.applyAction(branch, action);
      assert.equal(result.error, null, `${scenario}/${selected}: ${JSON.stringify(action)}: ${result.error}`);
      branch = result.state; saves.assertInvariants(branch); operations.push({ second: branch.clock.seconds, action });
    };
    const tick = seconds => { branch = engine.advance(branch, seconds * 1000); saves.assertInvariants(branch); };
    branchAct({ type: 'covenant-pause' });
    if (selected.length) branchAct({ type: 'covenant-confirm', selected, reserve: amounts() });
    const trips = [];
    if (scenario !== 'saturated-idle') branchAct({ type: 'enqueue', definition: 'P19' });
    if (scenario === 'construction') {
      let n = 0;
      while (!branch.completed.includes('P19') && n++ < 3600) tick(1);
      assert(branch.completed.includes('P19'));
    } else if (scenario === 'transport') {
      // Reserve the same real project cost, and stop recorders before the
      // three whole returns. There is no artificial stock drain or capacity.
      for (const district of ['district-0', 'district-2']) for (const resident of ['shadow', 'echo']) {
        while (districtState(branch, district).assignments[resident].record) branchAct({ type: 'assign', district, resident, job: 'record', delta: -1 });
      }
      tick(1);
      for (let i = 0; i < 3; i++) for (const direction of ['outbound', 'inbound']) {
        branchAct({ type: 'dispatch', route: 'rain', direction, loads: 1 });
        const trip = branch.network.routes.rain.trip;
        trips.push({ direction, fee: trip.fee, duration: trip.duration, cargo: trip.cargo }); tick(trip.duration);
        assert.equal(branch.network.routes.rain.trip, null);
      }
    } else tick(900);
    const after = branch, delta = (a, b) => Object.fromEntries(RESOURCES.map(r => [r, a[r] - b[r]]));
    const covenant = engine.summarize(before, after, (after.clock.seconds - before.clock.seconds) * 1000).covenants;
    assert.deepEqual(saves.decodeSave(saves.encodeSave(after, after.clock.lastAt)).state, after);
    comparisons.push({ scenario, selected, seconds: after.clock.seconds - before.clock.seconds, operations, trips, stockDelta: delta(after.resources, before.resources), flows: Object.fromEntries(Object.keys(after.ledger).map(flow => [flow, delta(after.ledger[flow], before.ledger[flow])])), covenant, projectComplete: after.completed.includes('P19'), endingResources: after.resources });
  }
  assert.equal(comparisons.length, 21);
  for (const row of comparisons) if (row.scenario === 'transport') {
    assert.equal(row.trips.length, 6); assert.equal(row.seconds, 721);
    assert.equal(row.flows.imports.memory, 36000); assert.equal(row.flows.exports.parts, 60000);
  }
  await writeFile(new URL('strategies.json', output), JSON.stringify({ ...provenance, method: 'seven selections x three workloads; same actual route origin per workload; includes one non-empty adjustment; resources have no exchange-rate assumption', comparisons }, null, 2));
  console.log('strategy comparisons: 21 complete, all save round-trips valid');
} finally {
  await server.close();
}
