import { useCallback, useEffect, useRef, useState } from 'react';

/** Clipboard I/O belongs to one composer visit. Draft and caret updates are
 * atomic even when several clipboard reads settle in one React batch. */
export function useComposerClipboard({
  scope,
  task,
  element,
  onInsert,
}: {
  scope: string;
  task: string;
  element: () => HTMLTextAreaElement | null;
  onInsert: (task: string) => void;
}) {
  const visit = useRef(0);
  const callbacks = useRef({ element, onInsert });
  callbacks.current = { element, onInsert };
  const [pending, setPending] = useState(0);
  const [failed, setFailed] = useState(false);
  const draft = useRef({ scope, renderedTask: task, task, caret: task.length });
  if (draft.current.scope !== scope || draft.current.renderedTask !== task) {
    draft.current = { scope, renderedTask: task, task, caret: task.length };
  }

  useEffect(() => {
    setPending(0);
    setFailed(false);
    return () => {
      visit.current += 1;
    };
  }, [scope]);

  const paste = useCallback(async () => {
    const startedVisit = visit.current;
    setPending(count => count + 1);
    setFailed(false);
    try {
      const clip = await window.electron?.pty?.clipboardRead?.();
      if (startedVisit !== visit.current || !clip) return;
      const value =
        clip.kind === 'image'
          ? clip.path
            ? `${clip.path} `
            : ''
          : (clip.text ?? '');
      const node = callbacks.current.element();
      if (!value || !node) return;
      const current = draft.current;
      const start =
        node.value === current.task ? node.selectionStart : current.caret;
      const end =
        node.value === current.task ? node.selectionEnd : current.caret;
      const nextTask =
        current.task.slice(0, start) + value + current.task.slice(end);
      current.task = nextTask;
      current.caret = start + value.length;
      const retainedFocus = document.activeElement === node;
      callbacks.current.onInsert(nextTask);
      requestAnimationFrame(() => {
        if (
          startedVisit !== visit.current ||
          !retainedFocus ||
          document.activeElement !== node
        )
          return;
        node.setSelectionRange(start + value.length, start + value.length);
      });
    } catch {
      if (startedVisit === visit.current) setFailed(true);
    } finally {
      if (startedVisit === visit.current) setPending(count => count - 1);
    }
  }, []);

  return { paste, pending: pending > 0, failed };
}
