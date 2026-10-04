'use client';

/**
 * The attention focus contract (S1): tell main which Session the operator is
 * looking at. Focus acknowledges inspection without resolving outstanding requests. The
 * local read bit updates optimistically; main confirms via `pty:attention`.
 * A re-entry recap belongs to the Session it was raised for and goes when
 * the operator looks elsewhere.
 */
import {
  useEffect,
  useLayoutEffect,
  type Dispatch,
  type SetStateAction,
} from 'react';
import { withAttentionRead } from '@exawatt/core';
import type {
  PtyAttention,
  PtyReentryRecap,
} from '@exawatt/core/desktop-bridge';

export function useAttentionFocus({
  activeSessionId,
  activeDurableSessionId,
  setReentryRecap,
  setAttention,
}: {
  /** the live PTY incarnation behind the active tab, or null */
  activeSessionId: string | null;
  activeDurableSessionId?: string | null;
  setReentryRecap: Dispatch<SetStateAction<PtyReentryRecap | null>>;
  setAttention: Dispatch<SetStateAction<Record<string, PtyAttention>>>;
}): void {
  useEffect(() => {
    setReentryRecap(current =>
      current?.id === activeSessionId ? current : null
    );
  }, [activeSessionId, setReentryRecap]);

  // A selected, visible tab is acknowledged before paint. A passive effect
  // used to leave one rendered frame where the newly active tab still wore
  // its old attention marker; main then confirmed the clear over IPC.
  useLayoutEffect(() => {
    const acknowledge = () => {
      if (!document.hasFocus()) return;
      const id = activeDurableSessionId ?? activeSessionId;
      if (!id) return;
      setAttention(prev => {
        const key = prev[id] ? id : activeSessionId;
        const signal = key ? prev[key] : undefined;
        if (!key || !signal || signal.unread === false) return prev;
        return { ...prev, [key]: withAttentionRead(signal, false) };
      });
    };
    acknowledge();
    // Paused Sessions have no main-process focus target. Returning to the app
    // must still acknowledge the retained record without requiring a tab hop.
    window.addEventListener('focus', acknowledge);
    return () => window.removeEventListener('focus', acknowledge);
  }, [activeSessionId, activeDurableSessionId, setAttention]);

  useEffect(() => {
    const api = window.electron?.pty;
    if (!api?.focus) return;
    void api.focus(activeSessionId);
    // Main remains authoritative for background-window attention and
    // broadcasts the confirmed read state to every renderer on focus.
    // leaving the workspace (unmount) unfocuses — flags accumulate again
    return () => void api.focus(null);
  }, [activeSessionId]);
}
