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
    expect(restore).toHaveBeenCalledWith('/settings');
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
});
