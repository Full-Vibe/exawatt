import { EventEmitter } from 'events';
import { describe, expect, it, vi } from 'vitest';
import {
  stageNativeUpdate,
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

function manualTimers() {
  const pending: Array<{ run: () => void; cleared: boolean }> = [];
  return {
    timers: {
      setTimeout: (run: () => void) => {
        const entry = { run, cleared: false };
        pending.push(entry);
        return entry;
      },
      clearTimeout: (handle: unknown) => {
        (handle as { cleared: boolean }).cleared = true;
      },
    },
    fire: () => pending.filter(e => !e.cleared).forEach(e => e.run()),
  };
}

describe('stageNativeUpdate', () => {
  it('resolves when Squirrel has fetched and verified the update', async () => {
    const native = nativeDouble(n => n.emit('update-downloaded'));
    await expect(stageNativeUpdate(native)).resolves.toEqual({ ok: true });
    expect(native.checkForUpdates).toHaveBeenCalledOnce();
    expect(native.listenerCount('update-downloaded')).toBe(0);
    expect(native.listenerCount('error')).toBe(0);
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
    await expect(stageNativeUpdate(native)).resolves.toEqual({
      ok: false,
      reason: 'Could not locate update bundle for com.exawatt.app',
      timedOut: false,
    });
  });

  it('gives up at the deadline instead of waiting forever', async () => {
    const native = nativeDouble();
    const { timers, fire } = manualTimers();
    const staging = stageNativeUpdate(native, { deadlineMs: 180_000, timers });
    fire();
    await expect(staging).resolves.toEqual({
      ok: false,
      reason: 'Preparing the update did not finish within 180 seconds.',
      timedOut: true,
    });
    expect(native.listenerCount('error')).toBe(0);
  });
});

describe('watchNativeInstall', () => {
  it('reports a native install error', async () => {
    const native = nativeDouble();
    const watching = watchNativeInstall(native, {
      install: () => native.emit('error', new Error('ShipIt refused')),
    });
    await expect(watching).resolves.toEqual({
      ok: false,
      reason: 'ShipIt refused',
      timedOut: false,
    });
  });

  it('reports an app that is still running at the deadline', async () => {
    const native = nativeDouble();
    const { timers, fire } = manualTimers();
    const install = vi.fn();
    const watching = watchNativeInstall(native, { install, timers });
    expect(install).toHaveBeenCalledOnce();
    fire();
    await expect(watching).resolves.toMatchObject({
      ok: false,
      timedOut: true,
    });
  });

  it('reports an install call that throws', async () => {
    const native = nativeDouble();
    const watching = watchNativeInstall(native, {
      install: () => {
        throw new Error("No update available, can't quit and install");
      },
    });
    await expect(watching).resolves.toMatchObject({
      ok: false,
      reason: "No update available, can't quit and install",
    });
  });
});
