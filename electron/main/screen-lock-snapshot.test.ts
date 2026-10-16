import { describe, expect, it, vi } from 'vitest';
import { createScreenLockReader } from './screen-lock-snapshot';

function idleSource() {
  return {
    getSystemIdleState: vi.fn<() => 'active' | 'idle' | 'locked' | 'unknown'>(
      () => 'idle'
    ),
  };
}

describe('screen-lock snapshot source', () => {
  it('reads the macOS capability instead of treating idle as unlocked', () => {
    const idle = idleSource();
    const native = {
      read: vi.fn(() => ({ locked: true, onConsole: true, loginDone: true })),
    };
    const load = vi.fn(() => native);
    const read = createScreenLockReader(idle, 'darwin', load);
    expect(native.read).not.toHaveBeenCalled();
    expect(read()).toBe('locked');
    native.read.mockReturnValue({
      locked: false,
      onConsole: true,
      loginDone: true,
    });
    expect(read()).toBe('unlocked');
    expect(load).toHaveBeenCalledOnce();
    expect(idle.getSystemIdleState).not.toHaveBeenCalled();
  });

  it.each([null, {}, { read: false }])(
    'keeps unavailable native shape %j unknown',
    addon => {
      const idle = idleSource();
      expect(createScreenLockReader(idle, 'darwin', () => addon)()).toBe(
        'unknown'
      );
      expect(idle.getSystemIdleState).not.toHaveBeenCalled();
    }
  );

  it.each([undefined, null, false, true, '', 'idle', 'active', 'unknown'])(
    'does not turn native value %j into unlock',
    state => {
      expect(
        createScreenLockReader(idleSource(), 'darwin', () => ({
          read: () => state,
        }))()
      ).toBe('unknown');
    }
  );

  it.each([false, 'absent'])(
    'recognizes unlocked encoding %j only for a logged-in console session',
    locked => {
      const readFacts = (onConsole: unknown, loginDone: unknown) =>
        createScreenLockReader(idleSource(), 'darwin', () => ({
          read: () => ({ locked, onConsole, loginDone }),
        }))();
      expect(readFacts(true, true)).toBe('unlocked');
      for (const invalid of [false, 'absent', 'invalid', undefined, null, 1]) {
        expect(readFacts(invalid, true)).toBe('unknown');
        expect(readFacts(true, invalid)).toBe('unknown');
      }
    }
  );

  it.each(['invalid', undefined, null, 0, 1, 'false', 'true'])(
    'does not infer unlocked from malformed lock fact %j',
    locked => {
      expect(
        createScreenLockReader(idleSource(), 'darwin', () => ({
          read: () => ({ locked, onConsole: true, loginDone: true }),
        }))()
      ).toBe('unknown');
    }
  );

  it('gives an explicit lock precedence over unavailable session metadata', () => {
    expect(
      createScreenLockReader(idleSource(), 'darwin', () => ({
        read: () => ({ locked: true, onConsole: 'invalid', loginDone: false }),
      }))()
    ).toBe('locked');
  });

  it('contains both native loading and reading failures', () => {
    const fail = () => {
      throw new Error('native capability unavailable');
    };
    expect(createScreenLockReader(idleSource(), 'darwin', fail)()).toBe(
      'unknown'
    );
    expect(
      createScreenLockReader(idleSource(), 'darwin', () => ({ read: fail }))()
    ).toBe('unknown');
  });

  it.each(['linux', 'win32'] as const)(
    'preserves the Electron idle source on %s',
    platform => {
      const idle = idleSource();
      const load = vi.fn();
      const read = createScreenLockReader(idle, platform, load);
      for (const [state, expected] of [
        ['active', 'unlocked'],
        ['idle', 'unlocked'],
        ['locked', 'locked'],
        ['unknown', 'unknown'],
      ] as const) {
        idle.getSystemIdleState.mockReturnValue(state);
        expect(read()).toBe(expected);
      }
      idle.getSystemIdleState.mockImplementation(() => {
        throw new Error('unavailable');
      });
      expect(read()).toBe('unknown');
      expect(load).not.toHaveBeenCalled();
    }
  );
});
