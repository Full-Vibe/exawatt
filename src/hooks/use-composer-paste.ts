'use client';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
} from 'react';
import { useLatestRequest } from '@/hooks/use-latest-request';

/** What a composer shows when a paste could not be read. */
export const COMPOSER_PASTE_FAILED =
  'Could not read the clipboard. Try pasting again.';

/**
 * The one paste system for every composer that writes to Agents on this
 * machine (the New Agent task, Direct, Chatter).
 *
 * The page cannot paste files or image data: a Finder copy hands it the files'
 * bare names and never where they live, and a screenshot hands it pixels an
 * Agent cannot read (BUG-353). Those pastes go to main, which returns exactly
 * what to insert: the files' paths, or the path of a private temp file holding
 * the image. A plain text paste keeps the textarea's native paste and undo.
 * Ctrl+V always reads through main, the chord Agent TUIs use for image paste.
 *
 * Clipboard I/O belongs to one composer visit. Draft and caret updates are
 * atomic even when several clipboard reads settle in one React batch
 * (BUG-120), and a read that settles after the visit ends commits nothing.
 */
export function useComposerPaste({
  scope = '',
  value,
  element,
  onInsert,
}: {
  /** what a visit is: a change ends every read still in flight (the New
   * Agent composer's Project). Omitted, the visit is the composer's mount. */
  scope?: string;
  value: string;
  element: () => HTMLTextAreaElement | null;
  onInsert: (value: string) => void;
}) {
  // One channel per composer visit: every paste in a visit may commit, and a
  // scope change ends the visit for all of them at once.
  const visits = useLatestRequest();
  const callbacks = useRef({ element, onInsert });
  const [pending, setPending] = useState(0);
  const [failed, setFailed] = useState(false);
  // The draft several clipboard reads settling in one batch build on. A value
  // or scope the composer commits from elsewhere restarts it at the end of
  // that text. Both refs sync after commit, never during render.
  const draft = useRef({ value, caret: value.length });
  useLayoutEffect(() => {
    callbacks.current = { element, onInsert };
  });
  useLayoutEffect(() => {
    draft.current = { value, caret: value.length };
  }, [scope, value]);
  // a failed read is news until the text moves on: an edit, a paste that
  // landed, or a send that cleared it
  useEffect(() => setFailed(false), [value]);

  useEffect(() => {
    setPending(0);
    setFailed(false);
    return () => visits.invalidate();
  }, [scope, visits]);

  /** Read the clipboard through main and insert it at the caret. `fallback`
   * is what the page itself saw, inserted when main finds nothing to paste. */
  const paste = useCallback(
    async (fallback = '') => {
      const visit = visits.current();
      setPending(count => count + 1);
      setFailed(false);
      try {
        const clip = await window.electron?.pty?.clipboardRead?.();
        if (!visit.current || !clip) return;
        // a pasted path is a word of the text: a space after it lets the
        // operator keep typing
        const inserted =
          clip.kind === 'files' || clip.kind === 'image'
            ? `${clip.text} `
            : clip.text || fallback;
        const node = callbacks.current.element();
        if (!inserted || !node) return;
        const current = draft.current;
        const start =
          node.value === current.value ? node.selectionStart : current.caret;
        const end =
          node.value === current.value ? node.selectionEnd : current.caret;
        const next =
          current.value.slice(0, start) + inserted + current.value.slice(end);
        current.value = next;
        current.caret = start + inserted.length;
        const retainedFocus = document.activeElement === node;
        callbacks.current.onInsert(next);
        requestAnimationFrame(() => {
          if (
            !visit.current ||
            !retainedFocus ||
            document.activeElement !== node
          )
            return;
          node.setSelectionRange(
            start + inserted.length,
            start + inserted.length
          );
        });
      } catch {
        if (visit.current) setFailed(true);
      } finally {
        if (visit.current) setPending(count => count - 1);
      }
    },
    [visits]
  );

  /** For `onPaste` / `onPasteCapture`: files and image data go to main. A
   * paste into another field of the composer is that field's own. */
  const onPaste = useCallback(
    (event: ClipboardEvent<HTMLElement>) => {
      const target = event.target;
      if (
        (target instanceof HTMLInputElement ||
          target instanceof HTMLTextAreaElement) &&
        target !== callbacks.current.element()
      )
        return;
      const data = event.clipboardData;
      const hasFiles = Array.from(data?.items ?? []).some(
        item => item.kind === 'file'
      );
      if (!hasFiles) return;
      event.preventDefault();
      void paste(data?.getData?.('text/plain') ?? '');
    },
    [paste]
  );

  /** For `onKeyDown` / `onKeyDownCapture`: true when it consumed Ctrl+V, so
   * the composer's own key handling stops there. */
  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>): boolean => {
      if (event.nativeEvent.isComposing) return false;
      if (event.key !== 'v' || !event.ctrlKey || event.metaKey || event.altKey)
        return false;
      event.preventDefault();
      event.stopPropagation();
      void paste();
      return true;
    },
    [paste]
  );

  return { onPaste, onKeyDown, pending: pending > 0, failed };
}
