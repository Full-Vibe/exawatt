import path from 'path';
import type { HostPowerSnapshot } from '@exawatt/core/desktop-bridge';

type ScreenLock = HostPowerSnapshot['screenLock'];
interface IdleSource {
  getSystemIdleState(seconds: number): 'active' | 'idle' | 'locked' | 'unknown';
}

/** A snapshot capability, separate from Electron's future lock/unlock events.
 * On macOS the idle monitor begins with an unset lock flag, so its active/idle
 * answer cannot establish that a process started in an unlocked session. */
export function createScreenLockReader(
  idle: IdleSource,
  platform: NodeJS.Platform = process.platform,
  load: (file: string) => unknown = file => require(file)
): () => ScreenLock {
  if (platform !== 'darwin') {
    return () => {
      try {
        const state = idle.getSystemIdleState(1);
        return state === 'active' || state === 'idle' ? 'unlocked' : state;
      } catch {
        return 'unknown';
      }
    };
  }
  let read: (() => unknown) | undefined;
  try {
    // N-API binary is beside the compiled main and unpacked from the asar.
    const addon = load(
      path.join(__dirname, '..', 'native', 'screen-lock-snapshot.node')
    ) as { read?: unknown } | null;
    if (typeof addon?.read === 'function') read = addon.read.bind(addon);
  } catch {
    // Unsupported/missing native capability remains unknown. In particular,
    // never fall back to Electron's false-negative macOS idle-state answer.
  }
  return () => {
    try {
      const state = read?.();
      return state === 'locked' || state === 'unlocked' ? state : 'unknown';
    } catch {
      return 'unknown';
    }
  };
}
