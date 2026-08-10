import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  readTeamOrderPreference,
  TEAM_ORDER_STORAGE_KEY,
  useTeamOrderPreference,
} from './team-order-preference';

afterEach(() => window.localStorage.removeItem(TEAM_ORDER_STORAGE_KEY));

describe('useTeamOrderPreference (S6.3)', () => {
  it('defaults to Started and remembers Activity', () => {
    const { result } = renderHook(() => useTeamOrderPreference());
    expect(result.current.mode).toBe('started');

    act(() => result.current.setMode('activity'));
    expect(result.current.mode).toBe('activity');
    expect(readTeamOrderPreference()).toBe('activity');

    // a fresh mount — the next session — carries the stored choice on its
    // FIRST render, so Team never paints the wrong order and re-sorts
    const { result: next } = renderHook(() => useTeamOrderPreference());
    expect(next.current.mode).toBe('activity');
  });

  it('keeps two mounted Team surfaces in agreement', () => {
    const a = renderHook(() => useTeamOrderPreference());
    const b = renderHook(() => useTeamOrderPreference());
    act(() => a.result.current.setMode('activity'));
    expect(b.result.current.mode).toBe('activity');
  });

  it('reports ready, which is what holds the glide until the sort is known', () => {
    const { result } = renderHook(() => useTeamOrderPreference());
    expect(result.current.ready).toBe(true);
  });

  it('reads the pre-rename spelling as the activity sort', () => {
    window.localStorage.setItem(TEAM_ORDER_STORAGE_KEY, 'active-first');
    expect(readTeamOrderPreference()).toBe('activity');
  });

  it('treats an unknown stored value as the default', () => {
    window.localStorage.setItem(TEAM_ORDER_STORAGE_KEY, 'garbage');
    expect(readTeamOrderPreference()).toBe('started');
  });
});
