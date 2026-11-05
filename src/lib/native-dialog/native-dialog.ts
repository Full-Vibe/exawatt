'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { DirectoryPickOutcome } from '@exawatt/core/desktop-bridge';

export type { DirectoryPickOutcome };

/**
 * The renderer's one door to native dialogs (ENG-016, BUG-327).
 *
 * Every folder request in this window goes through `requestDirectory`, and
 * main answers it through its dialog broker (`electron/main/native-dialogs.ts`).
 * Between them every request settles as picked, cancelled, or failed with a
 * reason, so a control that waits on one always gets released:
 *
 * - The returned promise never rejects. A bridge call that throws, or no
 *   bridge at all, is a `failed` outcome.
 * - Main ends a request AppKit never began a sheet for as `not-presented`.
 * - One request at a time per window: a second while one is up is `busy`,
 *   answered here without reaching main.
 *
 * The web modal a request starts from stays where it is. The sheet slides
 * over the window, and cancelling it returns the operator to exactly the
 * screen they asked from. The focus handoff is the one thing a modal needs:
 * no web element keeps keyboard focus while AppKit owns the keyboard, and
 * `useNativeDialog` hands focus back to the control that asked.
 */
let inFlight: Promise<DirectoryPickOutcome> | null = null;

export function requestDirectory(title: string): Promise<DirectoryPickOutcome> {
  if (inFlight) return Promise.resolve({ status: 'failed', reason: 'busy' });
  const dialog =
    typeof window === 'undefined' ? undefined : window.electron?.dialog;
  if (!dialog) {
    return Promise.resolve({ status: 'failed', reason: 'unavailable' });
  }
  const focused = document.activeElement;
  if (focused instanceof HTMLElement && focused !== document.body) {
    focused.blur();
  }
  const request = Promise.resolve()
    .then(() => dialog.openDirectory(title))
    .then(
      (outcome): DirectoryPickOutcome => outcome,
      (cause: unknown): DirectoryPickOutcome => ({
        status: 'failed',
        reason: 'error',
        detail: cause instanceof Error ? cause.message : String(cause),
      })
    )
    .finally(() => {
      inFlight = null;
    });
  inFlight = request;
  return request;
}

/**
 * What the operator reads when a request ended without their answer, or
 * null when there is nothing to say: they cancelled, or another picker of
 * theirs is already up.
 */
export function nativeDialogFailureMessage(
  outcome: DirectoryPickOutcome
): string | null {
  if (outcome.status !== 'failed') return null;
  switch (outcome.reason) {
    case 'busy':
      return null;
    case 'not-presented':
      return 'The folder picker did not open. Try again.';
    case 'unavailable':
      return 'Open the desktop app to browse folders.';
    case 'error':
      return 'The folder picker could not be opened.';
  }
}

/**
 * A surface's view of its own folder requests: which one is up (`pending`,
 * named by the caller's own kind) and the request itself. `pending` clears
 * on every outcome, and focus returns to the control that asked unless the
 * surface has moved it on in the meantime (a review that opened, a dialog
 * that closed).
 */
export function useNativeDialog<Kind extends string>(): {
  pending: Kind | null;
  pickDirectory: (kind: Kind, title: string) => Promise<DirectoryPickOutcome>;
} {
  const [pending, setPending] = useState<Kind | null>(null);
  const asker = useRef<HTMLElement | null>(null);

  const pickDirectory = useCallback(
    async (kind: Kind, title: string): Promise<DirectoryPickOutcome> => {
      if (inFlight) return { status: 'failed', reason: 'busy' };
      const focused = document.activeElement;
      asker.current =
        focused instanceof HTMLElement && focused !== document.body
          ? focused
          : null;
      setPending(kind);
      try {
        return await requestDirectory(title);
      } finally {
        setPending(null);
      }
    },
    []
  );

  // After the control is enabled again, so it can take focus.
  useEffect(() => {
    if (pending !== null) return;
    const control = asker.current;
    asker.current = null;
    if (!control?.isConnected) return;
    // A focus trap that caught the blur parks focus on its own container;
    // that is not the surface moving on.
    const current = document.activeElement;
    if (current && current !== document.body && !current.contains(control)) {
      return;
    }
    control.focus({ preventScroll: true });
  }, [pending]);

  return { pending, pickDirectory };
}
