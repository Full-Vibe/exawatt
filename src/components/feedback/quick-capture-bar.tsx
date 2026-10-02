'use client';

import { useCallback, useRef, useState } from 'react';
import {
  Check,
  CornerDownLeft,
  ImagePlus,
  Loader2,
  ShieldCheck,
  X,
} from 'lucide-react';
import { MAX_FEEDBACK_MESSAGE_CHARS } from '@/lib/feedback/contract';
import { formatKeyBinding } from '@/lib/shortcuts/format';
import {
  FEEDBACK_IMAGE_ACCEPT,
  feedbackImageFilesFromTransfer,
} from '@/lib/feedback/image';
import { cn } from '@/lib/utils';
import type { QuickFeedbackKind } from './quick-feedback-events';
import type { DiagnosticsReport } from '@exawatt/core/desktop-bridge';

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
  busy?: boolean;
  /** Another attempt can block send without freezing this newer draft. */
  sendDisabled?: boolean;
  /** The parent validates supported format, count and byte limits. */
  onImageFiles?: (files: File[]) => void;
  onPickImage?: () => void;
  onCaptureImage?: () => void;
  onRemoveImage?: () => void;
  attachmentName?: string;
  /** Radix supplies the dialog semantics when this card is mounted in it. */
  dialogSemantics?: boolean;
  autoFocus?: boolean;
  className?: string;
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
 * card directly. Standalone semantics keep workspace keys out while typing;
 * a Radix host owns focus containment in production. Type/spacing use the
 * kernel body/chrome-label rungs and operational-card/control density. */
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
  busy = false,
  sendDisabled = false,
  onImageFiles,
  onPickImage,
  onCaptureImage,
  onRemoveImage,
  attachmentName,
  dialogSemantics = true,
  autoFocus = true,
  className,
}: QuickCaptureBarProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const imagePickerRef = useRef<HTMLInputElement | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const imageEditingOffered = !!onImageFiles || !!onPickImage;
  const pickImage = () => {
    if (onPickImage) onPickImage();
    else imagePickerRef.current?.click();
  };
  const diagnosticsOffered = kind === 'bug' && diagnostics !== null;

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229)
        return;
      if (event.key === 'Escape') {
        event.preventDefault();
        onDismiss();
        return;
      }
      if (
        event.key === 'Enter' &&
        event.target === textareaRef.current &&
        !event.shiftKey &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey
      ) {
        event.preventDefault();
        if (!busy && !sendDisabled && message.trim()) onSubmit();
        return;
      }
      if (
        busy ||
        !event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.shiftKey
      )
        return;
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
      busy,
      sendDisabled,
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
      role={dialogSemantics ? 'dialog' : undefined}
      aria-label={dialogSemantics ? 'Quick feedback' : undefined}
      aria-busy={busy}
      onPaste={event => {
        if (busy || !onImageFiles) return;
        const files = feedbackImageFilesFromTransfer(event.clipboardData);
        // Text remains native. File-bearing paste goes through the same validator
        // as picker/drop, including unsupported files and multiple images.
        if (files.length) {
          event.preventDefault();
          onImageFiles(files);
        }
      }}
      onDragOver={event => {
        if (
          Array.from(event.dataTransfer.types ?? []).includes('Files') ||
          Array.from(event.dataTransfer.items ?? []).some(
            item => item.kind === 'file'
          )
        ) {
          event.preventDefault();
        }
      }}
      onDrop={event => {
        const files = feedbackImageFilesFromTransfer(event.dataTransfer);
        if (files.length) {
          // Even invalid or busy drops must not navigate away from the draft.
          event.preventDefault();
          if (!busy) onImageFiles?.(files);
        }
      }}
      onKeyDown={onKeyDown}
      className={cn(
        'w-[min(34rem,calc(100vw-2rem))] rounded-lg border border-hud-cyan/20 bg-hud-panel shadow-2xl',
        className
      )}
    >
      {onImageFiles && (
        <input
          ref={imagePickerRef}
          type="file"
          accept={FEEDBACK_IMAGE_ACCEPT}
          aria-label="Attach image"
          data-feedback-image-input
          hidden
          disabled={busy}
          onChange={event => {
            const files = Array.from(event.target.files ?? []);
            if (files.length) onImageFiles(files);
            event.target.value = '';
          }}
        />
      )}
      <textarea
        ref={textareaRef}
        autoFocus={autoFocus}
        value={message}
        maxLength={MAX_FEEDBACK_MESSAGE_CHARS}
        disabled={busy}
        rows={1}
        placeholder={PLACEHOLDERS[kind]}
        aria-label="Feedback"
        onChange={event => onMessageChange(event.target.value)}
        className="max-h-40 w-full resize-none bg-transparent px-4 pt-3.5 pb-1 text-sm text-foreground outline-none placeholder:text-muted-foreground [field-sizing:content]"
      />
      <div
        data-capture-chip-row
        className="flex flex-wrap items-center gap-1.5 px-3 pt-1 pb-2.5"
      >
        {KINDS.map(entry => (
          <button
            key={entry.kind}
            type="button"
            disabled={busy}
            aria-pressed={entry.kind === kind}
            onClick={() => {
              onKindChange(entry.kind);
              textareaRef.current?.focus();
            }}
            className={cn(
              'flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs whitespace-nowrap transition-colors',
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
        {screenshot && !imageEditingOffered && (
          <button
            type="button"
            disabled={busy}
            aria-pressed={attachScreenshot}
            aria-label={
              attachScreenshot
                ? attachmentName
                  ? 'Exclude image'
                  : 'Remove screenshot'
                : attachmentName
                  ? 'Include image'
                  : 'Attach screenshot'
            }
            onClick={() => {
              onAttachScreenshotChange(!attachScreenshot);
              textareaRef.current?.focus();
            }}
            className={cn(
              'ml-1 flex shrink-0 items-center gap-1.5 rounded-full border py-0.5 pr-2.5 pl-1 text-xs whitespace-nowrap transition-colors',
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
            <span>{attachmentName ? 'Image' : 'Screenshot'}</span>
            {attachScreenshot && <Check className="size-3" />}
            <span className="font-mono text-chrome-micro text-muted-foreground">
              ⌘S
            </span>
          </button>
        )}
        {imageEditingOffered && (
          <button
            type="button"
            disabled={busy}
            onClick={pickImage}
            className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            {screenshot && attachScreenshot ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={screenshot}
                alt=""
                className="h-5 w-8 rounded-sm object-cover"
              />
            ) : (
              <ImagePlus aria-hidden className="size-3.5" />
            )}
            {screenshot
              ? attachmentName
                ? 'Image'
                : 'Screenshot'
              : 'Attach image'}
          </button>
        )}
        {imageEditingOffered && (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <kbd className="font-mono text-chrome-micro">
              {formatKeyBinding({ key: 'v', modifiers: ['meta'] })}
            </kbd>
            Paste image
          </span>
        )}
        {onCaptureImage && (
          <button
            type="button"
            disabled={busy}
            onClick={onCaptureImage}
            className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            Capture this window
          </button>
        )}
      </div>
      {/* Its own line, not another chip. "Anonymized diagnostics" is the
          longest label in the component, and in the chip row it wrapped to two
          lines and pushed the send hint outside the card. A dim strip is also
          the honest register for it: subtle, but it states in full what would
          leave the machine, and holds the summary and Review without
          competing with the kind chips. */}
      {diagnosticsOffered && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-hud-cyan/15 px-3 py-2 font-mono text-chrome-micro text-muted-foreground">
          <button
            type="button"
            disabled={busy}
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
              'flex shrink-0 items-center gap-1.5 whitespace-nowrap transition-colors hover:text-foreground',
              attachDiagnostics && 'text-foreground'
            )}
          >
            <span
              aria-hidden
              className={cn(
                'grid size-3.5 place-items-center rounded-[3px] border transition-colors',
                attachDiagnostics
                  ? 'border-hud-cyan bg-[var(--exa-hud-fill-hi)]'
                  : 'border-hud-cyan/30'
              )}
            >
              {attachDiagnostics && <Check className="size-2.5" />}
            </span>
            <ShieldCheck
              aria-hidden
              className={cn('size-3', !attachDiagnostics && 'opacity-40')}
            />
            <span>Anonymized diagnostics</span>
            <span className="text-chrome-micro text-muted-foreground">⌘D</span>
          </button>
          {attachDiagnostics && diagnostics && (
            <>
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
            </>
          )}
        </div>
      )}
      {reviewing && attachDiagnostics && diagnostics && (
        <pre className="mx-3 mb-3 max-h-56 overflow-auto rounded-sm bg-hud-fill p-2 font-mono text-chrome-micro leading-4 whitespace-pre-wrap text-muted-foreground">
          {JSON.stringify(diagnostics, null, 2)}
        </pre>
      )}
      {screenshot && attachScreenshot && (
        <div className="mx-3 mb-3 overflow-hidden rounded-md border border-hud-cyan/20">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={screenshot}
            alt="Feedback attachment preview"
            className="max-h-32 w-full object-contain bg-hud-fill"
          />
          <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
            <span className="min-w-0 flex-1 truncate">
              {attachmentName || 'Window screenshot'}
            </span>
            <button
              type="button"
              disabled={busy}
              aria-label="Remove attached image"
              title="Remove attached image"
              onClick={() => {
                if (onRemoveImage) onRemoveImage();
                else onAttachScreenshotChange(false);
                textareaRef.current?.focus();
              }}
              className="flex items-center gap-1 rounded-md px-2 py-1 hover:text-foreground disabled:opacity-50"
            >
              <X aria-hidden className="size-3.5" />
            </button>
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="px-4 pb-3 text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2 border-t border-hud-cyan/15 px-3 py-2.5">
        <span className="mr-auto flex items-center gap-1.5 text-xs text-muted-foreground">
          <kbd className="font-mono text-chrome-micro">
            {formatKeyBinding({ key: 'Enter', modifiers: ['shift'] })}
          </kbd>
          New line
        </span>
        <button
          type="button"
          disabled={busy || sendDisabled || !message.trim()}
          onClick={onSubmit}
          aria-keyshortcuts="Enter"
          className="flex h-8 items-center gap-2 rounded-md border border-hud-cyan/20 bg-hud-fill px-3 text-xs font-medium text-foreground disabled:opacity-50"
        >
          {busy ? (
            <Loader2
              aria-hidden
              className="size-3.5 animate-spin motion-reduce:animate-none"
            />
          ) : (
            <CornerDownLeft aria-hidden className="size-3.5" />
          )}
          Send feedback
        </button>
      </div>
    </div>
  );
}
