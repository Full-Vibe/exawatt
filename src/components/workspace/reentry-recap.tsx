'use client';

import { useEffect } from 'react';
import { History } from 'lucide-react';
import type { PtyReentryRecap } from '@/types/electron';
import { HUD } from '@/components/hud';

/** How long the ambient recap line stays before yielding back to the
 *  ordinary micro-context summary. */
const RECAP_LINE_MS = 45_000;

/**
 * Ambient re-entry recap (ENG-015 S4, reshaped by ENG-016 D18). The first
 * S4 slice floated a dismissible card over the terminal — dogfood rejected
 * it: it landed seconds after the operator had already started reading and
 * demanded a dismissal. The recap now lives INLINE in the context bar where
 * the micro-context summary normally sits: nothing covers the terminal,
 * nothing needs dismissing, and it expires on its own (or on the next real
 * keystroke, which makes it stale by definition).
 */
export function ReentryRecapLine({
  recap,
  onExpire,
}: {
  recap: PtyReentryRecap;
  onExpire: () => void;
}) {
  useEffect(() => {
    const timer = setTimeout(onExpire, RECAP_LINE_MS);
    // typing means the operator re-engaged — the "what changed" answer is
    // consumed; never swallow the keystroke itself
    const expireOnInput = () => onExpire();
    window.addEventListener('keydown', expireOnInput, { capture: true });
    return () => {
      clearTimeout(timer);
      window.removeEventListener('keydown', expireOnInput, { capture: true });
    };
  }, [onExpire, recap.generatedAt]);

  return (
    <span
      data-reentry-recap
      role="status"
      aria-live="polite"
      className="flex min-w-0 flex-1 items-baseline gap-1.5 border-l pl-3 text-sm leading-5"
      style={{ borderColor: 'rgba(25,230,255,0.28)' }}
    >
      <History
        aria-hidden="true"
        className="h-3.5 w-3.5 shrink-0 self-center"
        style={{ color: HUD.cyan }}
      />
      <span
        className="shrink-0 font-mono text-chrome-label"
        style={{ color: HUD.cyan }}
      >
        since you left
      </span>
      <span className="line-clamp-2 min-w-0" style={{ color: HUD.text }}>
        {recap.text}
      </span>
    </span>
  );
}
