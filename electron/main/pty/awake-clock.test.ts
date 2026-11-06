import { describe, expect, it } from 'vitest';
import type { HostPowerSnapshot } from '@exawatt/core/desktop-bridge';
import { createAwakeClock, feedAwakeClock } from './awake-clock';

describe('the awake clock', () => {
  it('stands still while the machine sleeps and runs on after', () => {
    let wall = 1_000;
    const clock = createAwakeClock(() => wall);
    expect(clock.now()).toBe(1_000);
    wall += 5_000;
    clock.suspended();
    wall += 414_000;
    // a sweep that runs on wake before `resume` arrives sees no sleep
    expect(clock.now()).toBe(6_000);
    clock.resumed();
    wall += 1_000;
    expect(clock.now()).toBe(7_000);
  });

  it('follows the host power observer’s sleep state', () => {
    let wall = 0;
    const clock = createAwakeClock(() => wall);
    const listeners = new Set<(snapshot: HostPowerSnapshot) => void>();
    const snapshot = (systemSleep: HostPowerSnapshot['systemSleep']) =>
      ({
        revision: 1,
        powerSource: 'ac',
        screenLock: 'unlocked',
        systemSleep,
      }) as HostPowerSnapshot;
    const off = feedAwakeClock(clock, {
      getSnapshot: () => snapshot('awake'),
      subscribe: listener => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    });
    for (const listener of listeners) listener(snapshot('suspended'));
    wall += 60_000;
    for (const listener of listeners) listener(snapshot('awake'));
    expect(clock.now()).toBe(0);
    off();
    expect(listeners.size).toBe(0);
  });
});
