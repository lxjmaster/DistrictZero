// Paper scheduling and recipe budget; never applies an unimplemented objective.
// Run after analyze-joint-goal, passing the same analysis run directory.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createServer } from 'vite';

if (!process.argv[2]) throw new Error('Pass the analysis run directory printed by analyze:progression');
const runDirectory = resolve(process.argv[2]);
const read = path => readFile(new URL(path, import.meta.url));
const comparisonRaw = await readFile(join(runDirectory, 'joint-goal-analysis', 'comparison.json'));
const comparison = JSON.parse(comparisonRaw);
assert.equal(comparison.results.length, 40);
const sourceRaw = await readFile(join(runDirectory, 'progression-analysis', 'chapter-6.json'));
assert.equal(createHash('sha256').update(sourceRaw).digest('hex'), comparison.source.sha256);
const hash = createHash('sha256');
for (const file of (await readdir(new URL('../src/game/', import.meta.url))).filter(f => f.endsWith('.ts')).sort()) {
  hash.update(file).update('\0').update(await read(`../src/game/${file}`)).update('\0');
}
const gameSourceSha256 = hash.digest('hex');
assert.equal(gameSourceSha256, comparison.gameSourceSha256, 'rerun logistics analysis after source changes');
const server = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false }, appType: 'custom' });
try {
  const { decodeSave, assertInvariants } = await server.ssrLoadModule('/src/game/saves.ts');
  const { workers, efficiency } = await server.ssrLoadModule('/src/game/engine.ts');
  const { BASE, RESEARCH_EFFECTS, cost, amounts, RESOURCES } = await server.ssrLoadModule('/src/game/config.ts');
  const { DISTRICT_IDS, districtState } = await server.ssrLoadModule('/src/game/city.ts');
  const { departureEnergy } = await server.ssrLoadModule('/src/game/network.ts');
  const { CALENDAR_RULES } = await server.ssrLoadModule('/src/game/calendar-config.ts');
  const source = decodeSave(sourceRaw.toString()).state;
  assertInvariants(source);
  const workPerSecond = DISTRICT_IDS.filter(id => districtState(source, id)).reduce((total, id) => total + Math.round(BASE.repair * workers(source, 'repair', id) * efficiency(source, 'repair', id) * (source.completed.includes('R01') ? RESEARCH_EFFECTS.R01 : 1)), 0);
  assert.equal(workPerSecond, 1380);
  // An illustrative, discarded 180-point part. No fee, progress, or completion
  // is injected into the game. Assumes power/labor remain fully available.
  const examplePartWork = 180000, partSeconds = Math.ceil(examplePartWork / workPerSecond);
  const schedules = comparison.results.map(row => {
    const arrivals = ['rain', 'station'].map(id => ({ id, at: row.milestones[`${id}-arrived`] })).sort((a, b) => a.at - b.at);
    const first = arrivals[0].at + partSeconds;
    const last = Math.max(first, arrivals[1].at) + partSeconds;
    const allReady = arrivals[1].at;
    const waitAllLast = allReady + partSeconds * 2;
    assert(last <= waitAllLast);
    return { phase: row.phase, batches: row.batches, strategy: row.strategy, firstPart: arrivals[0].id, first, last, waitAllFirst: allReady + partSeconds, waitAllLast };
  });
  const payment = cost(0, 0, 4, 1, 2, 2);
  const departureFees = 2 * (departureEnergy(source, 'rain') + departureEnergy(source, 'station'));
  const archiveBudgets = comparison.results.filter(row => row.batches === 1).map(row => {
    const upstream = { ...row.exports };
    upstream.energy += departureFees + payment.energy;
    upstream.parts += payment.parts;
    upstream.memory += payment.memory;
    upstream.component += payment.component;
    // Specialty consumption is an intermediate product, not a second source cost.
    const canHandOver = RESOURCES.every(r => row.finalResources[r] >= payment[r]);
    assert(canHandOver);
    const calendarProcessingFee = amounts();
    for (const r of RESOURCES) calendarProcessingFee[r] = CALENDAR_RULES.boostCost[r] * row.calendar.used / CALENDAR_RULES.steps;
    return { phase: row.phase, strategy: row.strategy, secondsToMaterials: row.seconds, logisticsActions: row.actions.length, plannedTotalActions: row.actions.length + 1, upstreamInputs: upstream, consumedFinalProducts: amounts(0, 0, 0, 0, payment.rainFilm, payment.railCore), calendarUsed: row.calendar.used, calendarProcessingFee };
  });
  assert.equal(schedules.length, 40); assert.equal(archiveBudgets.length, 20);
  assert(archiveBudgets.filter(r => r.strategy === 'ordinary').every(r => r.secondsToMaterials === 360 && r.plannedTotalActions === 7));
  assert.deepEqual(archiveBudgets[0].upstreamInputs, amounts(42000, 12000, 10000, 1000));
  const output = {
    method: 'paper budget over measured logistics; not actual new projects or archive action; full-power 180-point construction illustration; final archive handoff is planned, not executed',
    gameSourceSha256, sourceSha256: comparison.source.sha256, comparisonSha256: createHash('sha256').update(comparisonRaw).digest('hex'), scriptSha256: createHash('sha256').update(await readFile(new URL(import.meta.url))).digest('hex'), node: process.version,
    workPerSecond, examplePartWork, partSeconds, departureFees, payment, schedules, archiveBudgets
  };
  await writeFile(join(runDirectory, 'joint-goal-analysis', 'budget.json'), JSON.stringify(output, null, 2), { flag: 'wx' });
  console.log(JSON.stringify({ schedules: schedules.length, archiveBudgets: archiveBudgets.length, workPerSecond, partSeconds, departureFees, ordinaryArchive: archiveBudgets.find(r => r.strategy === 'ordinary'), exampleTwoBatch: schedules.filter(r => r.phase === 120 && r.batches === 2 && ['ordinary', 'calendar-station'].includes(r.strategy)) }, null, 2));
} finally {
  await server.close();
}
