// A queued exclusive Web Lock has no lease expiry and survives background
// throttling. Its callback must remain pending for the entire ownership period.
export class BrowserSession {
  private abort = new AbortController();
  private release: (() => void) | null = null;
  private stopped = false;
  async start(onAcquire: () => Promise<void>, onError: (message: string) => void) {
    if (!navigator.locks) { onError('此浏览器不支持运行会话锁。请使用支持 Web Locks 的浏览器并通过本地地址或 HTTPS 打开。'); return; }
    try {
      await navigator.locks.request('districtzero.writer.v1', { mode: 'exclusive', signal: this.abort.signal }, async () => {
        if (this.stopped) return;
        const held = new Promise<void>(resolve => { this.release = resolve; });
        await onAcquire();
        await held;
      });
    } catch (error) {
      if (!this.stopped) onError(error instanceof Error ? error.message : '无法取得运行会话');
    }
  }
  stop() { this.stopped = true; this.abort.abort(); this.release?.(); }
}
