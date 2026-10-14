import { advance, applyAction, createGame, summarize } from '../game/engine';
import { decodeSave, encodeSave } from '../game/saves';
import type { Action, GameState } from '../game/types';
import { BrowserSession } from './session';
import { SaveStorage } from './storage';

export interface Snapshot {
  state: GameState;
  owner: boolean;
  session: 'waiting' | 'active' | 'unsupported';
  busy: number | null;
  message: string | null;
  saveStatus: string;
  savedAt: number | null;
  storageBlocked: boolean;
}
export class GameController {
  private snapshot: Snapshot;
  private listeners = new Set<() => void>();
  private session = new BrowserSession();
  private storage: SaveStorage;
  private tail: Promise<void> = Promise.resolve();
  private interval: ReturnType<typeof setInterval> | null = null;
  private stopped = false;
  private lastSave = 0;
  constructor(private now: () => number = () => Date.now()) {
    let storage: Storage;
    try { storage = window.localStorage; } catch {
      const unavailable = () => { throw new Error('浏览器存储不可用'); };
      storage = { getItem: unavailable, setItem: unavailable, removeItem: unavailable } as unknown as Storage;
    }
    this.storage = new SaveStorage(storage);
    this.snapshot = { state: createGame(this.now()), owner: false, session: 'waiting', busy: null, message: null, saveStatus: '等待运行会话', savedAt: null, storageBlocked: false };
  }
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(patch: Partial<Snapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }
  private serialize(work: () => Promise<void> | void): Promise<void> {
    this.tail = this.tail.then(async () => { if (!this.stopped) await work(); }).catch(error => {
      this.publish({ busy: null, message: error instanceof Error ? error.message : '操作未完成，请重试' });
    });
    return this.tail;
  }
  start() {
    void this.session.start(async () => {
      // Reload only after the previous writer has released ownership.
      const loaded = this.storage.load();
      this.publish({ state: loaded.state ?? createGame(this.now()), owner: true, session: 'active', message: loaded.warning, storageBlocked: loaded.blocked ?? false });
      await this.serialize(async () => { await this.catchUp(true); this.save(); });
      if (this.stopped) return;
      this.interval = setInterval(() => {
        if (this.snapshot.busy !== null) return;
        void this.serialize(async () => { await this.catchUp(); if (this.now() - this.lastSave >= 10000) this.save(); });
      }, 1000);
    }, message => this.publish({ session: 'unsupported', owner: false, message }));
    document.addEventListener('visibilitychange', this.onVisibility);
    window.addEventListener('pagehide', this.onPageHide);
    window.addEventListener('pageshow', this.onPageShow);
  }
  private onVisibility = () => {
    if (!this.snapshot.owner) return;
    void this.serialize(async () => { await this.catchUp(); this.save(); });
  };
  private onPageHide = () => {
    // Saving the last fully settled state keeps any unprocessed interval
    // available for the next page to catch up, including abrupt closure.
    if (this.snapshot.owner) this.save();
    this.stop();
  };
  private onPageShow = (event: PageTransitionEvent) => { if (event.persisted) window.location.reload(); };
  stop() {
    this.stopped = true;
    if (this.interval !== null) clearInterval(this.interval);
    this.session.stop();
    this.publish({ owner: false });
    document.removeEventListener('visibilitychange', this.onVisibility);
    window.removeEventListener('pagehide', this.onPageHide);
  }
  private async catchUp(returning = false, preserveBackup = false) {
    if (!this.snapshot.owner) return;
    const now = Math.floor(this.now());
    const before = this.snapshot.state;
    const elapsed = Math.max(0, now - before.clock.lastAt);
    let state = before;
    let remaining = elapsed;
    const long = elapsed >= 30000;
    if (long) this.publish({ busy: 0 });
    while (remaining > 0) {
      const step = Math.min(remaining, 10_000_000);
      state = advance(state, step);
      remaining -= step;
      if (long && remaining > 0) {
        this.publish({ busy: Math.round((elapsed - remaining) / elapsed * 100) });
        await new Promise<void>(resolve => {
          const channel = new MessageChannel();
          channel.port1.onmessage = () => { channel.port1.close(); channel.port2.close(); resolve(); };
          channel.port2.postMessage(null);
        });
      }
      if (this.stopped) return;
    }
    state = { ...state, clock: { ...state.clock, lastAt: Math.max(now, state.clock.lastAt) } };
    if ((returning && elapsed >= 1000) || long) state.report = summarize(before, state, elapsed);
    this.publish({ state, busy: null });
    if (long) this.save(preserveBackup);
  }
  private save(preserveBackup = false) {
    if (!this.snapshot.owner) return;
    if (this.snapshot.storageBlocked) { this.publish({ saveStatus: '原始坏档保留，等待导入或重置' }); return; }
    try {
      const now = Math.floor(this.now());
      this.storage.save(this.snapshot.state, now, preserveBackup);
      this.lastSave = now;
      this.publish({ saveStatus: '已保存', savedAt: now });
    } catch (error) {
      this.publish({ saveStatus: `保存失败：${error instanceof Error ? error.message : '存储不可用'}。请导出存档。` });
    }
  }
  dispatch(action: Action) {
    return this.serialize(async () => {
      if (!this.snapshot.owner) { this.publish({ message: '另一页面正在运行，请关闭主页面后等待接管' }); return; }
      await this.catchUp();
      const result = applyAction(this.snapshot.state, action);
      this.publish({ state: result.state, message: result.error });
      if (!result.error) this.save();
    });
  }
  saveNow() { return this.serialize(async () => { await this.catchUp(); this.save(); }); }
  exportText() { return encodeSave(this.snapshot.state, Math.floor(this.now())); }
  previewImport(text: string) { return decodeSave(text); }
  importText(text: string) {
    return this.serialize(async () => {
      if (!this.snapshot.owner) { this.publish({ message: '只有运行中的主页面可以导入' }); return; }
      const imported = decodeSave(text).state;
      await this.catchUp();
      this.storage.backupCurrent(this.snapshot.state, Math.floor(this.now()));
      this.publish({ state: imported, storageBlocked: false, message: '已导入存档，替换前的进度保留在恢复副本中。' });
      await this.catchUp(true, true);
      this.save(true);
    });
  }
  restore() {
    return this.serialize(async () => {
      if (!this.snapshot.owner) return;
      const recovered = this.storage.recovery();
      this.publish({ state: recovered, storageBlocked: false, message: '已读取有效恢复副本。' });
      await this.catchUp(true, true); this.save(true);
    });
  }
  reset() {
    return this.serialize(() => {
      if (!this.snapshot.owner) return;
      // A confirmed reset replaces only this game's two named save slots.
      this.publish({ state: createGame(Math.floor(this.now())), storageBlocked: false, message: '已开始新的工务交接。' });
      this.storage.backupCurrent(this.snapshot.state, Math.floor(this.now()));
      this.save(true);
    });
  }
  clearMessage() { this.publish({ message: null }); }
}
