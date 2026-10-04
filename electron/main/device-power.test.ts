import { describe, expect, it, vi } from 'vitest';
import { sessionStatus } from '@exawatt/core';
import type { HostPowerSnapshot } from '@exawatt/core/desktop-bridge';
import { createDevicePowerController } from './device-power';

const host: HostPowerSnapshot = {
  revision: 0,
  powerSource: 'ac',
  screenLock: 'unlocked',
  systemSleep: 'awake',
};
const working = {
  harness: 'codex',
  status: 'working' as const,
  optOutAppliedAtLaunch: true,
};
function rig() {
  let next = 0;
  const held = new Set<number>();
  const port = {
    start: vi.fn(() => {
      held.add(++next);
      return next;
    }),
    stop: vi.fn((id: number) => {
      held.delete(id);
    }),
    isStarted: (id: number) => held.has(id),
  };
  const changed = vi.fn();
  return {
    port,
    held,
    changed,
    controller: createDevicePowerController(port, changed),
  };
}

describe('device-owned sleep prevention', () => {
  it('holds one display-sleep-compatible assertion across work and lock, releasing on unplug', () => {
    const { controller, port, held } = rig();
    controller.reconcile('ac-only', host, [working, working]);
    expect(port.start).toHaveBeenCalledExactlyOnceWith(
      'prevent-app-suspension'
    );
    controller.reconcile('ac-only', { ...host, screenLock: 'locked' }, [
      working,
    ]);
    expect(port.start).toHaveBeenCalledOnce();
    expect(port.stop).not.toHaveBeenCalled();
    controller.reconcile('ac-only', { ...host, powerSource: 'battery' }, [
      working,
    ]);
    expect(held.size).toBe(0);
    expect(port.stop).toHaveBeenCalledOnce();
    controller.reconcile('ac-only', { ...host, powerSource: 'battery' }, [
      working,
    ]);
    expect(port.stop).toHaveBeenCalledOnce();
    controller.reconcile('ac-only', host, [working]);
    expect(held.size).toBe(1);
    controller.dispose();
    controller.dispose();
    expect(held.size).toBe(0);
    expect(port.stop).toHaveBeenCalledTimes(2);
  });

  it('continues quit cleanup even when the native release throws', () => {
    const { controller, port } = rig();
    controller.reconcile('ac-only', host, [working]);
    port.stop.mockImplementationOnce(() => {
      throw new Error('native shutdown');
    });
    expect(() => controller.dispose()).not.toThrow();
    controller.dispose();
    expect(port.stop).toHaveBeenCalledOnce();
  });

  it('requires battery opt-in, and permits explicit sleep or unknown host observations', () => {
    const { controller, held } = rig();
    const battery = { ...host, powerSource: 'battery' as const };
    controller.reconcile('ac-and-battery', battery, [working]);
    expect(held.size).toBe(1);
    controller.reconcile('never', battery, [working]);
    expect(held.size).toBe(0);
    controller.reconcile(
      'ac-and-battery',
      { ...battery, systemSleep: 'suspended' },
      [working]
    );
    expect(held.size).toBe(0);
    controller.reconcile(
      'ac-and-battery',
      { ...host, powerSource: 'unknown' },
      [working]
    );
    expect(held.size).toBe(0);
  });

  it('never acquires for unmanaged sources, shells, or inactive work and reports the limitation', () => {
    const { controller, port } = rig();
    controller.reconcile('ac-and-battery', host, [
      { ...working, harness: 'claude', optOutAppliedAtLaunch: false },
      { ...working, harness: 'codex', optOutAppliedAtLaunch: false },
      { ...working, harness: 'shell' },
      ...(['idle', 'blocked', 'complete', 'error', 'reviewing'] as const).map(
        status => ({ ...working, status })
      ),
    ]);
    expect(port.start).not.toHaveBeenCalled();
    expect(controller.getSnapshot()).toMatchObject({
      supportedWorkingSessions: 0,
      independentSources: ['claude', 'codex'],
      assertion: 'inactive',
    });
  });

  it('follows silent reported turns and operator gates through the shared status contract', () => {
    const { controller, held } = rig();
    const base = {
      harness: 'codex' as const,
      exited: false,
      exitCode: null,
      exitSignal: null,
      working: false,
      engaged: true,
    };
    const status = sessionStatus(
      { ...base, delegation: { children: [], ownTurn: 'generating' } },
      0,
      100000,
      15000
    );
    controller.reconcile('ac-only', host, [{ ...working, status }]);
    expect(held.size).toBe(1);
    const blocked = sessionStatus(
      {
        ...base,
        attention: { kind: 'blocked', request: 'blocking', since: 1 },
        delegation: { children: [], ownTurn: 'generating' },
      },
      0,
      100000,
      15000
    );
    controller.reconcile('ac-only', host, [{ ...working, status: blocked }]);
    expect(held.size).toBe(0);
  });

  it('does not claim success if a native assertion fails or cannot be released', () => {
    const { controller, port } = rig();
    port.start.mockImplementationOnce(() => {
      throw new Error('native failure');
    });
    controller.reconcile('ac-only', host, [working]);
    expect(controller.getSnapshot().assertion).toBe('error');
    controller.reconcile('ac-only', host, [working]);
    expect(controller.getSnapshot().assertion).toBe('active');
    port.stop.mockImplementationOnce(() => {});
    controller.reconcile('never', host, [working]);
    expect(controller.getSnapshot().assertion).toBe('error');
    controller.reconcile('never', host, [working]);
    expect(controller.getSnapshot().assertion).toBe('inactive');
  });
});
