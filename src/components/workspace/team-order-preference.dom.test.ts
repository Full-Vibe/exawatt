import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  readTeamOrderPreference,
  TEAM_ORDER_STORAGE_KEY,
  useTeamOrderPreference,
} from './team-order-preference';

afterEach(() => window.localStorage.removeItem(TEAM_ORDER_STORAGE_KEY));

describe('useTeamOrderPreference (S6.3)', () => {
  it('defaults to created and remembers active-first', () => {
    const { result } = renderHook(() => useTeamOrderPreference());
    expect(result.current[0]).toBe('started');

    act(() => result.current[1]('activity'));
    expect(result.current[0]).toBe('activity');
    expect(readTeamOrderPreference()).toBe('activity');

    // a fresh mount — the next session — reads the stored choice
    const { result: next } = renderHook(() => useTeamOrderPreference());
    expect(next.current[0]).toBe('activity');
  });

  it('keeps two mounted Team surfaces in agreement', () => {
    const a = renderHook(() => useTeamOrderPreference());
    const b = renderHook(() => useTeamOrderPreference());
    act(() => a.result.current[1]('activity'));
    expect(b.result.current[0]).toBe('activity');
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
