'use client';

import { useEffect } from 'react';
import { History, X } from 'lucide-react';
import type { PtyReentryRecap } from '@/types/electron';
import { HUD } from '@/components/hud';

export function ReentryRecapCard({
  recap,
  title,
  context,
  onDismiss,
}: {
  recap: PtyReentryRecap;
  title: string;
  context?: string;
  onDismiss: () => void;
}) {
  useEffect(() => {
    const dismissOnInput = () => onDismiss();
    window.addEventListener('keydown', dismissOnInput, { capture: true });
    return () =>
      window.removeEventListener('keydown', dismissOnInput, { capture: true });
  }, [onDismiss]);

  return (
    <section
      data-reentry-recap
      role="status"
      aria-live="polite"
      className="pointer-events-none absolute left-1/2 top-4 z-20 w-[min(34rem,calc(100%-2rem))] -translate-x-1/2 rounded border px-4 py-3 shadow-2xl"
      style={{
        color: HUD.text,
        borderColor: 'rgba(25,230,255,0.38)',
        background: 'rgba(7,11,20,0.96)',
        boxShadow: '0 18px 48px rgba(0,0,0,0.48), 0 0 24px rgba(25,230,255,0.08)',
      }}
    >
      <div className="flex items-start gap-3">
        <History
          aria-hidden="true"
          className="mt-0.5 h-4 w-4 shrink-0"
          style={{ color: HUD.cyan }}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <h2 className="font-display text-sm font-semibold">While you were away</h2>
            <span className="truncate font-mono text-[11px]" style={{ color: HUD.textDim }}>
              {title}
            </span>
          </div>
          {context && (
            <p className="mt-1 truncate font-mono text-[11px]" style={{ color: HUD.textMono }}>
              {context}
            </p>
          )}
          <p className="mt-1.5 text-sm leading-5" style={{ color: HUD.text }}>
            {recap.text}
          </p>
        </div>
        <button
          type="button"
          title="Dismiss recap"
          aria-label="Dismiss recap"
          onClick={onDismiss}
          className="pointer-events-auto -mr-1 -mt-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded outline-none transition-colors hover:bg-white/10 focus-visible:ring-1 focus-visible:ring-hud-cyan motion-reduce:transition-none"
          style={{ color: HUD.textDim }}
        >
          <X aria-hidden="true" className="h-4 w-4" />
        </button>
      </div>
    </section>
  );
}
