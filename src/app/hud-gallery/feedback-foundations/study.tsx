'use client';

import { useCallback, useRef, useState, useSyncExternalStore } from 'react';
import type { DiagnosticsReport } from '@exawatt/core/desktop-bridge';
import { FeedbackComposerView } from '@/components/feedback/feedback-composer-view';
import { Button } from '@/components/ui/button';
import {
  CommandDialog,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from '@/components/ui/command';
import { ActionMenu } from '@/components/ui/option-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { COMFORTABLE_OVERLAY_CONTENT_CLASS } from '@/components/ui/overlay-presentation';
import { useLatestRequest } from '@/hooks/use-latest-request';
import {
  createFeedbackStore,
  type FeedbackAttempt,
  type FeedbackDraftPatch,
} from '@/lib/feedback/attempt-store';
import {
  readFeedbackImage,
  validateFeedbackImageFiles,
} from '@/lib/feedback/image';
import {
  resolveQuickDiagnostics,
  withDiagnostics,
} from '@/components/feedback/quick-capture-payload';

const MESSAGE =
  'The Project switcher should keep my selection after I close it.';
const PREVIEW =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAPAAAAB4CAIAAABD1OhwAAABsElEQVR4nO3ZoW1DQRREUVfsAgJdmGFYsJGllJEEpYUPVnq7V0c6BQy4bG4/f7+QcRtfAAsJmhRBkyJoUgRNiqBJETQpgiZF0KQImhRBk3Ip6Nf3G8YJmhRBkyJoUgRNiqBJETQpgiZF0KQImhRBkyJoUgRNiqBJETQpgiZF0KQImhRBkyJoUgRNiqBJWRY0nELQpAiaFEGTImhSBE2KoEkRNCmCJkXQpAiaFEGTImhSBE3KpaDvjw+2Nd7QVgR9vPGGtiLo4403tBVBH2+8oa0I+njjDW1F0Mcbb2grgj7eeENbEfTxxhvaimOFFEGTImhSBE2KoEkRNCmCJkXQpAiaFEGTcino59cnLCRoUgRNiqBJETQpgiZF0KQImpThoOEUgiZF0KQImhRBkyJoUgRNiqBJETQpgibF9c0l46UKmpXGSxU0K42XKmhWGi9V0Kw0XqqgWWm8VEGz0nipgmal8VJXBg2nEDQpgiZF0KQImhRBkyJoUgRNiqBJETQpgiZF0KQImhRBkyJoUgRNiqBJETQpgiZF0KQImhRBkyJoUgRNiqBJETQpgiZF0KT8AwPfl61FVnDZAAAAAElFTkSuQmCC';
const DIAGNOSTICS: DiagnosticsReport = {
  reportVersion: 1,
  generatedAt: '2026-10-04T12:00:00.000Z',
  app: {
    version: '0.1.18',
    sha: 'gallery',
    branch: 'gallery',
    delivery: 'source',
    packaged: false,
    installPath: '/Applications/Exawatt.app',
  },
  system: {
    platform: 'darwin',
    arch: 'arm64',
    osRelease: '15.0',
    electron: '43.1.0',
    node: '24.18.0',
    locale: 'en-US',
  },
  update: { phase: 'idle' },
  session: { signedIn: true, liveSessions: 3 },
  logs: [],
};

/** Review-only controlled transport; all state/payload semantics use the real store. */
export function FeedbackRecoveryStudy() {
  const [store] = useState(() => {
    const value = createFeedbackStore();
    value.updateDraft('composer', {
      kind: 'bug',
      message: MESSAGE,
      image: { dataUrl: PREVIEW, name: 'project-switcher.png', source: 'file' },
      attachImage: true,
    });
    return value;
  });
  const snapshot = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot
  );
  const draft = snapshot.drafts.composer;
  const [selectedAttemptId, setSelectedAttemptId] = useState<string | null>(
    null
  );
  const attempt =
    snapshot.attempts.find(value => value.id === selectedAttemptId) ?? null;
  const [open, setOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [transportOpen, setTransportOpen] = useState(false);
  const transportTrigger = useRef<HTMLButtonElement>(null);
  const [holdDiagnostics, setHoldDiagnostics] = useState(true);
  const [diagnosticsPreparing, setDiagnosticsPreparing] = useState(false);
  const [imagePreparing, setImagePreparing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const invoker = useRef<HTMLElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const assignInput = useCallback((node: HTMLTextAreaElement | null) => {
    inputRef.current = node;
  }, []);
  const imageReads = useLatestRequest();
  const patch = (change: FeedbackDraftPatch) =>
    store.updateDraft('composer', change);
  const changeOpen = (value: boolean) => {
    if (!value) setTransportOpen(false);
    setOpen(value);
  };
  const openFeedback = () => {
    invoker.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    if (!attempt && !draft.diagnostics) {
      setDiagnosticsPreparing(holdDiagnostics);
      if (!holdDiagnostics) patch({ diagnostics: DIAGNOSTICS });
    }
    setOpen(true);
  };
  const send = () => {
    if (imagePreparing || !draft.message.trim()) return;
    const started = store.start('composer', {
      kind: draft.kind,
      message: draft.message,
      surface: 'gallery',
      context: withDiagnostics(
        { representative: true },
        resolveQuickDiagnostics(
          draft.kind,
          draft.attachDiagnostics,
          draft.diagnostics
        )
      ),
      attachment:
        draft.attachImage && draft.image
          ? { dataUrl: draft.image.dataUrl, name: draft.image.name }
          : null,
    });
    if (started) {
      setSelectedAttemptId(started.id);
      setError(null);
    }
  };
  const retry = (id: string) => {
    if (store.retry(id)) setSelectedAttemptId(id);
  };
  const edit = (value: FeedbackAttempt) => {
    if (!store.editAttempt(value.id)) return;
    setSelectedAttemptId(null);
    setError(
      value.receipt || value.failureOutcome === 'unconfirmed'
        ? 'Earlier delivery may have succeeded. Sending edits creates a new report.'
        : null
    );
    inputRef.current?.focus({ preventScroll: true });
  };
  const newFeedback = () => {
    imageReads.invalidate();
    setImagePreparing(false);
    store.newDraft('composer');
    setSelectedAttemptId(null);
    setError(null);
    setDiagnosticsPreparing(holdDiagnostics);
    if (!holdDiagnostics) patch({ diagnostics: DIAGNOSTICS });
    inputRef.current?.focus({ preventScroll: true });
  };
  const resolve = (
    outcome: 'complete' | 'partial' | 'unconfirmed' | 'refused'
  ) => {
    if (!attempt || attempt.status !== 'sending') return;
    if (outcome === 'complete' || outcome === 'partial')
      store.complete(attempt.id, {
        id: attempt.id,
        duplicate: false,
        attachmentStored:
          outcome === 'complete' && !!attempt.request.attachment,
      });
    else
      store.fail(
        attempt.id,
        outcome === 'unconfirmed'
          ? 'The response was lost. Retry this report to confirm delivery.'
          : 'The service declined this request. Review the message before sending again.',
        outcome === 'unconfirmed',
        outcome === 'unconfirmed' ? 'unconfirmed' : 'not_accepted'
      );
  };
  const loadImage = async (files: File[]) => {
    const ticket = imageReads.begin();
    try {
      const file = validateFeedbackImageFiles(files);
      if (!file) return;
      setImagePreparing(true);
      setError(null);
      const image = await readFeedbackImage(file);
      if (ticket.current) patch({ image, attachImage: true });
    } catch (cause) {
      if (ticket.current) setError((cause as Error).message);
    } finally {
      if (ticket.current) setImagePreparing(false);
    }
  };
  const completeDiagnostics = () => {
    patch({ diagnostics: DIAGNOSTICS });
    setDiagnosticsPreparing(false);
  };

  return (
    <section className="space-y-6" data-feedback-recovery-study>
      <div className="flex flex-wrap items-center gap-4">
        <Button onClick={openFeedback}>Open feedback</Button>
        <Button variant="outline" onClick={() => setPaletteOpen(true)}>
          Open command palette
        </Button>
        <label className="flex items-center gap-2 text-chrome-label">
          <input
            type="checkbox"
            checked={holdDiagnostics}
            onChange={event => setHoldDiagnostics(event.target.checked)}
          />
          Hold optional diagnostics preparation
        </label>
        <Button
          variant="outline"
          onClick={() => {
            imageReads.invalidate();
            setImagePreparing(false);
            store.reset();
            patch({
              kind: 'bug',
              message: MESSAGE,
              image: {
                dataUrl: PREVIEW,
                name: 'project-switcher.png',
                source: 'file',
              },
              attachImage: true,
            });
            setSelectedAttemptId(null);
            setError(null);
            setDiagnosticsPreparing(false);
          }}
        >
          Reset review
        </Button>
      </div>
      <p role="status" className="text-chrome-label text-muted-foreground">
        {attempt
          ? `Current state: ${attempt.status}`
          : 'Current state: editing'}
      </p>
      <div className="rounded-lg border border-border p-4 text-chrome-label text-muted-foreground">
        Send keeps this dialog open. Transport outcomes are controlled by the
        review transport menu. Both overlays use the real shared components.
      </div>
      <CommandDialog open={paletteOpen} onOpenChange={setPaletteOpen}>
        <CommandInput placeholder="Search review commands…" />
        <CommandList>
          <CommandGroup heading="Review">
            <CommandItem onSelect={() => setPaletteOpen(false)}>
              Return to review
            </CommandItem>
            <CommandItem onSelect={() => setPaletteOpen(false)}>
              Close command palette
              <CommandShortcut>esc</CommandShortcut>
            </CommandItem>
            <CommandItem disabled>
              Send a real report
              <CommandShortcut>Unavailable in review</CommandShortcut>
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </CommandDialog>
      <Dialog open={open} onOpenChange={changeOpen}>
        <DialogContent
          className={`${COMFORTABLE_OVERLAY_CONTENT_CLASS} sm:max-w-xl`}
          primaryAction={{
            none: 'The production feedback composer owns Return-to-send and its recovery actions.',
          }}
          onCloseAutoFocus={event => {
            if (!invoker.current?.isConnected) return;
            event.preventDefault();
            invoker.current.focus({ preventScroll: true });
          }}
          onOpenAutoFocus={event => {
            event.preventDefault();
            inputRef.current?.focus({ preventScroll: true });
          }}
        >
          <DialogTitle className="sr-only">Submit feedback</DialogTitle>
          <DialogDescription className="sr-only">
            Return sends. Shift Return adds a line. Escape closes without losing
            feedback.
          </DialogDescription>
          <FeedbackComposerView
            dialogSemantics={false}
            autoFocus={false}
            inputRef={assignInput}
            className="w-full border-0 bg-transparent shadow-none [&_label]:pr-8"
            kind={draft.kind}
            onKindChange={kind => patch({ kind })}
            message={draft.message}
            onMessageChange={message => patch({ message })}
            screenshot={draft.image?.dataUrl ?? null}
            attachmentName={draft.image?.name}
            attachScreenshot={draft.attachImage}
            onAttachScreenshotChange={attachImage => patch({ attachImage })}
            diagnostics={draft.diagnostics}
            diagnosticsPreparing={diagnosticsPreparing}
            attachDiagnostics={draft.attachDiagnostics}
            onAttachDiagnosticsChange={attachDiagnostics =>
              patch({ attachDiagnostics })
            }
            error={error}
            busy={imagePreparing}
            onImageFiles={files => void loadImage(files)}
            onCaptureImage={() =>
              patch({
                image: {
                  dataUrl: PREVIEW,
                  name: 'window-capture.png',
                  source: 'capture',
                },
                attachImage: true,
              })
            }
            onRemoveImage={() => patch({ image: null, attachImage: false })}
            onSubmit={send}
            onDismiss={() => changeOpen(false)}
            attempt={attempt}
            onRetry={retry}
            onEdit={edit}
            onFinishWithoutImage={id => store.finishWithoutImage(id)}
            onDone={() => changeOpen(false)}
            onNewFeedback={newFeedback}
          />
          <fieldset
            className="flex shrink-0 items-center justify-between gap-2 border-t border-border px-5 py-2"
            data-review-transport-controls
          >
            <legend className="sr-only">Review transport controls</legend>
            <span className="text-chrome-meta text-muted-foreground">
              Review only
            </span>
            <Button
              ref={transportTrigger}
              size="sm"
              variant="outline"
              aria-haspopup="menu"
              aria-expanded={transportOpen}
              onClick={() => setTransportOpen(true)}
            >
              Review transport
            </Button>
            <ActionMenu
              open={transportOpen}
              anchor={transportTrigger.current}
              label="Review transport"
              onClose={reason => {
                setTransportOpen(false);
                if (reason === 'escape' || reason === 'select')
                  transportTrigger.current?.focus({ preventScroll: true });
              }}
              items={[
                ...(
                  ['complete', 'partial', 'unconfirmed', 'refused'] as const
                ).map(outcome => ({
                  id: outcome,
                  label: {
                    complete: 'Complete',
                    partial: 'Save message only',
                    unconfirmed: 'Lose response',
                    refused: 'Refuse request',
                  }[outcome],
                  disabled:
                    attempt?.status !== 'sending' ||
                    (outcome === 'partial' && !attempt.request.attachment),
                  disabledReason:
                    attempt?.status !== 'sending'
                      ? 'Send feedback first'
                      : 'No image was included',
                  onSelect: () => resolve(outcome),
                })),
                {
                  id: 'diagnostics',
                  label: 'Complete diagnostics',
                  disabled: !diagnosticsPreparing,
                  disabledReason: 'Diagnostics are not preparing',
                  onSelect: completeDiagnostics,
                },
              ]}
            />
          </fieldset>
        </DialogContent>
      </Dialog>
    </section>
  );
}
