'use client';

import { useCallback, useRef } from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { QuickFeedbackKind } from './quick-feedback-events';

const KINDS: Array<{ kind: QuickFeedbackKind; label: string; hint: string }> = [
  { kind: 'general', label: 'General', hint: '⌘1' },
  { kind: 'bug', label: 'Bug', hint: '⌘2' },
  { kind: 'idea', label: 'Idea', hint: '⌘3' },
];

const PLACEHOLDERS: Record<QuickFeedbackKind, string> = {
  general: 'What should we know?',
  bug: 'What broke, and what did you expect?',
  idea: 'What would make Exawatt better?',
};

export interface QuickCaptureBarProps {
  kind: QuickFeedbackKind;
  onKindChange: (kind: QuickFeedbackKind) => void;
  message: string;
  onMessageChange: (message: string) => void;
  /** pre-captured window screenshot; null when capture is unavailable */
  screenshot: string | null;
  attachScreenshot: boolean;
  onAttachScreenshotChange: (attach: boolean) => void;
  error: string | null;
  onSubmit: () => void;
  onDismiss: () => void;
}

/** The ENG-025 quick-capture card: one field, kind chips, a pre-captured
 * screenshot toggle, and nothing that needs a mouse. The provider owns
 * positioning, submission, and the pre-capture; the workbench renders this
 * card directly. `role="dialog"` keeps the workspace key layer out while the
 * operator types. */
export function QuickCaptureBar({
  kind,
  onKindChange,
  message,
  onMessageChange,
  screenshot,
  attachScreenshot,
  onAttachScreenshotChange,
  error,
  onSubmit,
  onDismiss,
}: QuickCaptureBarProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onDismiss();
        return;
      }
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        if (message.trim()) onSubmit();
        return;
      }
      if (!event.metaKey || event.ctrlKey || event.altKey) return;
      const ordinal = KINDS[Number(event.key) - 1];
      if (ordinal) {
        event.preventDefault();
        onKindChange(ordinal.kind);
        textareaRef.current?.focus();
        return;
      }
      if (event.key.toLowerCase() === 's' && screenshot) {
        event.preventDefault();
        onAttachScreenshotChange(!attachScreenshot);
      }
    },
    [
      attachScreenshot,
      message,
      onAttachScreenshotChange,
      onDismiss,
      onKindChange,
      onSubmit,
      screenshot,
    ]
  );

  return (
    <div
      role="dialog"
      aria-label="Quick feedback"
      onKeyDown={onKeyDown}
      className="w-[min(34rem,calc(100vw-2rem))] rounded-lg border border-hud-cyan/20 bg-hud-panel shadow-2xl"
    >
      <textarea
        ref={textareaRef}
        autoFocus
        value={message}
        maxLength={12_000}
        rows={1}
        placeholder={PLACEHOLDERS[kind]}
        aria-label="Feedback"
        onChange={event => onMessageChange(event.target.value)}
        className="max-h-40 w-full resize-none bg-transparent px-4 pt-3.5 pb-1 text-sm text-foreground outline-none placeholder:text-muted-foreground [field-sizing:content]"
      />
      <div className="flex items-center gap-1.5 px-3 pt-1 pb-2.5">
        {KINDS.map(entry => (
          <button
            key={entry.kind}
            type="button"
            aria-pressed={entry.kind === kind}
            onClick={() => {
              onKindChange(entry.kind);
              textareaRef.current?.focus();
            }}
            className={cn(
              'flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs transition-colors',
              entry.kind === kind
                ? 'border-hud-cyan bg-[var(--exa-hud-fill-hi)] text-foreground'
                : 'border-hud-cyan/20 text-muted-foreground hover:text-foreground'
            )}
          >
            {entry.label}
            <span className="font-mono text-chrome-micro text-muted-foreground">
              {entry.hint}
            </span>
          </button>
        ))}
        {screenshot && (
          <button
            type="button"
            aria-pressed={attachScreenshot}
            aria-label={
              attachScreenshot ? 'Remove screenshot' : 'Attach screenshot'
            }
            onClick={() => {
              onAttachScreenshotChange(!attachScreenshot);
              textareaRef.current?.focus();
            }}
            className={cn(
              'ml-1 flex items-center gap-1.5 rounded-full border py-0.5 pr-2.5 pl-1 text-xs transition-colors',
              attachScreenshot
                ? 'border-hud-cyan bg-[var(--exa-hud-fill-hi)] text-foreground'
                : 'border-hud-cyan/20 text-muted-foreground hover:text-foreground'
            )}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={screenshot}
              alt=""
              className={cn(
                'h-5 w-8 rounded-sm object-cover transition-opacity',
                !attachScreenshot && 'opacity-40'
              )}
            />
            <span>Screenshot</span>
            {attachScreenshot && <Check className="size-3" />}
            <span className="font-mono text-chrome-micro text-muted-foreground">
              ⌘S
            </span>
          </button>
        )}
        <div
          aria-live="polite"
          className="ml-auto pr-1 font-mono text-chrome-micro whitespace-nowrap text-muted-foreground"
        >
          {error ? (
            <span className="text-destructive">{error}</span>
          ) : (
            <span>↩ send</span>
          )}
        </div>
      </div>
    </div>
  );
}
