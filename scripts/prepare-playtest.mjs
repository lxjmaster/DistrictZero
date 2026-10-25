// Package unchanged, validated sources. Never rewrite timestamps or economies.
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const output = resolve(root, 'test-results/playtest-kit/v0.6');
const module = await build({ stdin: { contents: "export { decodeSave } from './src/game/saves';", resolveDir: root }, bundle: true, write: false, format: 'esm', platform: 'node' });
const { decodeSave } = await import('data:text/javascript;base64,' + Buffer.from(module.outputFiles[0].contents).toString('base64'));
const entries = [
  ['02-city', 'v0.1-chapter.json', '第二章起点；首章已完成'],
  ['03-network', 'v0.2-chapter.json', '第三章起点；前两章已完成'],
  ['04-outposts', 'v0.3.3-chapter.json', '分所起点；第三章及前三批扩充已完成'],
  ['05-calendar', 'v0.4-chapter.json', '历法起点；分所章节已完成'],
  ['06-covenants', 'v0.5-chapter.json', '公约起点；历法章节已完成'],
  ['05-prepared', 'v0.5-prepared.json', '指定任务；已由自动路线完成备料，不能测首次发现']
];
await mkdir(join(output, 'saves'), { recursive: true });
const manifest = { generatedAt: new Date().toISOString(), sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), targetSchema: 9, targetBalance: '0.6.0', unchangedSourceBytes: true, offlineSettlementPerformed: false, humanSessions: 0, entries: [] };
for (const [id, name, purpose] of entries) {
  const source = 'tests/fixtures/' + name, bytes = await readFile(join(root, source));
  const original = JSON.parse(bytes), validated = decodeSave(bytes.toString('utf8'));
  if (validated.schemaVersion !== 9 || validated.balanceVersion !== '0.6.0') throw new Error('Unexpected target version');
  const file = `saves/${id}.json`;
  await writeFile(join(output, file), bytes);
  manifest.entries.push({ id, file, purpose, source, sha256: createHash('sha256').update(bytes).digest('hex'), sourceSchema: original.schemaVersion, sourceBalance: original.balanceVersion, savedAt: original.savedAt, lastAt: original.state.clock.lastAt, validatedForCurrentDecoder: true });
}
await writeFile(join(output, 'host-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
await writeFile(join(output, 'START_HERE.md'), await readFile(join(root, 'docs/PLAYTEST_START.md')));
console.log(JSON.stringify({ output, sources: entries.length, targetSchema: 9, unchangedSourceBytes: true, humanSessions: 0 }));
