// @vitest-environment jsdom
import { useState } from 'react';
import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type {
  PtyAttention,
  PtyReentryRecap,
} from '@exawatt/core/desktop-bridge';
import {
  installBridgeDouble,
  removeBridgeDouble,
} from '@/test-support/desktop-bridge-double';
import { useAttentionFocus } from './use-attention-focus';

afterEach(() => {
  vi.restoreAllMocks();
  removeBridgeDouble();
});

it('acknowledges the same paused Session when its blurred window regains focus', () => {
  const focus = vi.fn().mockResolvedValue(undefined);
  installBridgeDouble({ pty: { focus } });
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
  expect(focus).toHaveBeenCalledWith('durable');
  hasFocus.mockReturnValue(true);
  act(() => window.dispatchEvent(new Event('focus')));
  expect(result.current.durable).toMatchObject({
    kind: 'blocked',
    since: 1,
    unread: false,
  });
});
