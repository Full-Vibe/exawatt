'use client';

import {
  useCallback,
  useMemo,
  useRef,
  useState,
  useId,
  type ReactNode,
} from 'react';
import {
  Check,
  CornerDownLeft,
  ImagePlus,
  Loader2,
  ShieldCheck,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useDialogInitialFocus } from '@/components/ui/dialog';
import { MAX_FEEDBACK_MESSAGE_CHARS } from '@/lib/feedback/contract';
import {
  FEEDBACK_IMAGE_ACCEPT,
  feedbackImageFilesFromTransfer,
} from '@/lib/feedback/image';
import { cn } from '@/lib/utils';
import {
  eventToBinding,
  formatKeyBinding,
  formatShortcutKeysAria,
} from '@/lib/shortcuts/format';
import { bindingsMatch, type KeyBinding } from '@/types/shortcuts';
import type { QuickFeedbackKind } from './quick-feedback-events';
import type { DiagnosticsReport } from '@exawatt/core/desktop-bridge';
import motion from './feedback-motion.module.css';

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
const SCREENSHOT_ACTION = {
  label: 'Screenshot',
  description: 'Capture a screenshot of this window',
  keys: { key: 's', modifiers: ['meta'] } satisfies KeyBinding,
};
export interface QuickCaptureBarProps {
  kind: QuickFeedbackKind;
  onKindChange: (kind: QuickFeedbackKind) => void;
  message: string;
  onMessageChange: (message: string) => void;
  screenshot: string | null;
  attachScreenshot: boolean;
  onAttachScreenshotChange: (attach: boolean) => void;
  diagnostics: DiagnosticsReport | null;
  attachDiagnostics: boolean;
  onAttachDiagnosticsChange: (attach: boolean) => void;
  error: string | null;
  onSubmit: () => void;
  onDismiss: () => void;
  /** Selected image preparation blocks Send, never text editing. */
  busy?: boolean;
  diagnosticsPreparing?: boolean;
  sendDisabled?: boolean;
  readOnly?: boolean;
  submission?: ReactNode;
  inputRef?: (node: HTMLTextAreaElement | null) => void;
  onImageFiles?: (files: File[]) => void;
  onPickImage?: () => void;
  onCaptureImage?: () => void;
  onRemoveImage?: () => void;
  attachmentName?: string;
  dialogSemantics?: boolean;
  autoFocus?: boolean;
  className?: string;
}

/** One field and stable action slots through editing, delivery and outcome. */
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
  diagnosticsPreparing = false,
  sendDisabled = false,
  readOnly = false,
  submission,
  inputRef,
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
  useDialogInitialFocus(textareaRef);
  const imagePickerRef = useRef<HTMLInputElement | null>(null);
  const messageId = useId();
  const [reviewing, setReviewing] = useState(false);
  const imageEditingOffered = !!onImageFiles || !!onPickImage;
  const imageLocked = busy || readOnly;
  const screenshotAction = useMemo(
    () => ({
      ...SCREENSHOT_ACTION,
      offered: !!onCaptureImage,
      enabled: !!onCaptureImage && !imageLocked,
      run: () => {
        if (!imageLocked) onCaptureImage?.();
      },
    }),
    [onCaptureImage, imageLocked]
  );
  const diagnosticsOffered =
    kind === 'bug' && (!!diagnostics || diagnosticsPreparing || readOnly);
  const pickImage = () => {
    if (onPickImage) onPickImage();
    else imagePickerRef.current?.click();
  };
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
        screenshotAction.offered &&
        bindingsMatch(screenshotAction.keys, eventToBinding(event.nativeEvent))
      ) {
        event.preventDefault();
        screenshotAction.run();
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
        if (!readOnly && !busy && !sendDisabled && message.trim()) onSubmit();
        return;
      }
      if (
        readOnly ||
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
      if (
        event.key.toLowerCase() === 'd' &&
        diagnosticsOffered &&
        diagnostics
      ) {
        event.preventDefault();
        onAttachDiagnosticsChange(!attachDiagnostics);
      }
    },
    [
      readOnly,
      busy,
      sendDisabled,
      message,
      onSubmit,
      onDismiss,
      onKindChange,
      screenshotAction,
      diagnosticsOffered,
      diagnostics,
      attachDiagnostics,
      onAttachDiagnosticsChange,
    ]
  );

  return (
    <div
      role={dialogSemantics ? 'dialog' : undefined}
      aria-label={dialogSemantics ? 'Quick feedback' : undefined}
      data-feedback-composer
      onPaste={event => {
        const files = feedbackImageFilesFromTransfer(event.clipboardData);
        if (files.length) {
          event.preventDefault();
          if (!imageLocked) onImageFiles?.(files);
        }
      }}
      onDragOver={event => {
        if (
          Array.from(event.dataTransfer.types ?? []).includes('Files') ||
          Array.from(event.dataTransfer.items ?? []).some(
            item => item.kind === 'file'
          )
        )
          event.preventDefault();
      }}
      onDrop={event => {
        const files = feedbackImageFilesFromTransfer(event.dataTransfer);
        if (files.length) {
          event.preventDefault();
          if (!imageLocked) onImageFiles?.(files);
        }
      }}
      onKeyDown={onKeyDown}
      className={cn(
        'flex min-h-0 flex-1 flex-col overflow-hidden w-[min(34rem,calc(100vw-2rem))] rounded-lg border border-border bg-background',
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
          disabled={imageLocked}
          onChange={event => {
            const files = Array.from(event.target.files ?? []);
            if (files.length) onImageFiles(files);
            event.target.value = '';
          }}
        />
      )}
      <div data-feedback-scroll-body className="min-h-0 overflow-y-auto">
        <div className="px-5 pt-5 pb-3">
          <label
            htmlFor={messageId}
            className="mb-2 block text-chrome-label text-muted-foreground"
          >
            {readOnly ? 'Your feedback' : 'Feedback'}
          </label>
          <textarea
            id={messageId}
            ref={node => {
              textareaRef.current = node;
              inputRef?.(node);
            }}
            autoFocus={autoFocus}
            value={message}
            maxLength={MAX_FEEDBACK_MESSAGE_CHARS}
            readOnly={readOnly}
            rows={3}
            placeholder={PLACEHOLDERS[kind]}
            aria-label="Feedback"
            onChange={event => onMessageChange(event.target.value)}
            className="max-h-48 min-h-24 w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm leading-relaxed text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring [field-sizing:content]"
          />
        </div>
        <div
          data-feedback-kind-row
          data-capture-chip-row
          className="flex items-center gap-1 px-5 pb-3"
        >
          {KINDS.map(entry => (
            <Button
              key={entry.kind}
              type="button"
              size="sm"
              variant="ghost"
              disabled={readOnly}
              aria-pressed={entry.kind === kind}
              onClick={() => {
                onKindChange(entry.kind);
                textareaRef.current?.focus();
              }}
              className={cn(
                'min-w-0 flex-1 gap-1.5 px-2',
                entry.kind === kind && 'bg-accent text-accent-foreground'
              )}
            >
              {entry.label}
              <span
                aria-hidden
                className="font-mono text-chrome-micro opacity-70"
              >
                {entry.hint}
              </span>
            </Button>
          ))}
        </div>
        <div
          role="group"
          aria-label="Feedback actions"
          data-feedback-toolbar
          className="grid grid-cols-2 items-start gap-2 px-5 pb-3"
        >
          {imageEditingOffered && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={imageLocked}
              onClick={pickImage}
              className="w-full min-w-0"
            >
              <ImagePlus aria-hidden />
              Attach image
            </Button>
          )}
          {screenshotAction.offered && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={!screenshotAction.enabled}
              aria-label={screenshotAction.label}
              aria-keyshortcuts={formatShortcutKeysAria(screenshotAction.keys)}
              title={screenshotAction.description}
              onClick={screenshotAction.run}
              className="w-full min-w-0 justify-between"
            >
              {screenshotAction.label}
              <span
                aria-hidden
                className="font-mono text-chrome-micro opacity-70"
              >
                {formatKeyBinding(screenshotAction.keys)}
              </span>
            </Button>
          )}
          {imageEditingOffered && (
            <p className="col-span-2 text-chrome-label text-muted-foreground">
              <span className="font-mono text-chrome-micro">⌘V</span> to paste
              an image
            </p>
          )}
        </div>
        <div
          className={motion.expansion}
          data-expanded={diagnosticsOffered}
          aria-hidden={!diagnosticsOffered}
          inert={!diagnosticsOffered}
        >
          <div className="min-h-0 overflow-hidden">
            <div className="mx-5 mb-3 border-t border-border pt-3">
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={readOnly || !diagnostics}
                  aria-pressed={attachDiagnostics}
                  aria-label={
                    attachDiagnostics
                      ? 'Remove anonymized diagnostics'
                      : 'Attach anonymized diagnostics'
                  }
                  onClick={() => onAttachDiagnosticsChange(!attachDiagnostics)}
                  className="px-2"
                >
                  <ShieldCheck aria-hidden />
                  Anonymized diagnostics
                  <span
                    aria-hidden
                    className="font-mono text-chrome-micro opacity-70"
                  >
                    ⌘D
                  </span>
                  {attachDiagnostics && <Check aria-hidden />}
                </Button>
                {attachDiagnostics && diagnostics && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => setReviewing(value => !value)}
                    aria-expanded={reviewing}
                  >
                    {reviewing ? 'Hide' : 'Review'}
                  </Button>
                )}
              </div>
              <p
                className="mt-1 min-h-5 text-chrome-label text-muted-foreground"
                role={diagnosticsPreparing ? 'status' : undefined}
              >
                {diagnosticsPreparing ? (
                  'Preparing optional diagnostics…'
                ) : diagnostics && attachDiagnostics ? (
                  <>
                    Exawatt {diagnostics.app.version} ·{' '}
                    {diagnostics.session.signedIn ? 'signed in' : 'signed out'}
                  </>
                ) : readOnly ? (
                  'Not included'
                ) : null}
              </p>
              {reviewing && attachDiagnostics && diagnostics && (
                <pre className="mt-2 max-h-48 overflow-auto rounded-md bg-muted p-3 text-sm whitespace-pre-wrap">
                  {JSON.stringify(diagnostics, null, 2)}
                </pre>
              )}
            </div>
          </div>
        </div>
        {screenshot && (
          <div className="mx-5 mb-3 overflow-hidden rounded-md border border-border">
            <div
              className={cn('h-32 bg-muted', !attachScreenshot && 'opacity-50')}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={screenshot}
                alt="Feedback attachment preview"
                className="h-full w-full object-contain"
              />
            </div>
            <div className="flex min-h-12 items-center gap-2 px-3 py-2 text-chrome-label text-muted-foreground">
              <span className="min-w-0 flex-1 truncate">
                {attachmentName || 'Window screenshot'}
              </span>
              {!readOnly && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={imageLocked}
                  aria-pressed={attachScreenshot}
                  onClick={() => onAttachScreenshotChange(!attachScreenshot)}
                >
                  {attachScreenshot ? 'Included' : 'Include'}
                </Button>
              )}
              {!readOnly && (
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  disabled={imageLocked}
                  aria-label="Remove attached image"
                  title="Remove attached image"
                  className="size-8"
                  onClick={() => {
                    if (onRemoveImage) onRemoveImage();
                    else onAttachScreenshotChange(false);
                    textareaRef.current?.focus();
                  }}
                >
                  <X aria-hidden />
                </Button>
              )}
            </div>
          </div>
        )}
        {error && (
          <p role="alert" className="px-5 pb-3 text-sm text-foreground">
            {error}
          </p>
        )}
      </div>
      <div className="shrink-0 border-t border-border">
        <div className="min-h-16">
          <div className={motion.expansion} data-expanded={!!submission}>
            <div className="min-h-0 overflow-hidden">{submission}</div>
          </div>
          {!submission && (
            <div className="flex items-center gap-2 px-5 py-4">
              <span className="mr-auto text-chrome-label text-muted-foreground">
                <span className="font-mono text-chrome-micro">⇧↵</span> New line
              </span>
              <Button
                type="button"
                size="sm"
                disabled={readOnly || busy || sendDisabled || !message.trim()}
                onClick={onSubmit}
                aria-keyshortcuts="Enter"
              >
                {busy && (
                  <Loader2 aria-hidden className="motion-safe:animate-spin" />
                )}
                Send feedback
                <CornerDownLeft aria-hidden />
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
