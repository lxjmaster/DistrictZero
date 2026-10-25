import { afterEach, describe, expect, it, vi } from 'vitest';
import { GameController } from '../../src/app/controller';
import { BrowserSession } from '../../src/app/session';
import { SAVE_KEY } from '../../src/app/storage';
import { createGame } from '../../src/game/engine';
import { decodeSave, encodeSave } from '../../src/game/saves';

let controller: GameController | undefined;
afterEach(() => { controller?.stop(); controller = undefined; vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function setup(primary?: string, failWrites = false) {
  const data = new Map<string, string>(primary ? [[SAVE_KEY, primary]] : []);
  vi.stubGlobal('window', { localStorage: {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { if (failWrites) throw new Error('quota'); data.set(key, value); }
  }, addEventListener: vi.fn(), removeEventListener: vi.fn() });
  vi.stubGlobal('document', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
  let acquired: Promise<void> | undefined;
  vi.spyOn(BrowserSession.prototype, 'start').mockImplementation(onAcquire => acquired = onAcquire());
  controller = new GameController(() => 2_000_000);
  return { controller, data, ready: () => acquired! };
}

describe('exporting the current valid game', () => {
  it('rejects export before acquiring ownership', () => {
    const { controller } = setup();
    expect(() => controller.exportText()).toThrow('主页面');
  });

  it('rejects export while settling and enables it after the complete interval', async () => {
    let resume: (() => void) | undefined;
    vi.stubGlobal('MessageChannel', class {
      port1 = { onmessage: () => {}, close() {} };
      port2 = { postMessage: () => { resume = () => this.port1.onmessage(); }, close() {} };
    });
    const { controller, ready } = setup(encodeSave(createGame(0), 0));
    controller.start();
    // The first batch yields with no partial state published for export.
    await vi.waitFor(() => expect(resume).toBeTypeOf('function'));
    expect(controller.getSnapshot().busy).not.toBeNull();
    expect(() => controller.exportText()).toThrow('结算');
    resume!(); await ready();
    expect(controller.getSnapshot().busy).toBeNull();
    const exported = decodeSave(controller.exportText()).state;
    expect(exported.clock.seconds).toBe(2000); expect(exported.clock.lastAt).toBe(2_000_000);
  });

  it('rejects placeholder export while preserving an incompatible save', async () => {
    const raw = JSON.stringify({ ...JSON.parse(encodeSave(createGame(0), 0)), schemaVersion: 99 });
    const { controller, data, ready } = setup(raw); controller.start(); await ready();
    expect(controller.getSnapshot().storageBlocked).toBe(true);
    expect(() => controller.exportText()).toThrow('原始存档');
    expect(data.get(SAVE_KEY)).toBe(raw);
  });

  it('allows the settled in-memory game to be exported after ordinary write failure', async () => {
    const { controller, ready } = setup(undefined, true); controller.start(); await ready();
    await controller.dispatch({ type: 'theme', theme: 'light' });
    expect(controller.getSnapshot().saveStatus).toContain('保存失败');
    expect(decodeSave(controller.exportText()).state.theme).toBe('light');
  });
});
