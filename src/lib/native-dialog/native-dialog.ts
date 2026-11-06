'use client';

import { useSyncExternalStore } from 'react';
import { flushSync } from 'react-dom';
import type { DirectoryPickOutcome } from '@exawatt/core/desktop-bridge';

export type { DirectoryPickOutcome };

/**
 * The renderer's one door to native dialogs (ENG-016, BUG-327, BUG-339).
 *
 * Every folder request in this window goes through `requestDirectory`, and
 * main answers it through its dialog broker (`electron/main/native-dialogs.ts`).
 * Between them every request settles as picked, cancelled, or failed with a
 * reason, and the door does everything a request owes the screen, so no
 * caller has its own version of it:
 *
 * - The returned promise never rejects. A bridge call that throws, or no
 *   bridge at all, is a `failed` outcome.
 * - One request at a time per window: a second while one is up is `busy`,
 *   answered here without reaching main. `useFolderRequestPending` is that
 *   state for any control that should read as unavailable meanwhile.
 * - Focus: no web element keeps keyboard focus while AppKit owns the
 *   keyboard, so the door takes it from the control that asked and gives it
 *   back when the request settles, unless the screen moved it on meanwhile.
 * - Failure: a request that ended without the operator's answer says why in
 *   one place, `NativeDialogNotice`, whichever control asked.
 *
 * The web modal a request starts from stays where it is. The sheet slides
 * over the window, and cancelling it returns the operator to exactly the
 * screen they asked from.
 */

export interface NativeDialogFailure {
  /** Distinct per failure, so the same words twice are two notices. */
  readonly id: number;
  readonly message: string;
}

interface DoorState {
  readonly asking: boolean;
  readonly failure: NativeDialogFailure | null;
}

let state: DoorState = { asking: false, failure: null };
let failures = 0;
const listeners = new Set<() => void>();

function publish(next: Partial<DoorState>) {
  state = { ...state, ...next };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const failureFrom = (message: string | null): NativeDialogFailure | null =>
  message === null ? null : { id: ++failures, message };

/**
 * What the operator reads when a request ended without their answer, or
 * null when there is nothing to say: they cancelled, or another dialog of
 * theirs is already up.
 */
function failureMessage(outcome: DirectoryPickOutcome): string | null {
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

/** The control that has focus, if a control has it. */
function focusedControl(): HTMLElement | null {
  const focused = document.activeElement;
  return focused instanceof HTMLElement && focused !== document.body
    ? focused
    : null;
}

function restoreFocus(asker: HTMLElement | null) {
  if (!asker?.isConnected) return;
  // A focus trap that caught the blur parks focus on its own container;
  // that is not the screen moving on.
  const current = focusedControl();
  if (current && !current.contains(asker)) return;
  asker.focus({ preventScroll: true });
}

export function requestDirectory(title: string): Promise<DirectoryPickOutcome> {
  if (state.asking) {
    return Promise.resolve({ status: 'failed', reason: 'busy' });
  }
  const dialog =
    typeof window === 'undefined' ? undefined : window.electron?.dialog;
  if (!dialog) {
    const outcome: DirectoryPickOutcome = {
      status: 'failed',
      reason: 'unavailable',
    };
    publish({ failure: failureFrom(failureMessage(outcome)) });
    return Promise.resolve(outcome);
  }
  const asker = focusedControl();
  asker?.blur();
  publish({ asking: true, failure: null });
  return Promise.resolve()
    .then(() => dialog.openDirectory(title))
    .then(
      (outcome): DirectoryPickOutcome => outcome,
      (cause: unknown): DirectoryPickOutcome => ({
        status: 'failed',
        reason: 'error',
        detail: cause instanceof Error ? cause.message : String(cause),
      })
    )
    .then(outcome => {
      // Commit the released controls before focusing one: a control that
      // read as unavailable cannot take focus until it renders enabled.
      flushSync(() =>
        publish({
          asking: false,
          failure: failureFrom(failureMessage(outcome)),
        })
      );
      restoreFocus(asker);
      return outcome;
    });
}

/**
 * Say why a folder flow ended without a result, in the same place a failed
 * request says it: for a step after the pick (Locate's folder that is not a
 * Project), so the whole flow has one place to fail.
 */
export function reportFolderFailure(message: string): void {
  publish({ failure: failureFrom(message) });
}

/** Clear a failure, if it is still the one on screen. */
export function dismissNativeDialogFailure(id: number): void {
  if (state.failure?.id === id) publish({ failure: null });
}

/** A folder request is up in this window. */
export function useFolderRequestPending(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => state.asking,
    () => false
  );
}

/** The failure the door is reporting, if any. */
export function useNativeDialogFailure(): NativeDialogFailure | null {
  return useSyncExternalStore(
    subscribe,
    () => state.failure,
    () => null
  );
}
