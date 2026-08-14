'use client';

import { useCallback, useRef, useState } from 'react';
import { Check, ShieldCheck } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { DiagnosticsReport } from '@/types/electron';
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
  /** ENG-025 F5: the pre-collected diagnostics bundle; null outside the
   *  desktop app or when collection failed. Only offered on Bug, because it
   *  answers "what was the machine doing", which is a bug question. */
  diagnostics: DiagnosticsReport | null;
  attachDiagnostics: boolean;
  onAttachDiagnosticsChange: (attach: boolean) => void;
  error: string | null;
  onSubmit: () => void;
  onDismiss: () => void;
}

/** One line naming what the bundle actually found, so the toggle is a
 *  decision rather than a leap of faith. */
function diagnosticsSummary(report: DiagnosticsReport): string {
  const phase =
    typeof report.update?.phase === 'string' ? report.update.phase : null;
  const parts = [`Exawatt ${report.app.version}`];
  if (phase === 'error') parts.push('update failed');
  else if (phase && phase !== 'idle') parts.push(`update ${phase}`);
  parts.push(report.session.signedIn ? 'signed in' : 'signed out');
  return parts.join(' · ');
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
  diagnostics,
  attachDiagnostics,
  onAttachDiagnosticsChange,
  error,
  onSubmit,
  onDismiss,
}: QuickCaptureBarProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const diagnosticsOffered = kind === 'bug' && diagnostics !== null;

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
        return;
      }
      if (event.key.toLowerCase() === 'd' && diagnosticsOffered) {
        event.preventDefault();
        onAttachDiagnosticsChange(!attachDiagnostics);
      }
    },
    [
      attachDiagnostics,
      attachScreenshot,
      diagnosticsOffered,
      message,
      onAttachDiagnosticsChange,
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
        {diagnosticsOffered && (
          <button
            type="button"
            aria-pressed={attachDiagnostics}
            aria-label={
              attachDiagnostics
                ? 'Remove anonymized diagnostics'
                : 'Attach anonymized diagnostics'
            }
            onClick={() => {
              onAttachDiagnosticsChange(!attachDiagnostics);
              textareaRef.current?.focus();
            }}
            className={cn(
              'ml-1 flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs transition-colors',
              attachDiagnostics
                ? 'border-hud-cyan bg-[var(--exa-hud-fill-hi)] text-foreground'
                : 'border-hud-cyan/20 text-muted-foreground hover:text-foreground'
            )}
          >
            <ShieldCheck
              className={cn(
                'size-3 transition-opacity',
                !attachDiagnostics && 'opacity-40'
              )}
            />
            <span>Anonymized diagnostics</span>
            {attachDiagnostics && <Check className="size-3" />}
            <span className="font-mono text-chrome-micro text-muted-foreground">
              ⌘D
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
      {/* Subtle until it matters: the summary is one dim line, and the exact
          JSON is one click away. Sending machine state is a trust moment, so
          "review" shows the payload itself rather than a description of it. */}
      {diagnosticsOffered && attachDiagnostics && diagnostics && (
        <div className="border-t border-hud-cyan/15 px-4 py-2">
          <div className="flex items-center gap-2 font-mono text-chrome-micro text-muted-foreground">
            <span className="min-w-0 flex-1 truncate">
              {diagnosticsSummary(diagnostics)}
            </span>
            <button
              type="button"
              onClick={() => setReviewing(current => !current)}
              aria-expanded={reviewing}
              className="shrink-0 underline underline-offset-2 hover:text-foreground"
            >
              {reviewing ? 'Hide' : 'Review'}
            </button>
          </div>
          {reviewing && (
            <pre className="mt-2 max-h-56 overflow-auto rounded-sm bg-hud-fill p-2 font-mono text-chrome-micro leading-4 whitespace-pre-wrap text-muted-foreground">
              {JSON.stringify(diagnostics, null, 2)}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
