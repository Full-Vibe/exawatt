'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
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

type PreviewOutcome = 'complete' | 'unconfirmed' | 'partial' | 'refused';

/** Gallery outcomes use the real store; no reports leave this preview. */
export function FeedbackRecoveryStudy() {
  const [store] = useState(() => {
    const value = createFeedbackStore();
    value.updateDraft('composer', { diagnostics: DIAGNOSTICS });
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
  const [previewOutcome, setPreviewOutcome] =
    useState<PreviewOutcome>('complete');
  const [sampleImage, setSampleImage] = useState(false);
  const retrying = useRef(false);
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
  const changeOpen = (value: boolean) => setOpen(value);
  const openFeedback = () => {
    invoker.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    if (!attempt && sampleImage && !draft.image) {
      patch({
        image: { dataUrl: PREVIEW, name: 'example.png', source: 'file' },
        attachImage: true,
      });
    }
    setOpen(true);
  };
  const send = () => {
    if (imagePreparing || !draft.message.trim()) return;
    retrying.current = false;
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
    if (!store.retry(id)) return;
    retrying.current = true;
    setSelectedAttemptId(id);
  };
  const edit = (value: FeedbackAttempt) => {
    if (!store.editAttempt(value.id)) return;
    setSelectedAttemptId(null);
    setError(null);
    inputRef.current?.focus({ preventScroll: true });
  };
  useEffect(() => {
    if (!attempt || attempt.status !== 'sending') return;
    // The gallery delays only its simulated response so sending can be reviewed.
    // Production owns its real request lifecycle and never delays a result.
    const outcome = retrying.current ? 'complete' : previewOutcome;
    const timer = window.setTimeout(() => {
      if (outcome === 'complete' || outcome === 'partial') {
        store.complete(attempt.id, {
          id: attempt.id,
          duplicate: false,
          attachmentStored:
            outcome === 'complete' && !!attempt.request.attachment,
        });
      } else {
        store.fail(
          attempt.id,
          outcome === 'unconfirmed'
            ? 'The connection was interrupted while sending your feedback.'
            : 'Your feedback couldn’t be saved. Please try again.',
          outcome === 'unconfirmed',
          outcome === 'unconfirmed' ? 'unconfirmed' : 'not_accepted'
        );
      }
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [attempt, previewOutcome, store]);
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

  return (
    <section className="space-y-4" data-feedback-recovery-study>
      <div className="flex flex-wrap items-end gap-3">
        <label className="grid gap-1.5 text-chrome-label">
          Preview outcome
          <select
            className="h-9 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            value={previewOutcome}
            onChange={event => {
              const outcome = event.target.value as PreviewOutcome;
              setPreviewOutcome(outcome);
              if (outcome === 'partial') setSampleImage(true);
            }}
          >
            <option value="complete">Sent</option>
            <option value="unconfirmed">Connection interrupted</option>
            <option value="partial">Message saved without image</option>
            <option value="refused">Could not send</option>
          </select>
        </label>
        <Button onClick={openFeedback}>Open feedback</Button>
        <Button variant="outline" onClick={() => setPaletteOpen(true)}>
          Open command palette
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            imageReads.invalidate();
            setImagePreparing(false);
            store.reset();
            patch({ diagnostics: DIAGNOSTICS });
            setSelectedAttemptId(null);
            setError(null);
          }}
        >
          Reset preview
        </Button>
      </div>
      <label className="flex w-fit items-center gap-2 text-chrome-label">
        <input
          type="checkbox"
          checked={sampleImage}
          onChange={event => setSampleImage(event.target.checked)}
        />
        Add an example image when opening
      </label>
      <p className="text-chrome-label text-muted-foreground">
        Preview only. Nothing is sent.
      </p>
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
          className={`${COMFORTABLE_OVERLAY_CONTENT_CLASS} sm:max-w-lg`}
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
            className="w-full border-0 bg-transparent shadow-none"
            kind={draft.kind}
            onKindChange={kind => patch({ kind })}
            message={draft.message}
            onMessageChange={message => patch({ message })}
            screenshot={draft.image?.dataUrl ?? null}
            attachmentName={draft.image?.name}
            attachScreenshot={draft.attachImage}
            onAttachScreenshotChange={attachImage => patch({ attachImage })}
            diagnostics={draft.diagnostics}
            diagnosticsPreparing={false}
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
          />
        </DialogContent>
      </Dialog>
    </section>
  );
}
