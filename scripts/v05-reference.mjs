// Reproduce the released V0.5 offline expectation without importing current rules.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const commit = '3c094d77143da019cc5b6b756cb120131874f8b3';
const digest = value => createHash('sha256').update(value).digest('hex');
const root = resolve(import.meta.dirname, '..');
const temp = mkdtempSync(join(tmpdir(), 'districtzero-v05-reference-'));
try {
  const archive = execFileSync('git', ['archive', commit, 'src/game'], { cwd: root });
  execFileSync('tar', ['-x', '-C', temp], { input: archive });
  const entry = join(temp, 'entry.ts');
  writeFileSync(entry, `export {advance, summarize, applyAction} from './src/game/engine'; export {decodeSave, encodeSave, assertInvariants} from './src/game/saves';`);
  const bundle = join(temp, 'released.mjs');
  await build({ entryPoints: [entry], outfile: bundle, bundle: true, platform: 'node', format: 'esm' });
  const old = await import(pathToFileURL(bundle).href);
  const names = ['v0.5-chapter.json', 'v0.5-prepared.json'];
  for (const name of names) old.assertInvariants(old.decodeSave(readFileSync(join(root, 'tests/fixtures', name), 'utf8')).state);
  const prepared = old.decodeSave(readFileSync(join(root, 'tests/fixtures', names[1]), 'utf8')).state;
  const action = { type: 'dispatch', route: 'rain', direction: 'outbound', loads: 1 };
  const boundary = old.applyAction(prepared, action);
  if (boundary.error) throw new Error(boundary.error);
  old.assertInvariants(boundary.state);
  const boundaryText = old.encodeSave(boundary.state, boundary.state.clock.lastAt) + '\n';
  writeFileSync(join(root, 'tests/fixtures/v0.5-in-transit.json'), boundaryText);
  const source = readFileSync(join(root, 'tests/fixtures', names[0]), 'utf8');
  const before = old.decodeSave(source).state, elapsed = 86_400_517;
  const after = old.advance(before, elapsed); old.assertInvariants(after);
  const gameSourceSha256 = Object.fromEntries(readdirSync(join(temp, 'src/game')).filter(f => f.endsWith('.ts')).sort().map(f => [f, digest(readFileSync(join(temp, 'src/game', f)))]));
  const boundaryAfter = old.advance(boundary.state, elapsed); old.assertInvariants(boundaryAfter);
  const reference = { source: `Released V0.5 ${commit}`, fixtureSha256: digest(source), gameSourceSha256, elapsed, state: after, report: old.summarize(before, after, elapsed), boundary: { action, fixtureSha256: digest(boundaryText), state: boundaryAfter, report: old.summarize(boundary.state, boundaryAfter, elapsed) } };
  writeFileSync(join(root, 'tests/fixtures/v0.5-offline-reference.json'), JSON.stringify(reference, null, 2) + '\n');
  console.log(JSON.stringify({ source: reference.source, fixtureSha256: reference.fixtureSha256, files: names, elapsed }));
} finally { rmSync(temp, { recursive: true, force: true }); }
