import type { HostPowerSnapshot } from '@exawatt/core/desktop-bridge';

type HostPowerEvent =
  | 'on-ac'
  | 'on-battery'
  | 'lock-screen'
  | 'unlock-screen'
  | 'suspend'
  | 'resume';

interface HostPowerSource {
  isOnBatteryPower(): boolean;
  getSystemIdleState(seconds: number): 'active' | 'idle' | 'locked' | 'unknown';
  on(event: HostPowerEvent, listener: () => void): unknown;
  removeListener(event: HostPowerEvent, listener: () => void): unknown;
}

/** Called after Electron is ready. Observes only: no assertions, signals, or
 * Session references. Listeners belong to this observer and dispose together. */
export function observeHostPower(
  source: HostPowerSource,
  changed: (snapshot: HostPowerSnapshot) => void
): { getSnapshot: () => HostPowerSnapshot; dispose: () => void } {
  const readPower = (): HostPowerSnapshot['powerSource'] => {
    try {
      return source.isOnBatteryPower() ? 'battery' : 'ac';
    } catch {
      return 'unknown';
    }
  };
  const readLock = (): HostPowerSnapshot['screenLock'] => {
    try {
      const state = source.getSystemIdleState(1);
      return state === 'locked'
        ? 'locked'
        : state === 'active' || state === 'idle'
          ? 'unlocked'
          : 'unknown';
    } catch {
      return 'unknown';
    }
  };
  let snapshot: HostPowerSnapshot = {
    revision: 0,
    powerSource: readPower(),
    screenLock: readLock(),
    systemSleep: 'awake',
  };
  let disposed = false;
  const update = (patch: Partial<Omit<HostPowerSnapshot, 'revision'>>) => {
    if (disposed) return;
    const next = { ...snapshot, ...patch };
    if (
      next.powerSource === snapshot.powerSource &&
      next.screenLock === snapshot.screenLock &&
      next.systemSleep === snapshot.systemSleep
    )
      return;
    snapshot = { ...next, revision: snapshot.revision + 1 };
    changed({ ...snapshot });
  };
  const listeners: Record<HostPowerEvent, () => void> = {
    'on-ac': () => update({ powerSource: 'ac' }),
    'on-battery': () => update({ powerSource: 'battery' }),
    'lock-screen': () => update({ screenLock: 'locked' }),
    'unlock-screen': () => update({ screenLock: 'unlocked' }),
    suspend: () => update({ systemSleep: 'suspended' }),
    // Power/lock can change while the process is suspended. Re-read both;
    // never convert wake into an invented unlock event.
    resume: () =>
      update({
        systemSleep: 'awake',
        powerSource: readPower(),
        screenLock: readLock(),
      }),
  };
  for (const event of Object.keys(listeners) as HostPowerEvent[]) {
    source.on(event, listeners[event]);
  }
  return {
    getSnapshot: () => ({ ...snapshot }),
    dispose: () => {
      if (disposed) return;
      disposed = true;
      for (const event of Object.keys(listeners) as HostPowerEvent[]) {
        source.removeListener(event, listeners[event]);
      }
    },
  };
}
