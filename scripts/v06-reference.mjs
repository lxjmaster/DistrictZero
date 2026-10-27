// Capture genuine V0.6 saves and independent expectations from published rules.
// Initial capture: node scripts/v06-reference.mjs --capture
// Reproduce tracked fixtures/reference: node scripts/v06-reference.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const commit = '22d37466d40aea71d6e010b41a5961e5e88968dd';
const root = resolve(import.meta.dirname, '..'), fixtures = join(root, 'tests/fixtures');
const digest = value => createHash('sha256').update(value).digest('hex');
const capture = process.argv.includes('--capture');
const temporary = mkdtempSync(join(tmpdir(), 'districtzero-v06-reference-'));
try {
  execFileSync('tar', ['-x', '-C', temporary], { input: execFileSync('git', ['archive', commit, 'src/game'], { cwd: root }) });
  const entry = join(temporary, 'entry.ts'), bundle = join(temporary, 'released.mjs');
  writeFileSync(entry, `export {createGame, advance, summarize, applyAction} from './src/game/engine'; export {decodeSave, encodeSave, assertInvariants} from './src/game/saves';`);
  await build({ entryPoints: [entry], outfile: bundle, bundle: true, platform: 'node', format: 'esm' });
  const old = await import(pathToFileURL(bundle).href);
  if (capture) {
    const route = JSON.parse(readFileSync(join(root, 'test-results/progression-analysis/route.json'), 'utf8'));
    assert.equal(route.status, 'complete');
    const source = readFileSync(join(root, 'test-results/progression-analysis/chapter-6.json'), 'utf8');
    old.assertInvariants(old.decodeSave(source).state);
    writeFileSync(join(fixtures, 'v0.6-route.json'), JSON.stringify({ commit: route.commit, gameSourceSha256: route.gameSourceSha256, scriptSha256: route.scriptSha256, sourceSha256: digest(source), actions: route.actions }, null, 2) + '\n');
    writeFileSync(join(fixtures, 'v0.6-chapter.json'), source);
  }
  const sourceText = readFileSync(join(fixtures, 'v0.6-chapter.json'), 'utf8');
  const route = JSON.parse(readFileSync(join(fixtures, 'v0.6-route.json'), 'utf8'));
  assert.equal(digest(sourceText), route.sourceSha256);
  const chapter = old.decodeSave(sourceText).state;
  let replay = old.createGame(0);
  for (const item of route.actions) {
    assert(item.second >= replay.clock.seconds);
    replay = old.advance(replay, (item.second - replay.clock.seconds) * 1000);
    const result = old.applyAction(replay, item.action); assert.equal(result.error, null);
    replay = result.state; old.assertInvariants(replay);
  }
  replay = old.advance(replay, (chapter.clock.seconds - replay.clock.seconds) * 1000);
  assert.deepEqual(replay, chapter, 'published engine reproduces the entire genuine route');
  const derive = actions => {
    let state = structuredClone(chapter), trace = [];
    const act = action => { const result = old.applyAction(state, action); assert.equal(result.error, null, JSON.stringify(action)); state = result.state; old.assertInvariants(state); trace.push({ second: state.clock.seconds, action }); };
    const run = seconds => { state = old.advance(state, seconds * 1000); old.assertInvariants(state); trace.push({ seconds }); };
    actions(act, run, () => state);
    return { state, trace };
  };
  const ready = derive((act, run, state) => {
    for (const route of ['rain', 'station']) act({ type: 'production-mode', route, mode: 'specialty' });
    for (const route of ['rain', 'station']) act({ type: 'dispatch', route, direction: 'outbound', loads: 1 });
    const home = new Set();
    for (let second = 1; second <= 600; second++) {
      run(1);
      for (const [route, resource] of [['rain', 'rainFilm'], ['station', 'railCore']]) if (!home.has(route) && !state().network.routes[route].trip && state().network.routes[route].node.resources[resource] >= 2000) {
        act({ type: 'dispatch', route, direction: 'inbound', loads: { normal: 0, specialty: 1 } }); home.add(route);
      }
      if (state().resources.rainFilm >= 2000 && state().resources.railCore >= 2000) return;
    }
    throw new Error('real ordinary cargo did not arrive');
  });
  const boundary = derive((act, run, state) => {
    for (const route of ['rain', 'station']) act({ type: 'production-mode', route, mode: 'specialty' });
    act({ type: 'calendar-add', route: 'rain', mode: 'specialty', delay: 2 });
    act({ type: 'calendar-toggle', enabled: true });
    act({ type: 'covenant-confirm', selected: ['extend', 'coexist'], reserve: { energy: 0, parts: 0, memory: 0, component: 0, rainFilm: 0, railCore: 0 } });
    run(1);
    for (const route of ['rain', 'station']) act({ type: 'dispatch', route, direction: 'outbound', loads: 1 });
    run(120); act({ type: 'calendar-toggle', enabled: false });
    assert(state().calendar.orders[0].prepared); assert(state().network.routes.station.trip);
    assert.equal(state().covenants.selected.length, 2);
  });
  const elapsed = 86_400_517, cases = [];
  for (const [name, before, actions] of [['chapter', chapter, []], ['ready', ready.state, ready.trace], ['boundary', boundary.state, boundary.trace]]) {
    const text = name === 'chapter' ? sourceText : old.encodeSave(before, before.clock.lastAt) + '\n';
    if (name !== 'chapter') writeFileSync(join(fixtures, `v0.6-${name}.json`), text);
    assert.deepEqual(old.decodeSave(text).state, before);
    const after = old.advance(before, elapsed); old.assertInvariants(after);
    cases.push({ name, fixtureSha256: digest(text), actions, state: after, report: old.summarize(before, after, elapsed) });
  }
  const gameSourceSha256 = Object.fromEntries(readdirSync(join(temporary, 'src/game')).filter(f => f.endsWith('.ts')).sort().map(f => [f, digest(readFileSync(join(temporary, 'src/game', f)))]));
  const reference = { source: `Published V0.6 ${commit}`, scriptSha256: digest(readFileSync(import.meta.filename)), gameSourceSha256, routeSha256: digest(readFileSync(join(fixtures, 'v0.6-route.json'))), elapsed, cases };
  writeFileSync(join(fixtures, 'v0.6-offline-reference.json'), JSON.stringify(reference, null, 2) + '\n');
  console.log(JSON.stringify({ source: reference.source, elapsed, replayedActions: route.actions.length, cases: cases.map(({ name, fixtureSha256 }) => ({ name, fixtureSha256 })) }, null, 2));
} finally { rmSync(temporary, { recursive: true, force: true }); }
