import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { activateNetworkRules, advance, summarize } from '../../src/game/engine';
import { decodeSave, encodeSave } from '../../src/game/saves';
import { SAVE_KEY, BACKUP_KEY } from '../../src/app/storage';

const NOW = Date.parse('2026-10-25T12:00:00Z'), ELAPSED = 86_400_517;
for (const origin of ['schema5', 'schema8', 'current'] as const) {
  test(`settlement: ${origin} keeps one final write, original recovery bytes and the captured whole interval`, async ({ page }) => {
    const fixture = origin === 'schema5' ? 'v0.3.2-chapter' : 'v0.5-in-transit';
    const raw = JSON.parse(await readFile(new URL(`../fixtures/${fixture}.json`, import.meta.url), 'utf8'));
    raw.savedAt = raw.state.clock.lastAt = NOW - ELAPSED;
    // The current-schema case is an explicitly decoded migration, not a
    // relabeled historical fixture. No resource/progress value is manufactured.
    const text = origin === 'current' ? encodeSave(decodeSave(JSON.stringify(raw)).state, raw.savedAt) : JSON.stringify(raw);
    const before = decodeSave(text).state, expected = activateNetworkRules(advance(before, ELAPSED), NOW);
    expected.clock.lastAt = NOW; expected.report = summarize(before, expected, ELAPSED);
    await page.addInitScript(([key, text]) => {
      localStorage.setItem(key, text);
      const write = Storage.prototype.setItem;
      (window as any).__settlementWrites = [];
      Storage.prototype.setItem = function(k, value) {
        if (k === key) (window as any).__settlementWrites.push(JSON.parse(value));
        return write.call(this, k, value);
      };
    }, [SAVE_KEY, text]);
    await page.clock.install({ time: new Date(NOW) }); await page.clock.pauseAt(new Date(NOW));
    await page.goto('/'); await expect(page.getByTestId('save-status')).toHaveText('已保存', { timeout: 30000 });
    const writes = await page.evaluate(() => (window as any).__settlementWrites);
    expect(writes).toHaveLength(1); expect(writes[0].state).toEqual(expected);
    expect(await page.evaluate(key => localStorage.getItem(key), BACKUP_KEY)).toBe(text);
    expect(expected.clock.remainderMs).toBe((before.clock.remainderMs + ELAPSED) % 1000);
    expect(expected.network.legacyPending).toBe(false);
    if (before.network.legacyPending) expect(expected.network.rulesSince).toBe(NOW);
  });
}
