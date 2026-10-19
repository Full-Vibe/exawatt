import { EventEmitter } from 'events';
import { describe, expect, it, vi } from 'vitest';
import {
  createNativeStaging,
  watchNativeInstall,
  type NativeUpdater,
} from './updater-staging';

/**
 * Electron's native macOS `autoUpdater` is an EventEmitter whose
 * `checkForUpdates()` returns nothing and reports only through
 * `update-downloaded` and `error` (Squirrel.Mac's outcome). The double has
 * exactly that surface and nothing more.
 */
function nativeDouble(onCheck: (native: EventEmitter) => void = () => {}) {
  const emitter = new EventEmitter();
  const native = Object.assign(emitter, {
    checkForUpdates: vi.fn(() => onCheck(emitter)),
  });
  return native as typeof native & NativeUpdater;
}

const listeners = (native: EventEmitter) => ({
  downloaded: native.listenerCount('update-downloaded'),
  error: native.listenerCount('error'),
});

function staging(native: NativeUpdater) {
  const events = { accepted: vi.fn(), refused: vi.fn() };
  return { events, staging: createNativeStaging(native, events) };
}

describe('native staging', () => {
  it('resolves when Squirrel has fetched and verified the update', async () => {
    const native = nativeDouble(n => n.emit('update-downloaded'));
    const { staging: stage, events } = staging(native);
    await expect(stage.stage()).resolves.toBeNull();
    expect(stage.staged).toBe(true);
    expect(events.accepted).toHaveBeenCalledWith({ late: false });
    expect(native.checkForUpdates).toHaveBeenCalledOnce();
    expect(listeners(native)).toEqual({ downloaded: 0, error: 0 });
  });

  // Incident 0026's refusal, now heard before anything stops.
  it('carries the refusal reason when Squirrel rejects the bundle', async () => {
    const native = nativeDouble(n =>
      setImmediate(() =>
        n.emit(
          'error',
          new Error('Could not locate update bundle for com.exawatt.app')
        )
      )
    );
    const { staging: stage } = staging(native);
    await expect(stage.stage()).resolves.toBe(
      'Could not locate update bundle for com.exawatt.app'
    );
    expect(stage.staged).toBe(false);
    expect(listeners(native)).toEqual({ downloaded: 0, error: 0 });
  });

  it('answers a check that throws, and keeps no listener', async () => {
    const native = nativeDouble(() => {
      throw new Error('Update check failed');
    });
    const { staging: stage } = staging(native);
    await expect(stage.stage()).resolves.toBe('Update check failed');
    expect(listeners(native)).toEqual({ downloaded: 0, error: 0 });
  });

  // Review of 0.1.22: each abandoned restart left its listener pair on
  // the native updater, and a retry added another.
  it('stops waiting when abandoned, and a retry joins the same check', async () => {
    const native = nativeDouble();
    const { staging: stage } = staging(native);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const controller = new AbortController();
      const waiting = stage.stage(controller.signal);
      controller.abort(new Error('cancelled'));
      await expect(waiting).rejects.toThrow('cancelled');
    }
    expect(native.checkForUpdates).toHaveBeenCalledOnce();
    expect(listeners(native)).toEqual({ downloaded: 1, error: 1 });
  });

  // Review of 0.1.22: a late acceptance flipped `staged` while the notice
  // said the update had failed.
  it('hears an acceptance that arrives after every caller gave up', async () => {
    const native = nativeDouble();
    const { staging: stage, events } = staging(native);
    const controller = new AbortController();
    const waiting = stage.stage(controller.signal);
    controller.abort(new Error('timed out'));
    await expect(waiting).rejects.toThrow('timed out');

    native.emit('update-downloaded');
    expect(stage.staged).toBe(true);
    expect(events.accepted).toHaveBeenCalledWith({ late: true });
    expect(listeners(native)).toEqual({ downloaded: 0, error: 0 });
    await expect(stage.stage()).resolves.toBeNull();
    expect(native.checkForUpdates).toHaveBeenCalledOnce();
  });

  it('hears a refusal that arrives after every caller gave up', async () => {
    const native = nativeDouble();
    const { staging: stage, events } = staging(native);
    const controller = new AbortController();
    const waiting = stage.stage(controller.signal);
    controller.abort(new Error('timed out'));
    await expect(waiting).rejects.toThrow('timed out');

    native.emit('error', new Error('Code signature did not pass validation'));
    expect(events.refused).toHaveBeenCalledWith(
      'Code signature did not pass validation',
      { late: true }
    );
    expect(listeners(native)).toEqual({ downloaded: 0, error: 0 });
  });

  it('asks Squirrel again for a new download', async () => {
    const native = nativeDouble(n => n.emit('update-downloaded'));
    const { staging: stage } = staging(native);
    await stage.stage();
    stage.reset();
    expect(stage.staged).toBe(false);
    await stage.stage();
    expect(native.checkForUpdates).toHaveBeenCalledTimes(2);
  });
});

describe('watchNativeInstall', () => {
  it('reports a native install error', async () => {
    const native = nativeDouble();
    await expect(
      watchNativeInstall(native, () =>
        native.emit('error', new Error('ShipIt refused'))
      )
    ).resolves.toBe('ShipIt refused');
  });

  it('reports an install call that throws', async () => {
    const native = nativeDouble();
    await expect(
      watchNativeInstall(native, () => {
        throw new Error("No update available, can't quit and install");
      })
    ).resolves.toBe("No update available, can't quit and install");
  });

  it('stops listening when its wait ends', async () => {
    const native = nativeDouble();
    const controller = new AbortController();
    const watching = watchNativeInstall(native, () => {}, controller.signal);
    controller.abort(new Error('timed out'));
    await expect(watching).rejects.toThrow('timed out');
    expect(listeners(native).error).toBe(0);
  });
});
