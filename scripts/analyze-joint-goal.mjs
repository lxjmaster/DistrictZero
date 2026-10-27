// Candidate-design evidence using existing production rules, not a new game mode.
// Run after analyze:progression, passing its fresh run directory.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer } from 'vite';

if (!process.argv[2]) throw new Error('Pass the analysis run directory printed by analyze:progression');
const runDirectory = resolve(process.argv[2]);
const directory = pathToFileURL(join(runDirectory, 'joint-goal-analysis') + sep);
const input = pathToFileURL(join(runDirectory, 'progression-analysis', 'chapter-6.json'));
const raw = await readFile(input, 'utf8');
const route = JSON.parse(await readFile(join(runDirectory, 'progression-analysis', 'route.json'), 'utf8'));
assert.equal(route.status, 'complete');
const gameSourceHash = createHash('sha256');
for (const file of (await readdir(new URL('../src/game/', import.meta.url))).filter(f => f.endsWith('.ts')).sort()) {
  gameSourceHash.update(file).update('\0').update(await readFile(new URL(`../src/game/${file}`, import.meta.url))).update('\0');
}
const gameSourceSha256 = gameSourceHash.digest('hex');
assert.equal(gameSourceSha256, route.gameSourceSha256, 'rerun progression analysis after game source changes');
// Refuse an existing result directory rather than overwriting a prior run.
await mkdir(directory);
const server = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false }, appType: 'custom' });
try {
  const { applyAction, advance, summarize } = await server.ssrLoadModule('/src/game/engine.ts');
  const { decodeSave, encodeSave, assertInvariants } = await server.ssrLoadModule('/src/game/saves.ts');
  const { calendarClock } = await server.ssrLoadModule('/src/game/calendar-config.ts');
  const source = decodeSave(raw).state;
  assert(source.experience.story['L06-4']);
  assert.equal(source.resources.rainFilm, 0); assert.equal(source.resources.railCore, 0);
  assert.equal(source.calendar.orders.length, 0); assert.equal(source.calendar.enabled, false);
  assert.equal(source.calendar.storage.enabled, false); assert.equal(source.covenants.selected.length, 0);
  for (const route of Object.values(source.network.routes)) { assert(route.staff); assert.equal(route.trip, null); assert.equal(route.contract.enabled, false); }
  const results = [];
  const strategies = {
    ordinary: [],
    'calendar-both-rain-first': ['rain', 'station'],
    'calendar-both-station-first': ['station', 'rain'],
    'calendar-rain': ['rain'],
    'calendar-station': ['station']
  };
  for (const phase of [0, 120, 240, 480]) {
    // Reach each phase through real elapsed time, without rewriting the origin.
    const elapsed = (phase - calendarClock(source).position + 600) % 600;
    const before = advance(source, elapsed * 1000); assertInvariants(before);
    assert.equal(calendarClock(before).position, phase);
    for (const batches of [1, 2]) for (const [strategy, orders] of Object.entries(strategies)) {
      let state = structuredClone(before);
      const actions = [], milestones = {};
      const act = action => {
        const result = applyAction(state, action);
        assert.equal(result.error, null, `${phase}/${strategy}: ${JSON.stringify(action)}: ${result.error}`);
        state = result.state; assertInvariants(state);
        actions.push({ at: state.clock.seconds - before.clock.seconds, action });
      };
      for (const id of ['rain', 'station']) act({ type: 'production-mode', route: id, mode: 'specialty' });
      for (const id of orders) act({ type: 'calendar-add', route: id, mode: 'specialty', delay: 0 });
      if (orders.length) act({ type: 'calendar-toggle', enabled: true });
      for (const id of ['rain', 'station']) act({ type: 'dispatch', route: id, direction: 'outbound', loads: batches });
      const sentHome = new Set();
      for (let second = 1; second <= 1800; second++) {
        state = advance(state, 1000); assertInvariants(state);
        for (const [id, resource] of [['rain', 'rainFilm'], ['station', 'railCore']]) {
          const node = state.network.routes[id];
          if (!sentHome.has(id) && !node.trip && node.node.resources[resource] >= 2000 * batches) {
            milestones[`${id}-ready`] = second;
            act({ type: 'dispatch', route: id, direction: 'inbound', loads: { normal: 0, specialty: batches } });
            sentHome.add(id);
          }
          if (state.resources[resource] >= 2000 * batches && milestones[`${id}-arrived`] === undefined) milestones[`${id}-arrived`] = second;
        }
        if (state.resources.rainFilm >= 2000 * batches && state.resources.railCore >= 2000 * batches) break;
      }
      assert.equal(state.resources.rainFilm, 2000 * batches); assert.equal(state.resources.railCore, 2000 * batches);
      assert.equal(sentHome.size, 2); assert.equal(state.calendar.orders.length, 0);
      assert.equal(state.ledger.imports.rainFilm - before.ledger.imports.rainFilm, 2000 * batches);
      assert.equal(state.ledger.imports.railCore - before.ledger.imports.railCore, 2000 * batches);
      assert.deepEqual(decodeSave(encodeSave(state, state.clock.lastAt)).state, state);
      const report = summarize(before, state, (state.clock.seconds - before.clock.seconds) * 1000);
      assert.equal(report.calendar.used, orders.length * 60);
      assert.equal(state.calendar.stored, before.calendar.stored - orders.length * 60);
      assert.equal(state.calendar.allowance, before.calendar.allowance - orders.length);
      assert.equal(report.calendar.captured, 0); // Uses actual, previously paid stored time.
      results.push({ phase, batches, strategy, seconds: state.clock.seconds - before.clock.seconds, actions, milestones, calendar: report.calendar, operating: report.flows.operating, exports: report.flows.exports, imports: report.flows.imports, finalResources: state.resources });
    }
  }
  assert.equal(results.length, 40);
  const result = {
    method: 'one genuine current-engine route endpoint; ordinary specialty processing versus four calendar scheduling strategies; 4 starting phases x 1/2 batches; real cargo, no resource grants; 1-second observation; not human experience',
    source: { path: fileURLToPath(input), sha256: createHash('sha256').update(raw).digest('hex'), routeCommit: route.commit, routeGameSourceSha256: route.gameSourceSha256 },
    gameSourceSha256, node: process.version, scriptSha256: createHash('sha256').update(await readFile(new URL(import.meta.url))).digest('hex'), results
  };
  await writeFile(new URL('comparison.json', directory), JSON.stringify(result, null, 2));
  console.table(results.map(({ phase, batches, strategy, seconds, actions, calendar }) => ({ phase, batches, strategy, seconds, actions: actions.length, used: calendar.used })));
} finally {
  await server.close();
}
