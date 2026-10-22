import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { observeHostPower } from './host-power';

function powerSource() {
  return Object.assign(new EventEmitter(), {
    isOnBatteryPower: vi.fn(() => false),
    getScreenLockState: vi.fn<() => 'unlocked' | 'locked' | 'unknown'>(
      () => 'unlocked'
    ),
  });
}

describe('host power observations', () => {
  it('subscribes before sampling and reads only at startup and resume', () => {
    const source = powerSource();
    source.getScreenLockState.mockImplementation(() => {
      expect(source.listenerCount('lock-screen')).toBe(1);
      expect(source.listenerCount('unlock-screen')).toBe(1);
      return 'locked';
    });
    const observer = observeHostPower(source, vi.fn());
    expect(observer.getSnapshot().revision).toBe(0);
    source.emit('on-battery');
    source.emit('unlock-screen');
    source.emit('lock-screen');
    source.emit('suspend');
    observer.getSnapshot();
    expect(source.getScreenLockState).toHaveBeenCalledOnce();
    source.emit('resume');
    expect(source.getScreenLockState).toHaveBeenCalledTimes(2);
    expect(observer.getSnapshot().screenLock).toBe('locked');
    observer.dispose();
  });

  it('does not overwrite a newer lock event delivered during a snapshot read', () => {
    const source = powerSource();
    source.getScreenLockState.mockImplementation(() => {
      source.emit('lock-screen');
      return 'unlocked';
    });
    const changed = vi.fn();
    const observer = observeHostPower(source, changed);
    expect(observer.getSnapshot().screenLock).toBe('locked');
    expect(changed).not.toHaveBeenCalled();
    source.emit('unlock-screen');
    source.emit('resume');
    expect(observer.getSnapshot().screenLock).toBe('locked');
    observer.dispose();
  });

  it('preserves unknown on resume instead of inventing an unlock', () => {
    const source = powerSource();
    const observer = observeHostPower(source, vi.fn());
    source.emit('lock-screen');
    source.getScreenLockState.mockReturnValue('unknown');
    source.emit('resume');
    expect(observer.getSnapshot().screenLock).toBe('unknown');
    source.getScreenLockState.mockImplementation(() => {
      throw new Error('native snapshot unavailable');
    });
    source.emit('resume');
    expect(observer.getSnapshot().screenLock).toBe('unknown');
    source.emit('unlock-screen');
    expect(observer.getSnapshot().screenLock).toBe('unlocked');
    observer.dispose();
  });

  it('re-reads an unknown lock on a power event, never a known one', () => {
    // BUG-300: a board whose lock read was unknown kept ambient motion parked
    // through `on-ac`, because only `resume` asked the native reader again.
    const source = powerSource();
    source.getScreenLockState.mockReturnValue('unknown');
    const changed = vi.fn();
    const observer = observeHostPower(source, changed);
    expect(observer.getSnapshot().screenLock).toBe('unknown');
    source.getScreenLockState.mockReturnValue('unlocked');
    source.emit('on-ac');
    expect(observer.getSnapshot()).toMatchObject({
      powerSource: 'ac',
      screenLock: 'unlocked',
    });
    expect(changed).toHaveBeenLastCalledWith(
      expect.objectContaining({ screenLock: 'unlocked' })
    );
    const reads = source.getScreenLockState.mock.calls.length;
    source.emit('on-battery');
    expect(source.getScreenLockState).toHaveBeenCalledTimes(reads);
    observer.dispose();
  });

  it('keeps an unknown lock unknown when the re-read cannot answer', () => {
    const source = powerSource();
    source.getScreenLockState.mockReturnValue('unknown');
    const observer = observeHostPower(source, vi.fn());
    source.emit('on-battery');
    expect(observer.getSnapshot()).toMatchObject({
      powerSource: 'battery',
      screenLock: 'unknown',
    });
    observer.dispose();
  });

  it('reports initial power and lock, then independently follows their events', () => {
    const source = powerSource();
    source.isOnBatteryPower.mockReturnValue(true);
    source.getScreenLockState.mockReturnValue('locked');
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
    source.getScreenLockState.mockReturnValue('locked');
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
    source.getScreenLockState.mockReturnValue('unknown');
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
