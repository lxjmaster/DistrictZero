import { decodeSave, encodeSave } from '../game/saves';
import type { GameState } from '../game/types';

export const SAVE_KEY = 'districtzero.save.v1';
export const BACKUP_KEY = 'districtzero.save.backup.v1';
export interface StorageLike { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void }
export class SaveStorage {
  constructor(private store: StorageLike) {}
  load(): { state: GameState | null; warning: string | null; blocked?: boolean } {
    let primary: string | null;
    try { primary = this.store.getItem(SAVE_KEY); } catch { return { state: null, warning: '浏览器存储不可用。可继续游玩，请导出存档保留进度。' }; }
    if (primary) {
      try { return { state: decodeSave(primary).state, warning: null }; } catch { /* read valid recovery copy */ }
    }
    let backup: string | null = null;
    try {
      backup = this.store.getItem(BACKUP_KEY);
      if (backup) return { state: decodeSave(backup).state, warning: '主存档缺失或损坏，已读取有效恢复副本。' };
    } catch { /* leave invalid data untouched */ }
    return { state: null, warning: primary || backup ? '主存档与恢复副本均无法读取。原始数据保留，请导入有效存档或明确重置。' : null, blocked: Boolean(primary || backup) };
  }
  save(state: GameState, now: number, preserveBackup = false): void {
    const encoded = encodeSave(state, now);
    const current = this.store.getItem(SAVE_KEY);
    if (current && !preserveBackup) {
      let valid = false;
      try { decodeSave(current); valid = true; } catch { /* preserve valid backup */ }
      if (valid) this.store.setItem(BACKUP_KEY, current);
    }
    this.store.setItem(SAVE_KEY, encoded);
    if (this.store.getItem(SAVE_KEY) !== encoded) throw new Error('写入后读取不一致');
    if (!this.store.getItem(BACKUP_KEY)) this.store.setItem(BACKUP_KEY, encoded);
  }
  backupCurrent(state: GameState, now: number) {
    const encoded = encodeSave(state, now);
    this.store.setItem(BACKUP_KEY, encoded);
    if (this.store.getItem(BACKUP_KEY) !== encoded) throw new Error('恢复副本写入失败');
  }
  recovery(): GameState {
    const raw = this.store.getItem(BACKUP_KEY);
    if (!raw) throw new Error('尚无恢复副本');
    return decodeSave(raw).state;
  }
}
