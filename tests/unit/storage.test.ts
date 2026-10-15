import { describe, expect, it } from 'vitest';
import { advance, createGame } from '../../src/game/engine';
import { decodeSave, encodeSave } from '../../src/game/saves';
import { BACKUP_KEY, SAVE_KEY, SaveStorage } from '../../src/app/storage';

function memoryStorage() {
  const data = new Map<string, string>();
  return { data, getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); }, removeItem: (key: string) => { data.delete(key); } };
}
describe('validated save and recovery', () => {
  it('keeps the previous valid save and recovers a corrupted primary', () => {
    const memory = memoryStorage(), store = new SaveStorage(memory), original = createGame();
    store.save(original, 0); store.save(advance(original, 30000), 30000);
    expect(decodeSave(memory.getItem(BACKUP_KEY)!).state).toEqual(original);
    memory.setItem(SAVE_KEY, '{broken'); const loaded = store.load();
    expect(loaded.state).toEqual(original); expect(loaded.warning).toContain('恢复副本');
    store.save(loaded.state!, 40000);
    expect(decodeSave(memory.getItem(BACKUP_KEY)!).state).toEqual(original);
  });
  it('rejects invalid replacement without changing either valid slot', () => {
    const memory = memoryStorage(), store = new SaveStorage(memory), state = createGame(); store.save(state, 0);
    const primary = memory.getItem(SAVE_KEY), backup = memory.getItem(BACKUP_KEY);
    state.resources.parts = -1; expect(() => store.save(state, 1)).toThrow();
    expect(memory.getItem(SAVE_KEY)).toBe(primary); expect(memory.getItem(BACKUP_KEY)).toBe(backup);
  });
  it('preserves the pre-import recovery copy across replacement writes', () => {
    const memory = memoryStorage(), store = new SaveStorage(memory), old = advance(createGame(), 30000), replacement = createGame();
    store.save(old, 0); store.backupCurrent(old, 0); store.save(replacement, 0, { preserveBackup: true });
    expect(store.recovery()).toEqual(old);
  });
  it('leaves both corrupt slots intact and reports an explicit replacement requirement', () => {
    const memory = memoryStorage(), store = new SaveStorage(memory); memory.setItem(SAVE_KEY, '{broken'); memory.setItem(BACKUP_KEY, '{broken');
    expect(store.load().blocked).toBe(true); expect(store.load().state).toBeNull(); expect(memory.getItem(SAVE_KEY)).toBe('{broken');
  });
  it.each([
    { schemaVersion: 4, balanceVersion: '0.4.0' },
    { schemaVersion: 2, balanceVersion: '0.2.1' }
  ])('preserves an incompatible primary despite a valid recovery copy: %j', version => {
    const memory = memoryStorage(), store = new SaveStorage(memory), state = createGame();
    const backup = encodeSave(state, 0), primary = JSON.stringify({ ...JSON.parse(backup), ...version });
    memory.setItem(SAVE_KEY, primary); memory.setItem(BACKUP_KEY, backup);
    const loaded = store.load();
    expect(loaded.blocked).toBe(true); expect(loaded.state).toBeNull(); expect(loaded.warning).toContain('版本不兼容');
    expect(() => store.save(state, 1)).toThrow('版本不兼容');
    expect(() => store.save(state, 1, { preserveBackup: true })).toThrow('版本不兼容');
    expect(memory.getItem(SAVE_KEY)).toBe(primary); expect(memory.getItem(BACKUP_KEY)).toBe(backup);
  });
  it('allows an explicit incompatible replacement while preserving the recovery copy', () => {
    const memory = memoryStorage(), store = new SaveStorage(memory), state = createGame();
    const backup = encodeSave(advance(state, 60000), 60000);
    memory.setItem(SAVE_KEY, JSON.stringify({ ...JSON.parse(backup), schemaVersion: 99 })); memory.setItem(BACKUP_KEY, backup);
    store.save(state, 0, { preserveBackup: true, replaceIncompatible: true });
    expect(decodeSave(memory.getItem(SAVE_KEY)!).state).toEqual(state); expect(memory.getItem(BACKUP_KEY)).toBe(backup);
  });
  it('preserves an incompatible recovery copy when the primary is corrupt', () => {
    const memory = memoryStorage(), store = new SaveStorage(memory);
    const backup = JSON.stringify({ ...JSON.parse(encodeSave(createGame(), 0)), schemaVersion: 99 });
    memory.setItem(SAVE_KEY, '{broken'); memory.setItem(BACKUP_KEY, backup);
    const loaded = store.load(); expect(loaded.blocked).toBe(true); expect(loaded.state).toBeNull(); expect(loaded.warning).toContain('版本不兼容');
    expect(memory.getItem(SAVE_KEY)).toBe('{broken'); expect(memory.getItem(BACKUP_KEY)).toBe(backup);
  });
  it('surfaces storage and readback failures while the in-memory game remains exportable', () => {
    const memory = memoryStorage(), store = new SaveStorage({ ...memory, setItem: () => { throw new Error('quota'); } }), state = createGame();
    expect(() => store.save(state, 0)).toThrow('quota'); expect(decodeSave(encodeSave(state, 0)).state).toEqual(state);
    const silent = new SaveStorage({ ...memory, setItem: () => undefined }); expect(() => silent.save(state, 0)).toThrow('读取不一致');
  });
});
