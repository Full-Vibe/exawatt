// @vitest-environment jsdom
import { useState } from 'react';
import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type {
  PtyAttention,
  PtyReentryRecap,
} from '@exawatt/core/desktop-bridge';
import { useAttentionFocus } from './use-attention-focus';

afterEach(() => vi.restoreAllMocks());

it('acknowledges the same paused Session when its blurred window regains focus', () => {
  const hasFocus = vi.spyOn(document, 'hasFocus').mockReturnValue(false);
  const { result } = renderHook(() => {
    const [attention, setAttention] = useState<Record<string, PtyAttention>>({
      durable: { kind: 'blocked', since: 1, unread: true },
    });
    const [, setReentryRecap] = useState<PtyReentryRecap | null>(null);
    useAttentionFocus({
      activeSessionId: null,
      activeDurableSessionId: 'durable',
      setAttention,
      setReentryRecap,
    });
    return attention;
  });
  expect(result.current.durable.unread).toBe(true);
  hasFocus.mockReturnValue(true);
  act(() => window.dispatchEvent(new Event('focus')));
  expect(result.current.durable).toMatchObject({
    kind: 'blocked',
    since: 1,
    unread: false,
  });
});
