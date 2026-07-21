// No 'use client' directive: only imported by the client workspace surface.

/**
 * Modifier-held ordinal hints (ENG-016 D21). The strip's shortcut ordinals
 * (⌘1–9 tabs, ⌘⌥1–9 Projects) are keyboard HINTS, not identity — rendered
 * always-on they read as a digit soup beside the attention count. So the
 * strip rests clean and the digits reveal only while their chord's
 * modifiers are held: hold ⌘ → tab keycaps, hold ⌘⌥ → Project keycaps.
 * A short hold delay keeps ⌘C-speed chords from flashing; once revealed,
 * the target retargets instantly when ⌥ joins or leaves.
 */
import { useEffect, useState } from 'react';

export type OrdinalHintMode = 'tabs' | 'projects' | null;

/** Which ordinal family do these held modifiers target? Pure. ⌃ excluded:
 *  ⌃⌘digit is the altitude family, not an ordinal chord. */
export function ordinalHintTarget(modifiers: {
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
}): OrdinalHintMode {
  if (!modifiers.metaKey || modifiers.ctrlKey) return null;
  return modifiers.altKey ? 'projects' : 'tabs';
}

export const ORDINAL_HINT_DELAY_MS = 350;

export function useOrdinalHints(): OrdinalHintMode {
  const [mode, setMode] = useState<OrdinalHintMode>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let pending: OrdinalHintMode = null;
    let revealed: OrdinalHintMode = null;
    const cancel = () => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      pending = null;
    };
    const apply = (target: OrdinalHintMode) => {
      if (target === null) {
        cancel();
        if (revealed !== null) {
          revealed = null;
          setMode(null);
        }
        return;
      }
      if (revealed !== null) {
        // already revealed: follow ⌥ immediately, no second delay
        cancel();
        if (revealed !== target) {
          revealed = target;
          setMode(target);
        }
        return;
      }
      if (pending === target) return;
      cancel();
      pending = target;
      timer = setTimeout(() => {
        timer = null;
        pending = null;
        revealed = target;
        setMode(target);
      }, ORDINAL_HINT_DELAY_MS);
    };
    // capture phase: xterm and inputs stop propagation of plain keys, but
    // modifier keydown/keyup still reach a capture listener on window
    const onKey = (event: KeyboardEvent) => apply(ordinalHintTarget(event));
    // a chord that switches away mid-hold (⌘Tab) never delivers the keyup
    const reset = () => apply(null);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('keyup', onKey, true);
    window.addEventListener('blur', reset);
    document.addEventListener('visibilitychange', reset);
    return () => {
      cancel();
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('keyup', onKey, true);
      window.removeEventListener('blur', reset);
      document.removeEventListener('visibilitychange', reset);
    };
  }, []);

  return mode;
}
