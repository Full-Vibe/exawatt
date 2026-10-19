import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  captureHeldState,
  registerHeldState,
  resetHeldStateForTest,
  restoreHeldState,
} from './held-state';

afterEach(() => resetHeldStateForTest());

const text = (value: unknown) => (typeof value === 'string' ? value : null);

describe('held state', () => {
  it('captures every holder that holds something', () => {
    registerHeldState('navigation', {
      capture: () => '/fleet/spatial',
      parse: text,
      restore: () => undefined,
    });
    registerHeldState('empty', {
      capture: () => null,
      parse: text,
      restore: () => undefined,
    });
    registerHeldState('broken', {
      capture: () => {
        throw new Error('unmounted');
      },
      parse: text,
      restore: () => undefined,
    });
    expect(captureHeldState()).toEqual({ navigation: '/fleet/spatial' });
  });

  it('holds nothing when no holder does', () => {
    expect(captureHeldState()).toBeNull();
  });

  it('restores a holder that registers after the hand-back, once', () => {
    restoreHeldState({ navigation: '/settings' });
    const restore = vi.fn();
    registerHeldState('navigation', {
      capture: () => null,
      parse: text,
      restore,
    });
    expect(restore).toHaveBeenCalledWith('/settings', expect.any(Function));
    registerHeldState('navigation', {
      capture: () => null,
      parse: text,
      restore,
    });
    expect(restore).toHaveBeenCalledOnce();
  });

  it('restores nothing its holder does not recognise', () => {
    const restore = vi.fn();
    registerHeldState('navigation', {
      capture: () => null,
      parse: text,
      restore,
    });
    restoreHeldState({ navigation: { href: 'javascript:alert(1)' } });
    expect(restore).not.toHaveBeenCalled();
  });

  // Review of 0.1.22: a holder that threw while restoring took the window
  // down after a restart.
  it('restores every other holder when one throws, and records which', () => {
    const report = vi.fn();
    const restored = vi.fn();
    registerHeldState('navigation', {
      capture: () => null,
      parse: text,
      restore: restored,
    });
    registerHeldState('broken', {
      capture: () => null,
      parse: text,
      restore: () => {
        throw new Error('quota');
      },
    });
    expect(() =>
      restoreHeldState({ broken: 'x', navigation: '/settings' }, report)
    ).not.toThrow();
    expect(restored).toHaveBeenCalledWith('/settings', expect.any(Function));
    expect(report).toHaveBeenCalledWith({
      holder: 'broken',
      entry: null,
      error: expect.objectContaining({ message: 'quota' }),
    });
  });

  it('contains a failure of a holder that registers after the hand-back', () => {
    const report = vi.fn();
    restoreHeldState({ late: 'x' }, report);
    expect(() =>
      registerHeldState('late', {
        capture: () => null,
        parse: () => {
          throw new Error('bad shape');
        },
        restore: () => undefined,
      })
    ).not.toThrow();
    expect(report).toHaveBeenCalledWith(
      expect.objectContaining({ holder: 'late', entry: null })
    );
  });

  it("records a holder's own failed entries without losing the rest", () => {
    const report = vi.fn();
    registerHeldState<string[]>('entries', {
      capture: () => null,
      parse: value => (Array.isArray(value) ? (value as string[]) : null),
      restore: (entries, failed) => {
        for (const entry of entries) {
          if (entry === 'full') failed(entry, new Error('quota'));
        }
      },
    });
    restoreHeldState({ entries: ['a', 'full', 'b'] }, report);
    expect(report).toHaveBeenCalledOnce();
    expect(report).toHaveBeenCalledWith({
      holder: 'entries',
      entry: 'full',
      error: expect.objectContaining({ message: 'quota' }),
    });
  });
});
