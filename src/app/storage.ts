import { decodeSave, encodeSave, SaveVersionError } from '../game/saves';
import type { GameState } from '../game/types';

export const SAVE_KEY = 'districtzero.save.v1';
export const BACKUP_KEY = 'districtzero.save.backup.v1';
export interface StorageLike { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void }
export interface SaveOptions { preserveBackup?: boolean; replaceIncompatible?: boolean }
const incompatibleLoad = () => ({ state: null, warning: '存档版本不兼容，原始数据已保留，自动保存已停止。请使用兼容版本打开，或导入有效存档、明确重置。', blocked: true });
export class SaveStorage {
  constructor(private store: StorageLike) {}
  load(): { state: GameState | null; warning: string | null; blocked?: boolean } {
    let primary: string | null;
    try { primary = this.store.getItem(SAVE_KEY); } catch { return { state: null, warning: '浏览器存储不可用。可继续游玩，请导出存档保留进度。' }; }
    if (primary) {
      try { const loaded = decodeSave(primary); return { state: loaded.state, warning: loaded.migratedFrom ? `${({ 1: 'V0.1', 2: 'V0.2', 3: 'V0.3', 4: 'V0.3.1', 5: 'V0.3.2', 6: 'V0.3.3', 7: 'V0.4', 8: 'V0.5', 9: 'V0.6' })[loaded.migratedFrom]}存档已迁移：原有进度保留，可继续建设夜城、城际夜网、分所、历法与公约。` : null }; }
      catch (error) { if (error instanceof SaveVersionError) return incompatibleLoad(); /* read valid recovery copy */ }
    }
    let backup: string | null = null;
    try {
      backup = this.store.getItem(BACKUP_KEY);
      if (backup) return { state: decodeSave(backup).state, warning: '主存档缺失或损坏，已读取有效恢复副本。' };
    } catch (error) { if (error instanceof SaveVersionError) return incompatibleLoad(); /* leave invalid data untouched */ }
    return { state: null, warning: primary || backup ? '主存档与恢复副本均无法读取。原始数据保留，请导入有效存档或明确重置。' : null, blocked: Boolean(primary || backup) };
  }
  save(state: GameState, now: number, options: SaveOptions = {}): void {
    const encoded = encodeSave(state, now);
    const current = this.store.getItem(SAVE_KEY);
    if (current) {
      let valid = false;
      try { decodeSave(current); valid = true; }
      catch (error) { if (error instanceof SaveVersionError && !options.replaceIncompatible) throw error; /* preserve valid backup */ }
      if (valid && !options.preserveBackup) this.store.setItem(BACKUP_KEY, current);
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
