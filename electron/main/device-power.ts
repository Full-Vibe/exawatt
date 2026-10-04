import type { AgentWorkState } from '@exawatt/core';
import type {
  DeviceKeepAwakePolicy,
  DevicePowerStatus,
  HostPowerSnapshot,
} from '@exawatt/core/desktop-bridge';

interface PowerSession {
  harness: string;
  status: AgentWorkState;
  optOutAppliedAtLaunch: boolean;
}

interface AssertionPort {
  start(type: 'prevent-app-suspension'): number;
  stop(id: number): void;
  isStarted(id: number): boolean;
}

/** One owner, one assertion. Lock and renderer visibility deliberately have
 * no role here. The caller supplies LOCAL Session truth from the same selector
 * that paints the UI, including silent turns, children, and attention gates. */
export function createDevicePowerController(
  port: AssertionPort,
  changed: (status: DevicePowerStatus) => void
) {
  let ownedId: number | null = null;
  let disposed = false;
  let status: DevicePowerStatus = {
    revision: 0,
    policy: 'ac-only',
    powerSource: 'unknown',
    assertion: 'inactive',
    supportedWorkingSessions: 0,
    independentSources: [],
    error: null,
  };
  const reconcile = (
    policy: DeviceKeepAwakePolicy,
    host: HostPowerSnapshot,
    sessions: readonly PowerSession[]
  ) => {
    if (disposed) return;
    let supportedWorkingSessions = 0;
    const independent = new Set<string>();
    for (const session of sessions) {
      if (session.harness === 'shell' || session.status !== 'working') continue;
      if (session.optOutAppliedAtLaunch) supportedWorkingSessions++;
      else independent.add(session.harness);
    }
    const shouldHold =
      supportedWorkingSessions > 0 &&
      host.systemSleep === 'awake' &&
      host.powerSource !== 'unknown' &&
      (policy === 'ac-and-battery' ||
        (policy === 'ac-only' && host.powerSource === 'ac'));
    let error: string | null = null;
    try {
      if (ownedId !== null && !port.isStarted(ownedId)) ownedId = null;
      if (shouldHold && ownedId === null) {
        ownedId = port.start('prevent-app-suspension');
        if (!port.isStarted(ownedId)) {
          ownedId = null;
          error = 'Exawatt could not start sleep prevention.';
        }
      } else if (!shouldHold && ownedId !== null) {
        port.stop(ownedId);
        if (port.isStarted(ownedId))
          error = 'Exawatt could not release sleep prevention.';
        else ownedId = null;
      }
    } catch {
      error = shouldHold
        ? 'Exawatt could not start sleep prevention.'
        : 'Exawatt could not release sleep prevention.';
    }
    const next: DevicePowerStatus = {
      revision: status.revision,
      policy,
      powerSource: host.powerSource,
      assertion: error ? 'error' : ownedId !== null ? 'active' : 'inactive',
      supportedWorkingSessions,
      independentSources: [...independent].sort(),
      error,
    };
    if (JSON.stringify(next) === JSON.stringify(status)) return;
    status = { ...next, revision: status.revision + 1 };
    changed({ ...status, independentSources: [...status.independentSources] });
  };
  return {
    reconcile,
    getSnapshot: () => ({
      ...status,
      independentSources: [...status.independentSources],
    }),
    dispose: () => {
      if (disposed) return;
      disposed = true;
      if (ownedId !== null) {
        try {
          port.stop(ownedId);
        } catch {
          // Native process teardown releases its assertions. A failed release
          // must not prevent the remaining application quit cleanup.
        }
        ownedId = null;
      }
    },
  };
}
