'use client';

/**
 * The open dialogs' primary actions, and the one chord that presses them
 * (BUG-049).
 *
 * D44/D57 made the product's verbs discoverable by construction: one manifest
 * entry owes a rebindable chord, a palette row and a native menu item, and an
 * omission has to be written down. A dialog's primary action is a verb the
 * product offers too, and it sat outside that contract — the Submit feedback
 * dialog's Send button was reachable by mouse alone and advertised nothing,
 * and the Edit Shortcut dialog's Save had the same gap. The only place in the
 * product where a dialog's default action stated itself was the ⌘W close
 * confirm, which prints `Close ⏎` on its own button face.
 *
 * So the chord is a manifest verb (`dialog-primary-action`, ⌘⏎, rebindable),
 * scoped to `modal-open`, and this module is the target it presses. Dialogs
 * that declare a primary action push it here while they are mounted; the
 * newest one wins, so a dialog opened over another answers for its own
 * Return. Nothing pushes a hardcoded keydown handler on one form.
 */

import { useEffect, useRef, useSyncExternalStore, type ReactNode } from 'react';

/** The manifest verb this module is the target of. */
export const DIALOG_PRIMARY_ACTION_SHORTCUT_ID = 'dialog-primary-action';

export interface DialogPrimaryActionSpec {
  /** The button's own words, and what the chord presses. */
  label: ReactNode;
  run: () => void;
  /** In flight, or the dialog does not have what it needs yet. */
  disabled?: boolean;
  /** macOS destructive default action. */
  destructive?: boolean;
  /** Accessible name when `label` is not plain text. */
  ariaLabel?: string;
}

/**
 * What a dialog says about its primary action. Either the action, or `none`
 * plus a written reason — the type forbids silence, the same way the command
 * verb manifest forbids an undiscoverable verb.
 */
export type DialogPrimaryActionDeclaration =
  | DialogPrimaryActionSpec
  | { none: string };

export function isDialogPrimaryAction(
  declaration: DialogPrimaryActionDeclaration
): declaration is DialogPrimaryActionSpec {
  return !('none' in declaration);
}

interface Slot {
  run: () => void;
  disabled: boolean;
}

const slots: Slot[] = [];
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const depth = () => slots.length;
const serverDepth = () => 0;

/**
 * How many open dialogs have a primary action. The shortcut provider turns
 * the `modal-open` context on from this, so the verb is inert everywhere
 * else and the ⌘/ sheet tells the truth about where it applies.
 */
export function useDialogPrimaryActionDepth(): number {
  return useSyncExternalStore(subscribe, depth, serverDepth);
}

/**
 * Publish this dialog's primary action for as long as it is mounted. The
 * handle is mutated in place on every render, so a label or a disabled state
 * that changes mid-dialog never needs a re-subscription.
 */
export function useDialogPrimaryActionSlot(
  action: DialogPrimaryActionSpec | null
): void {
  const slot = useRef<Slot>({ run: () => {}, disabled: true });
  slot.current.run = action?.run ?? (() => {});
  slot.current.disabled = action ? action.disabled === true : true;

  const active = action !== null;
  useEffect(() => {
    if (!active) return;
    const entry = slot.current;
    slots.push(entry);
    notify();
    return () => {
      const index = slots.lastIndexOf(entry);
      if (index >= 0) slots.splice(index, 1);
      notify();
    };
  }, [active]);
}

/**
 * Press the newest open dialog's primary action. Returns whether anything
 * ran, so a disabled action swallows the chord instead of falling through to
 * whatever else the keystroke would have done.
 */
export function runTopDialogPrimaryAction(): boolean {
  const slot = slots.at(-1);
  if (!slot || slot.disabled) return false;
  slot.run();
  return true;
}
