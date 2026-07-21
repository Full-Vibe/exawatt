import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ORDINAL_HINT_DELAY_MS,
  ordinalHintTarget,
  useOrdinalHints,
} from './use-ordinal-hints';

const key = (
  type: 'keydown' | 'keyup',
  modifiers: Partial<{ metaKey: boolean; ctrlKey: boolean; altKey: boolean }>
) =>
  act(() => {
    window.dispatchEvent(
      new KeyboardEvent(type, {
        metaKey: false,
        ctrlKey: false,
        altKey: false,
        ...modifiers,
      })
    );
  });

describe('ordinalHintTarget', () => {
  it('maps held modifiers to their ordinal family', () => {
    expect(ordinalHintTarget({ metaKey: true, ctrlKey: false, altKey: false })).toBe('tabs');
    expect(ordinalHintTarget({ metaKey: true, ctrlKey: false, altKey: true })).toBe('projects');
    expect(ordinalHintTarget({ metaKey: false, ctrlKey: false, altKey: true })).toBeNull();
    // ⌃⌘ is the altitude family, never an ordinal hint
    expect(ordinalHintTarget({ metaKey: true, ctrlKey: true, altKey: false })).toBeNull();
  });
});

describe('useOrdinalHints', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('reveals tab hints only after the hold delay', () => {
    const { result } = renderHook(() => useOrdinalHints());
    key('keydown', { metaKey: true });
    expect(result.current).toBeNull();
    act(() => vi.advanceTimersByTime(ORDINAL_HINT_DELAY_MS));
    expect(result.current).toBe('tabs');
    key('keyup', {});
    expect(result.current).toBeNull();
  });

  it('never flashes for a chord released before the delay', () => {
    const { result } = renderHook(() => useOrdinalHints());
    key('keydown', { metaKey: true });
    act(() => vi.advanceTimersByTime(100));
    key('keyup', {});
    act(() => vi.advanceTimersByTime(ORDINAL_HINT_DELAY_MS));
    expect(result.current).toBeNull();
  });

  it('retargets instantly between tabs and projects once revealed', () => {
    const { result } = renderHook(() => useOrdinalHints());
    key('keydown', { metaKey: true });
    act(() => vi.advanceTimersByTime(ORDINAL_HINT_DELAY_MS));
    expect(result.current).toBe('tabs');
    key('keydown', { metaKey: true, altKey: true });
    expect(result.current).toBe('projects');
    key('keyup', { metaKey: true });
    expect(result.current).toBe('tabs');
  });

  it('resets when the window blurs mid-hold (⌘Tab never delivers keyup)', () => {
    const { result } = renderHook(() => useOrdinalHints());
    key('keydown', { metaKey: true });
    act(() => vi.advanceTimersByTime(ORDINAL_HINT_DELAY_MS));
    expect(result.current).toBe('tabs');
    act(() => {
      window.dispatchEvent(new Event('blur'));
    });
    expect(result.current).toBeNull();
  });
});
