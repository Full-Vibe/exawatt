'use client';

import {
  useCallback,
  useMemo,
  useRef,
  useState,
  useId,
  type ReactNode,
} from 'react';
import { CircleHelp, CornerDownLeft, ImagePlus, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useDialogInitialFocus } from '@/components/ui/dialog';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
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
  const diagnosticsId = useId();
  const detailsId = useId();
  const imagePreviewId = useId();
  const [reviewing, setReviewing] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [imageExpanded, setImageExpanded] = useState(false);
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
  const diagnosticsOffered = kind === 'bug';
  const pickImage = () => {
    if (onPickImage) onPickImage();
    else imagePickerRef.current?.click();
  };
  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229)
        return;
      if (event.key === 'Escape') {
        // A mounted Radix dialog owns nested-layer Escape dismissal.
        if (!dialogSemantics) return;
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
      dialogSemantics,
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
        'flex min-h-0 flex-1 flex-col overflow-hidden w-[min(32rem,calc(100vw-2rem))] rounded-lg border border-border bg-background',
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
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 pt-3 pr-12 pb-2">
          <div
            role="group"
            aria-label="Feedback type"
            data-feedback-kind-row
            data-capture-chip-row
            className="flex items-center gap-1"
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
                  'gap-1.5 px-2 text-sm',
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
          <TooltipProvider delayDuration={250}>
            <Tooltip open={helpOpen} onOpenChange={setHelpOpen}>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="ml-auto size-8 shrink-0 text-muted-foreground"
                  aria-label="About sending feedback"
                  onClick={event => {
                    event.preventDefault();
                    setHelpOpen(true);
                  }}
                >
                  <CircleHelp aria-hidden />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" align="end" className="max-w-72 text-sm leading-relaxed">
                Report a bug or suggest an improvement. Your message and chosen
                attachments go to this app’s feedback inbox, where reports help
                guide fixes and improvements.
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
        <div className="px-4">
          <label htmlFor={messageId} className="sr-only">Feedback</label>
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
          role="group"
          aria-label="Feedback actions"
          data-feedback-toolbar
          className="flex flex-wrap items-center gap-x-2 gap-y-0 px-3 py-1"
        >
          <div className="flex items-center gap-1">
            {imageEditingOffered && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={imageLocked}
                onClick={pickImage}
                className="gap-1.5 px-2 text-sm"
              >
                <ImagePlus aria-hidden />
                Attach image
              </Button>
            )}
            {screenshotAction.offered && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={!screenshotAction.enabled}
                aria-label={screenshotAction.label}
                aria-keyshortcuts={formatShortcutKeysAria(
                  screenshotAction.keys
                )}
                title={screenshotAction.description}
                onClick={screenshotAction.run}
                className="gap-1.5 px-2 text-sm"
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
          </div>
          {imageEditingOffered && (
            <span className="ml-auto px-1 text-chrome-label text-muted-foreground">
              Paste image <span className="font-mono text-chrome-micro">⌘V</span>
            </span>
          )}
        </div>
        {screenshot && attachScreenshot && (
          <div className="mx-4 mb-2 overflow-hidden rounded-md border border-border">
            <div className="flex items-center gap-3 p-1.5">
              <Button
                type="button"
                variant="ghost"
                aria-label="View attached image"
                aria-expanded={imageExpanded}
                aria-controls={imagePreviewId}
                onClick={() => setImageExpanded(value => !value)}
                className="h-14 w-20 shrink-0 overflow-hidden rounded-sm bg-muted p-0"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={screenshot}
                  alt="Feedback attachment preview"
                  className="h-full w-full object-contain"
                />
              </Button>
              <span className="min-w-0 flex-1 truncate text-sm">
                {attachmentName || 'Screenshot'}
              </span>
              {!readOnly && (
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  disabled={imageLocked}
                  aria-label="Remove attached image"
                  title="Remove attached image"
                  className="size-8 shrink-0"
                  onClick={() => {
                    if (onRemoveImage) onRemoveImage();
                    else onAttachScreenshotChange(false);
                    setImageExpanded(false);
                    textareaRef.current?.focus();
                  }}
                >
                  <X aria-hidden />
                </Button>
              )}
            </div>
            <div className={motion.expansion} data-expanded={imageExpanded}>
              <div className="min-h-0 overflow-hidden">
                <div
                  id={imagePreviewId}
                  aria-hidden={!imageExpanded}
                  inert={!imageExpanded}
                  className="px-1.5 pb-1.5"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={screenshot}
                    alt="Attached image"
                    className="max-h-64 w-full rounded-sm bg-muted object-contain"
                  />
                </div>
              </div>
            </div>
          </div>
        )}
        <div
          className={motion.expansion}
          data-expanded={diagnosticsOffered}
          aria-hidden={!diagnosticsOffered}
          inert={!diagnosticsOffered}
        >
          <div className="min-h-0 overflow-hidden">
            <div className="px-4 pb-2">
              <div className="flex flex-wrap items-center gap-x-2">
                <label
                  htmlFor={diagnosticsId}
                  className="flex min-h-8 cursor-pointer items-center gap-2 text-sm has-[:disabled]:cursor-default has-[:disabled]:text-muted-foreground"
                >
                  <input
                    id={diagnosticsId}
                    type="checkbox"
                    checked={attachDiagnostics}
                    disabled={readOnly || !diagnostics}
                    aria-keyshortcuts="Meta+D"
                    onChange={event =>
                      onAttachDiagnosticsChange(event.target.checked)
                    }
                    className="size-4 accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  />
                  Include app details
                  {!readOnly && (
                    <span
                      aria-hidden
                      className="font-mono text-chrome-micro text-muted-foreground"
                    >
                      ⌘D
                    </span>
                  )}
                </label>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setReviewing(value => !value)}
                  aria-expanded={reviewing}
                  aria-controls={detailsId}
                  className="ml-auto px-2 text-sm text-muted-foreground"
                >
                  {reviewing ? 'Hide details' : 'View details'}
                </Button>
              </div>
              <div className={motion.expansion} data-expanded={reviewing}>
                <div className="min-h-0 overflow-hidden">
                  <div
                    id={detailsId}
                    aria-hidden={!reviewing}
                    inert={!reviewing}
                    className="pt-1 pb-2 text-sm text-muted-foreground"
                  >
                    <p>
                      App version, system information and recent app logs help
                      us investigate bugs. Your conversations and project files
                      are excluded.
                    </p>
                    {diagnosticsPreparing ? (
                      <p role="status" className="mt-2">
                        Collecting app details… You can send feedback now.
                      </p>
                    ) : diagnostics ? (
                      <>
                        <p className="mt-2">
                          Exawatt {diagnostics.app.version} ·{' '}
                          {diagnostics.system.platform}{' '}
                          {diagnostics.system.arch}
                        </p>
                        <details className="mt-2">
                          <summary className="cursor-pointer py-1 text-foreground focus-visible:outline-2 focus-visible:outline-ring">
                            Show collected data
                          </summary>
                          <pre className="mt-1 max-h-40 overflow-auto rounded-md bg-muted p-2 text-chrome-label whitespace-pre-wrap">
                            {JSON.stringify(diagnostics, null, 2)}
                          </pre>
                        </details>
                      </>
                    ) : (
                      <p className="mt-2">No app details collected.</p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
        {error && (
          <p role="alert" className="px-4 pb-2 text-sm text-foreground">
            {error}
          </p>
        )}
      </div>
      <div className="shrink-0 border-t border-border">
        {submission || (
          <div className="flex min-h-14 items-center gap-2 px-4 py-2">
            <span className="mr-auto text-chrome-label text-muted-foreground">
              New line <span className="font-mono text-chrome-micro">⇧↵</span>
            </span>
            <Button
              type="button"
              size="sm"
              disabled={readOnly || busy || sendDisabled || !message.trim()}
              onClick={onSubmit}
              aria-keyshortcuts="Enter"
              className="min-w-40 text-sm"
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
  );
}
