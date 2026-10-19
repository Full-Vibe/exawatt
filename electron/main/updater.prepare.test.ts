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

const { prepareProductUpdate, registerProductUpdater, reportUpdateRefused } =
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
  // Review of 0.1.22: the restart gave up on a slow Squirrel, the notice
  // said the update failed, and Squirrel's later acceptance flipped
  // `staged` underneath it, with no Restart to Update on screen.
  it('offers Restart to Update again when Squirrel accepts after the restart gave up', async () => {
    const slow = Object.assign(new EventEmitter(), {
      checkForUpdates: vi.fn(() => undefined),
    });
    nativeUpdater.current = slow;
    const controller = new AbortController();
    const preparing = prepareProductUpdate(controller.signal);
    controller.abort(new Error('timed out'));
    await expect(preparing).rejects.toThrow('timed out');
    reportUpdateRefused('Preparing the update did not finish.');
    expect(sent.at(-1)).toMatchObject({ phase: 'error' });

    slow.emit('update-downloaded');
    expect(sent.at(-1)).toMatchObject({
      phase: 'downloaded',
      availableVersion: '1.1.0',
      error: null,
    });
    await expect(prepareProductUpdate()).resolves.toBeNull();
    expect(slow.checkForUpdates).toHaveBeenCalledOnce();
    expect(slow.listenerCount('update-downloaded')).toBe(0);
    // A new download is one Squirrel has not seen.
    autoUpdater.listeners.get('update-downloaded')?.({ version: '1.1.0' });
  });

  it('answers a Squirrel refusal with its reason', async () => {
    native(n => n.emit('error', new Error('Could not locate update bundle')));

    await expect(prepareProductUpdate()).resolves.toBe(
      'Could not locate update bundle'
    );
    expect(records.map(([event]) => event)).toContain('updater.stage-failed');
  });

  it('shows a refused update as the failure notice with its reason', () => {
    reportUpdateRefused('Could not locate update bundle');
    expect(sent.at(-1)).toMatchObject({
      phase: 'error',
      error: 'Could not locate update bundle',
    });
  });

  it('stages once, then lets a repeated restart through without asking again', async () => {
    const staged = native(n => n.emit('update-downloaded'));

    await expect(prepareProductUpdate()).resolves.toBeNull();
    await expect(prepareProductUpdate()).resolves.toBeNull();

    expect(staged.checkForUpdates).toHaveBeenCalledOnce();
    expect(records.map(([event]) => event)).toContain('updater.staged');
  });
});
