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
  getScreenLockState(): HostPowerSnapshot['screenLock'];
  on(event: HostPowerEvent, listener: () => void): unknown;
  removeListener(event: HostPowerEvent, listener: () => void): unknown;
}

export interface HostPowerObserver {
  getSnapshot(): HostPowerSnapshot;
  subscribe(listener: (snapshot: HostPowerSnapshot) => void): () => void;
  dispose(): void;
}

/** Called after Electron is ready. Observes only: no assertions, signals, or
 * Session references. Listeners belong to this observer and dispose together. */
export function observeHostPower(
  source: HostPowerSource,
  changed: (snapshot: HostPowerSnapshot) => void
): HostPowerObserver {
  const readPower = (): HostPowerSnapshot['powerSource'] => {
    try {
      return source.isOnBatteryPower() ? 'battery' : 'ac';
    } catch {
      return 'unknown';
    }
  };
  const readLock = (): HostPowerSnapshot['screenLock'] => {
    try {
      return source.getScreenLockState();
    } catch {
      return 'unknown';
    }
  };
  let snapshot: HostPowerSnapshot = {
    revision: 0,
    powerSource: 'unknown',
    screenLock: 'unknown',
    systemSleep: 'awake',
  };
  let disposed = false;
  let initializing = true;
  let powerObservation = 0;
  let lockObservation = 0;
  const subscribers = new Set<(snapshot: HostPowerSnapshot) => void>();
  const update = (patch: Partial<Omit<HostPowerSnapshot, 'revision'>>) => {
    if (disposed) return;
    if ('powerSource' in patch) powerObservation += 1;
    if ('screenLock' in patch) lockObservation += 1;
    const next = { ...snapshot, ...patch };
    if (
      next.powerSource === snapshot.powerSource &&
      next.screenLock === snapshot.screenLock &&
      next.systemSleep === snapshot.systemSleep
    )
      return;
    snapshot = {
      ...next,
      revision: snapshot.revision + (initializing ? 0 : 1),
    };
    if (initializing) return;
    changed({ ...snapshot });
    for (const listener of subscribers) listener({ ...snapshot });
  };
  // A newer event wins if a source delivers it during the snapshot read.
  const refresh = (awake = false) => {
    const powerBefore = powerObservation;
    const lockBefore = lockObservation;
    const powerSource = readPower();
    const screenLock = readLock();
    update({
      ...(awake ? { systemSleep: 'awake' as const } : {}),
      ...(powerBefore === powerObservation ? { powerSource } : {}),
      ...(lockBefore === lockObservation ? { screenLock } : {}),
    });
  };
  const listeners: Record<HostPowerEvent, () => void> = {
    'on-ac': () => update({ powerSource: 'ac' }),
    'on-battery': () => update({ powerSource: 'battery' }),
    'lock-screen': () => update({ screenLock: 'locked' }),
    'unlock-screen': () => update({ screenLock: 'unlocked' }),
    suspend: () => update({ systemSleep: 'suspended' }),
    // Power/lock can change while the process is suspended. Re-read both;
    // never convert wake into an invented unlock event.
    resume: () => refresh(true),
  };
  for (const event of Object.keys(listeners) as HostPowerEvent[]) {
    source.on(event, listeners[event]);
  }
  // Subscribe first: a lock between monitor construction and this sample
  // must not be lost. Reads happen only here and on resume, never on a timer.
  refresh();
  initializing = false;
  return {
    getSnapshot: () => ({ ...snapshot }),
    subscribe: listener => {
      if (!disposed) subscribers.add(listener);
      return () => {
        subscribers.delete(listener);
      };
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      subscribers.clear();
      for (const event of Object.keys(listeners) as HostPowerEvent[]) {
        source.removeListener(event, listeners[event]);
      }
    },
  };
}
