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

describe('stageNativeUpdate', () => {
  it('resolves when Squirrel has fetched and verified the update', async () => {
    const native = nativeDouble(n => n.emit('update-downloaded'));
    await expect(stageNativeUpdate(native)).resolves.toBeNull();
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
    await expect(stageNativeUpdate(native)).resolves.toBe(
      'Could not locate update bundle for com.exawatt.app'
    );
    expect(native.listenerCount('error')).toBe(0);
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
});
