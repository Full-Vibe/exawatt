import path from 'path';
import type { HostPowerSnapshot } from '@exawatt/core/desktop-bridge';

type ScreenLock = HostPowerSnapshot['screenLock'];
interface IdleSource {
  getSystemIdleState(seconds: number): 'active' | 'idle' | 'locked' | 'unknown';
}

/** Decode the observed macOS sparse flag only within a valid console session.
 * Absence is the normal unlocked encoding on supported macOS, not an API
 * guarantee. This best-effort rendering input must never authorize actions. */
function decodeMacSession(value: unknown): ScreenLock {
  if (!value || typeof value !== 'object') return 'unknown';
  const facts = value as Record<string, unknown>;
  if (facts.locked === true) return 'locked';
  if (
    (facts.locked === false || facts.locked === 'absent') &&
    facts.onConsole === true &&
    facts.loginDone === true
  ) {
    return 'unlocked';
  }
  return 'unknown';
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
      return decodeMacSession(read?.());
    } catch {
      return 'unknown';
    }
  };
}
