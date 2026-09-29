import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { observeHostPower } from './host-power';

function powerSource() {
  return Object.assign(new EventEmitter(), {
    isOnBatteryPower: vi.fn(() => false),
    getSystemIdleState: vi.fn<() => 'active' | 'locked' | 'unknown'>(
      () => 'active'
    ),
  });
}

describe('host power observations', () => {
  it('reports initial power and lock, then independently follows their events', () => {
    const source = powerSource();
    source.isOnBatteryPower.mockReturnValue(true);
    source.getSystemIdleState.mockReturnValue('locked');
    const changed = vi.fn();
    const observer = observeHostPower(source, changed);
    expect(observer.getSnapshot()).toMatchObject({
      powerSource: 'battery',
      screenLock: 'locked',
      systemSleep: 'awake',
    });
    source.emit('on-ac');
    expect(observer.getSnapshot()).toMatchObject({
      powerSource: 'ac',
      screenLock: 'locked',
    });
    source.emit('unlock-screen');
    expect(observer.getSnapshot()).toMatchObject({
      powerSource: 'ac',
      screenLock: 'unlocked',
    });
    const revision = observer.getSnapshot().revision;
    source.emit('unlock-screen');
    expect(observer.getSnapshot().revision).toBe(revision);
    observer.dispose();
  });

  it('shares one observation with owned subscribers and removes them on disposal', () => {
    const source = powerSource();
    const observer = observeHostPower(source, vi.fn());
    const first = vi.fn();
    const second = vi.fn();
    const off = observer.subscribe(first);
    observer.subscribe(second);
    source.emit('on-battery');
    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
    off();
    source.emit('on-ac');
    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledTimes(2);
    observer.dispose();
    source.emit('on-battery');
    expect(second).toHaveBeenCalledTimes(2);
  });

  it('refreshes power on wake without inferring that the display unlocked', () => {
    const source = powerSource();
    const observer = observeHostPower(source, vi.fn());
    source.emit('suspend');
    expect(observer.getSnapshot().systemSleep).toBe('suspended');
    source.isOnBatteryPower.mockReturnValue(true);
    source.getSystemIdleState.mockReturnValue('locked');
    source.emit('resume');
    expect(observer.getSnapshot()).toMatchObject({
      powerSource: 'battery',
      screenLock: 'locked',
      systemSleep: 'awake',
    });
    observer.dispose();
  });

  it('keeps unknown readings honest and removes only its own listeners', () => {
    const source = powerSource();
    source.isOnBatteryPower.mockImplementation(() => {
      throw new Error('unavailable');
    });
    source.getSystemIdleState.mockReturnValue('unknown');
    const sibling = vi.fn();
    source.on('on-battery', sibling);
    const changed = vi.fn();
    const observer = observeHostPower(source, changed);
    expect(observer.getSnapshot()).toMatchObject({
      powerSource: 'unknown',
      screenLock: 'unknown',
    });
    source.emit('lock-screen');
    expect(observer.getSnapshot().screenLock).toBe('locked');
    observer.dispose();
    observer.dispose();
    changed.mockClear();
    source.emit('on-battery');
    expect(changed).not.toHaveBeenCalled();
    expect(sibling).toHaveBeenCalledOnce();
    expect(source.eventNames()).toEqual(['on-battery']);
  });
});
