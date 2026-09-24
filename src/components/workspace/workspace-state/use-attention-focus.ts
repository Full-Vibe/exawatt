'use client';

/**
 * The attention focus contract (S1): tell main which Session the operator is
 * looking at. The focused Session never flags, and focusing clears. The
 * local record clears optimistically; main confirms via `pty:attention`.
 * A re-entry recap belongs to the Session it was raised for and goes when
 * the operator looks elsewhere.
 */
import {
  useEffect,
  useLayoutEffect,
  type Dispatch,
  type SetStateAction,
} from 'react';
import type {
  PtyAttention,
  PtyReentryRecap,
} from '@exawatt/core/desktop-bridge';

export function useAttentionFocus({
  activeSessionId,
  setReentryRecap,
  setAttention,
}: {
  /** the live PTY incarnation behind the active tab, or null */
  activeSessionId: string | null;
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
    if (activeSessionId && document.hasFocus()) {
      setAttention(prev => {
        if (!(activeSessionId in prev)) return prev;
        const next = { ...prev };
        delete next[activeSessionId];
        return next;
      });
    }
  }, [activeSessionId, setAttention]);

  useEffect(() => {
    const api = window.electron?.pty;
    if (!api?.focus) return;
    void api.focus(activeSessionId);
    // Main remains authoritative for background-window attention and
    // broadcasts the confirmed clear to every renderer on focus.
    // leaving the workspace (unmount) unfocuses — flags accumulate again
    return () => void api.focus(null);
  }, [activeSessionId]);
}
