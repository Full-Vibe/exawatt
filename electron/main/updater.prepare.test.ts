import { EventEmitter } from 'events';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const { autoUpdater, nativeUpdater, records, sent } = vi.hoisted(() => {
  const listeners = new Map<string, (...args: unknown[]) => void>();
  return {
    autoUpdater: {
      listeners,
      on: (event: string, listener: (...args: unknown[]) => void) =>
        void listeners.set(event, listener),
      setFeedURL: () => undefined,
      quitAndInstall: () => undefined,
    },
    nativeUpdater: { current: null as null | EventEmitter },
    records: [] as Array<[string, Record<string, unknown> | undefined]>,
    sent: [] as unknown[],
  };
});

vi.mock('electron', () => ({
  app: { name: 'Orbit', getVersion: () => '1.0.0', getPath: () => '/tmp' },
  get autoUpdater() {
    return nativeUpdater.current;
  },
  BrowserWindow: { getAllWindows: () => [] },
  dialog: { showMessageBox: vi.fn() },
}));
vi.mock('electron-updater', () => ({ autoUpdater }));
vi.mock('./ipc-security', () => ({ handleTrusted: () => undefined }));
vi.mock('./window-broadcast', () => ({
  broadcastToWindows: (_windows: unknown, _channel: string, status: unknown) =>
    void sent.push(status),
}));
vi.mock('./diagnostics-log', () => ({
  createDiagnosticsLog:
    () => (event: string, fields?: Record<string, unknown>) =>
      void records.push([event, fields]),
}));

const { prepareProductUpdate, registerProductUpdater } =
  await import('./updater');

/** Electron's native updater: checkForUpdates() reports only by event. */
function native(outcome: (n: EventEmitter) => void) {
  const emitter = Object.assign(new EventEmitter(), {
    checkForUpdates: vi.fn(() => setImmediate(() => outcome(emitter))),
  });
  nativeUpdater.current = emitter;
  return emitter;
}

const platform = process.platform;
beforeAll(() => {
  Object.defineProperty(process, 'platform', { value: 'darwin' });
  registerProductUpdater(
    'https://updates.example.test',
    () => 0,
    async () => true
  );
  autoUpdater.listeners.get('update-downloaded')?.({ version: '1.1.0' });
});
afterAll(() => {
  Object.defineProperty(process, 'platform', { value: platform });
});

describe('prepareProductUpdate', () => {
  it('turns a Squirrel refusal into an update failure with its reason', async () => {
    native(n => n.emit('error', new Error('Could not locate update bundle')));

    await expect(prepareProductUpdate()).resolves.toBe(false);

    expect(records.map(([event]) => event)).toContain('updater.stage-failed');
    expect(sent.at(-1)).toMatchObject({
      phase: 'error',
      error: 'Could not locate update bundle',
    });
  });

  it('stages once, then lets a repeated restart through without asking again', async () => {
    const staged = native(n => n.emit('update-downloaded'));

    await expect(prepareProductUpdate()).resolves.toBe(true);
    await expect(prepareProductUpdate()).resolves.toBe(true);

    expect(staged.checkForUpdates).toHaveBeenCalledOnce();
    expect(records.map(([event]) => event)).toContain('updater.staged');
  });
});
