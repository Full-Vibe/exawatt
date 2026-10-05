'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import {
  isCompatibleServiceProblemError,
  isCompatibleServiceProtocolError,
  ProductFeedbackRequestSizeError,
  submitProductFeedback,
} from '@exawatt/core/distribution';
import { commandVerbMenuCommandId } from '@exawatt/core';
import { createOptionalClient } from '@/lib/supabase/client';
import { resolvedDistribution } from '@/lib/distribution/resolved';
import { runConfiguredService } from '@/lib/distribution/service-client';
import {
  PRODUCT_FEEDBACK_SCHEMA_VERSION,
  type ProductFeedbackRequest,
  type ProductFeedbackServiceRequestV1,
} from '@/lib/feedback/contract';
import {
  applyBuildMetadata,
  type FeedbackBuildInfo,
} from '@/lib/feedback/build-metadata';
import {
  createFeedbackStore,
  type FeedbackAttempt,
  type FeedbackDraftPatch,
} from '@/lib/feedback/attempt-store';
import {
  readFeedbackImage,
  validateFeedbackImageFiles,
} from '@/lib/feedback/image';
import { useLatestRequest } from '@/hooks/use-latest-request';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { COMFORTABLE_OVERLAY_CONTENT_CLASS } from '@/components/ui/overlay-presentation';
import { FeedbackComposerView } from './feedback-composer-view';
import {
  resolveQuickDiagnostics,
  withDiagnostics,
} from './quick-capture-payload';
import {
  analyticsSurface,
  captureAnalyticsEvent,
  hostedFailureForStatus,
} from '@/lib/analytics';
import {
  FEEDBACK_SUBMITTED_EVENT,
  OPEN_QUICK_FEEDBACK_EVENT,
  sampleQuickFeedbackAttribution,
  type QuickFeedbackDetail,
  type QuickFeedbackKind,
} from './quick-feedback-events';

interface ContextRating {
  durableSessionId: string;
  label: string;
  sentiment: -1 | 1;
  betterLabel?: string | null;
  projectName?: string | null;
}
interface FeedbackContextValue {
  isAvailable: boolean;
  isAuthenticated: boolean;
  openFeedback: () => void;
  openQuickCapture: (kind?: QuickFeedbackKind) => void;
  submitContextRating: (rating: ContextRating) => Promise<boolean>;
}
const ProductFeedbackContext = createContext<FeedbackContextValue | null>(null);
/** A confirmed send needs no decision: acknowledge it, then get out of the way. */
const SENT_ACKNOWLEDGEMENT_MS = 1000;
const SUBMIT_FEEDBACK_MENU_COMMAND =
  commandVerbMenuCommandId('submit-feedback');
export const FEEDBACK_MENU_COMMAND_IDS: ReadonlySet<string> = new Set([
  SUBMIT_FEEDBACK_MENU_COMMAND,
]);

function currentContext() {
  const attribution = sampleQuickFeedbackAttribution();
  return {
    schemaVersion: 1,
    url: window.location.href,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    projectName: attribution?.projectName ?? null,
    durableSessionId: attribution?.durableSessionId ?? null,
  };
}
function recordFailure(cause: unknown) {
  const problem = isCompatibleServiceProblemError(cause) ? cause : null;
  captureAnalyticsEvent({
    name: 'hosted_call_failed',
    surface: analyticsSurface(),
    service: 'product_feedback',
    failure: problem
      ? hostedFailureForStatus(problem.status)
      : isCompatibleServiceProtocolError(cause)
        ? 'invalid_response'
        : 'network',
    statusCode: problem?.status ?? null,
  });
  return problem;
}

export function ProductFeedbackProvider({ children }: { children: ReactNode }) {
  const distribution = useMemo(() => resolvedDistribution(), []);
  const feedbackEndpoint = distribution.services.productFeedback;
  const feedbackAvailable = feedbackEndpoint !== null;
  const store = useMemo(() => createFeedbackStore(), []);
  const snapshot = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot
  );
  const draft = snapshot.drafts.composer;
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [open, setOpen] = useState(false);
  const editorRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const assignInput = useCallback((node: HTMLTextAreaElement | null) => {
    inputRef.current = node;
  }, []);
  const [error, setError] = useState<string | null>(null);
  const [activeAttemptId, setActiveAttemptId] = useState<string | null>(null);
  // Independent channels cannot unlock another channel's unfinished evidence.
  const [preparing, setPreparing] = useState({
    capture: false,
    diagnostics: false,
    image: false,
  });
  const tokenRef = useRef<string | null>(null);
  const accountRef = useRef<string | null>(null);
  const buildRef = useRef<FeedbackBuildInfo | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const openingRef = useRef<string | null>(null);
  const temporaryCaptureRef = useRef(false);
  const [temporaryCapture, setTemporaryCapture] = useState(false);
  const captureReads = useLatestRequest();
  const imageReads = useLatestRequest();
  const [captureAvailable, setCaptureAvailable] = useState(false);
  const invalidateReads = useCallback(() => {
    captureReads.invalidate();
    imageReads.invalidate();
    openingRef.current = null;
  }, [captureReads, imageReads]);

  useEffect(() => {
    setCaptureAvailable(!!window.electron?.feedback?.captureScreenshot);
    void window.electron?.app
      ?.getBuildInfo?.()
      .then(value => {
        buildRef.current = value;
      })
      .catch(() => undefined);
    return () => store.reset();
  }, [store]);
  const syncSession = useCallback(
    (session: Session | null) => {
      if (
        !session &&
        window.electron?.feedback?.testMode &&
        tokenRef.current?.startsWith('test-')
      )
        return;
      const token = session?.access_token ?? null;
      const account = session?.user?.id ?? null;
      if (accountRef.current !== account || !token) {
        store.reset();
        invalidateReads();
        setOpen(false);
        setPreparing({ capture: false, diagnostics: false, image: false });
        setError(null);
        setActiveAttemptId(null);
        accountRef.current = account;
        temporaryCaptureRef.current = false;
        setTemporaryCapture(false);
      }
      tokenRef.current = token;
      const authenticated = !!account && !!token;
      setIsAuthenticated(authenticated);
      void window.electron?.pty?.setContextAuth?.(token);
      void window.electron?.feedback?.setAuthenticated(authenticated);
    },
    [store, invalidateReads]
  );
  useEffect(() => {
    if (!feedbackEndpoint) {
      syncSession(null);
      return;
    }
    const supabase = createOptionalClient(distribution);
    if (!supabase) {
      syncSession(null);
      return;
    }
    const { data: subscription } = supabase.auth.onAuthStateChange(
      (_event: AuthChangeEvent, session: Session | null) => syncSession(session)
    );
    return () => subscription.subscription.unsubscribe();
  }, [distribution, feedbackEndpoint, syncSession]);
  useEffect(() => {
    if (!feedbackEndpoint || !window.electron?.feedback?.testMode) return;
    const install = (event: Event) => {
      const token = (event as CustomEvent<{ accessToken?: unknown }>).detail
        ?.accessToken;
      if (typeof token !== 'string' || !token) return;
      tokenRef.current = token;
      setIsAuthenticated(true);
      void window.electron?.pty?.setContextAuth?.(token);
      void window.electron?.feedback?.setAuthenticated(true);
    };
    window.addEventListener('exawatt:test-feedback-auth', install);
    return () =>
      window.removeEventListener('exawatt:test-feedback-auth', install);
  }, [feedbackEndpoint]);

  const rememberInvoker = useCallback(() => {
    if (open || temporaryCaptureRef.current) return;
    const target = document.activeElement;
    // Radix retains the same editor during its real exit animation. Reopening
    // it must retain the work origin rather than save its own closing input.
    if (
      restoreFocusRef.current?.isConnected &&
      editorRef.current?.isConnected &&
      (target === document.body ||
        (target instanceof Node && editorRef.current.contains(target)))
    )
      return;
    restoreFocusRef.current =
      target instanceof HTMLElement &&
      target !== document.body &&
      target.isConnected
        ? target
        : null;
  }, [open]);
  const restoreFocus = useCallback((event: Event) => {
    if (temporaryCaptureRef.current) {
      event.preventDefault();
      return;
    }
    const target = restoreFocusRef.current;
    restoreFocusRef.current = null;
    if (!target?.isConnected) return;
    event.preventDefault();
    target.focus({ preventScroll: true });
  }, []);
  const closeEditor = useCallback(() => {
    invalidateReads();
    setPreparing({ capture: false, diagnostics: false, image: false });
    setOpen(false);
    const attempt = store
      .getSnapshot()
      .attempts.find(value => value.id === activeAttemptId);
    if (attempt?.status === 'sent') {
      store.dismissAttempt(attempt.id);
      setActiveAttemptId(null);
    }
  }, [invalidateReads, store, activeAttemptId]);
  const patch = useCallback(
    (next: FeedbackDraftPatch) => {
      store.updateDraft('composer', next);
      setError(null);
    },
    [store]
  );

  const openComposer = useCallback(
    (kind: QuickFeedbackKind, surface: string) => {
      if (
        !feedbackAvailable ||
        !tokenRef.current ||
        openingRef.current ||
        temporaryCaptureRef.current
      )
        return;
      rememberInvoker();
      const state = store.getSnapshot();
      const active = state.attempts.find(
        attempt => attempt.id === activeAttemptId
      );
      // A send confirmed while closed is finished; reopening starts the next report.
      if (active?.status === 'sent') {
        store.dismissAttempt(active.id);
        setActiveAttemptId(null);
      }
      const existing =
        (active?.status === 'sent' ? undefined : active) ??
        state.attempts.find(
          attempt =>
            attempt.status !== 'sent' &&
            attempt.draftId === state.drafts.composer.id
        );
      if (existing) {
        setActiveAttemptId(existing.id);
        setOpen(true);
        return;
      }
      const current = store.getSnapshot().drafts.composer;
      if (current.context) {
        setOpen(true);
        return;
      }
      store.updateDraft('composer', {
        kind,
        context: currentContext(),
        surface,
      });
      const ticket = captureReads.begin();
      openingRef.current = current.id;
      setPreparing(value => ({ ...value, capture: true, diagnostics: true }));
      const diagnostics = Promise.resolve(
        window.electron?.app?.getDiagnosticsReport?.(true)
      ).catch(() => null);
      void (async () => {
        let shot: string | null = null;
        try {
          shot =
            (await window.electron?.feedback?.captureScreenshot?.()) ?? null;
        } catch {
          /* Optional evidence */
        }
        if (
          !ticket.current ||
          !tokenRef.current ||
          store.getSnapshot().drafts.composer.id !== current.id
        )
          return;
        if (shot)
          store.updateDraft('composer', {
            image: {
              dataUrl: shot,
              name: 'Window screenshot',
              source: 'capture',
            },
            attachImage: kind === 'bug',
          });
        openingRef.current = null;
        setOpen(true);
        setPreparing(value => ({ ...value, capture: false }));
        const report = await diagnostics;
        if (ticket.current)
          setPreparing(value => ({ ...value, diagnostics: false }));
        if (
          !ticket.current ||
          !tokenRef.current ||
          store.getSnapshot().drafts.composer.id !== current.id
        )
          return;
        store.updateDraft('composer', {
          diagnostics: report ?? null,
          attachDiagnostics: kind === 'bug' && !!report,
        });
      })();
    },
    [feedbackAvailable, captureReads, rememberInvoker, store, activeAttemptId]
  );
  const openQuickCapture = useCallback(
    (kind: QuickFeedbackKind = 'general') =>
      openComposer(kind, 'quick-capture'),
    [openComposer]
  );
  const openFeedback = useCallback(
    () => openComposer('general', window.location.pathname || 'unknown'),
    [openComposer]
  );
  useEffect(
    () =>
      window.electron?.menu?.onCommand(command => {
        if (command === SUBMIT_FEEDBACK_MENU_COMMAND) openFeedback();
      }),
    [openFeedback]
  );
  useEffect(() => {
    const onOpen = (event: Event) =>
      openQuickCapture(
        (event as CustomEvent<QuickFeedbackDetail>).detail?.kind ?? 'general'
      );
    window.addEventListener(OPEN_QUICK_FEEDBACK_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_QUICK_FEEDBACK_EVENT, onOpen);
  }, [openQuickCapture]);

  const upload = useCallback(
    async (request: ProductFeedbackRequest) => {
      const token = tokenRef.current;
      if (!token) throw new Error('Sign in to send. Draft kept.');
      const result = await runConfiguredService(feedbackEndpoint, endpoint =>
        submitProductFeedback(endpoint, token, {
          schemaVersion: PRODUCT_FEEDBACK_SCHEMA_VERSION,
          ...request,
        } satisfies ProductFeedbackServiceRequestV1)
      );
      if (!result.configured) throw new Error('Feedback is unavailable.');
      return result.value;
    },
    [feedbackEndpoint]
  );
  const executeAttempt = useCallback(
    async (attempt: FeedbackAttempt) => {
      try {
        const receipt = await upload(attempt.request);
        if (store.complete(attempt.id, receipt))
          window.dispatchEvent(new CustomEvent(FEEDBACK_SUBMITTED_EVENT));
      } catch (cause) {
        const tooLarge = cause instanceof ProductFeedbackRequestSizeError;
        const problem = tooLarge ? null : recordFailure(cause);
        const retryable =
          !tooLarge &&
          (problem?.retryable ?? !isCompatibleServiceProtocolError(cause));
        const failureOutcome =
          attempt.failureOutcome === 'unconfirmed' && !attempt.receipt
            ? 'unconfirmed'
            : tooLarge ||
                (problem && problem.status < 500 && problem.status !== 408)
              ? 'not_accepted'
              : 'unconfirmed';
        store.fail(
          attempt.id,
          tooLarge
            ? 'This feedback is too large to send. Choose a smaller image.'
            : attempt.receipt
              ? retryable
                ? 'Your feedback is saved. The image hasn’t been confirmed.'
                : 'Your feedback is saved. Finish without the image.'
              : failureOutcome === 'not_accepted'
                ? 'Your feedback wasn’t accepted. Review it before trying again.'
                : 'Your feedback is kept here. We couldn’t confirm it was saved.',
          retryable,
          failureOutcome
        );
      }
    },
    [store, upload]
  );
  const send = useCallback(() => {
    if (!open || preparing.capture || preparing.image || !tokenRef.current)
      return;
    const current = store.getSnapshot().drafts.composer;
    if (!current.message.trim()) {
      setError('Add your feedback.');
      return;
    }
    const diagnostics = resolveQuickDiagnostics(
      current.kind,
      current.attachDiagnostics,
      current.diagnostics
    );
    const request = applyBuildMetadata(
      {
        kind: current.kind,
        message: current.message.trim(),
        surface: current.surface ?? 'quick-capture',
        context: withDiagnostics(
          current.context ?? currentContext(),
          diagnostics
        ),
        attachment:
          current.attachImage && current.image
            ? { dataUrl: current.image.dataUrl, name: current.image.name }
            : null,
        platform: window.electron?.platform ?? navigator.platform,
      },
      buildRef.current
    );
    // Optional reads must not advance draft revision after this frozen write.
    // Cancelling evidence collection never cancels the accepted submission.
    invalidateReads();
    setPreparing({ capture: false, diagnostics: false, image: false });
    const attempt = store.start('composer', request);
    if (!attempt) {
      setError(
        store.getSnapshot().attempts.some(value => value.status === 'sending')
          ? 'Still sending. New draft kept.'
          : 'Review your feedback before trying again.'
      );
      return;
    }
    setActiveAttemptId(attempt.id);
    void executeAttempt(attempt);
  }, [open, preparing, store, executeAttempt, invalidateReads]);
  const retry = useCallback(
    (id: string) => {
      if (!tokenRef.current) return;
      const attempt = store.retry(id);
      if (attempt) void executeAttempt(attempt);
    },
    [store, executeAttempt]
  );
  const editAttempt = useCallback(
    (attempt: FeedbackAttempt) => {
      if (!tokenRef.current || !store.editAttempt(attempt.id)) return;
      rememberInvoker();
      setActiveAttemptId(null);
      setError(null);
      setOpen(true);
      inputRef.current?.focus({ preventScroll: true });
    },
    [store, rememberInvoker]
  );

  const imageFiles = useCallback(
    async (files: File[]) => {
      let file: File | null;
      try {
        file = validateFeedbackImageFiles(files);
      } catch (cause) {
        setError((cause as Error).message);
        return;
      }
      if (!file) return;
      const ticket = imageReads.begin();
      const draftId = store.getSnapshot().drafts.composer.id;
      setPreparing(value => ({ ...value, image: true }));
      try {
        const image = await readFeedbackImage(file);
        if (
          ticket.current &&
          tokenRef.current &&
          store.getSnapshot().drafts.composer.id === draftId
        )
          patch({ image, attachImage: true });
      } catch (cause) {
        if (ticket.current) setError((cause as Error).message);
      } finally {
        if (ticket.current) setPreparing(value => ({ ...value, image: false }));
      }
    },
    [store, imageReads, patch]
  );
  const captureImage = useCallback(async () => {
    const capture = window.electron?.feedback?.captureScreenshot;
    if (!capture || preparing.capture || preparing.image || activeAttemptId)
      return;
    const ticket = imageReads.begin();
    const draftId = store.getSnapshot().drafts.composer.id;
    temporaryCaptureRef.current = true;
    setTemporaryCapture(true);
    setPreparing(value => ({ ...value, image: true }));
    setOpen(false);
    // Capture closures skip exit motion. Two paints ensure the overlay is gone.
    await new Promise<void>(resolve =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    );
    try {
      const dataUrl = await capture();
      if (
        ticket.current &&
        tokenRef.current &&
        store.getSnapshot().drafts.composer.id === draftId
      )
        patch({
          image: { dataUrl, name: 'Window screenshot', source: 'capture' },
          attachImage: true,
        });
    } catch {
      if (ticket.current) setError('Capture failed. Choose an image.');
    } finally {
      if (ticket.current && tokenRef.current) {
        temporaryCaptureRef.current = false;
        setTemporaryCapture(false);
        setPreparing(value => ({ ...value, image: false }));
        setOpen(true);
      }
    }
  }, [preparing, store, imageReads, patch, activeAttemptId]);

  const submitContextRating = useCallback(
    async (rating: ContextRating) => {
      if (!feedbackAvailable || !tokenRef.current) return false;
      const submittingAccount = accountRef.current;
      const correction =
        rating.betterLabel?.replace(/\s+/g, ' ').trim() || null;
      if (
        correction &&
        !(await window.electron?.pty?.correctContext?.(
          rating.durableSessionId,
          correction
        ))
      )
        return false;
      if (!tokenRef.current || accountRef.current !== submittingAccount)
        return false;
      try {
        await upload({
          ...applyBuildMetadata(
            {
              kind: 'context_label',
              sentiment: rating.sentiment,
              message: correction,
              surface: 'workspace-tab-strip',
              context: {
                schemaVersion: 1,
                durableSessionId: rating.durableSessionId,
                shownLabel: rating.label,
                betterLabel: correction,
                projectName: rating.projectName ?? null,
              },
              platform: window.electron?.platform ?? navigator.platform,
            },
            buildRef.current
          ),
          idempotencyKey: crypto.randomUUID(),
        });
        window.dispatchEvent(new CustomEvent(FEEDBACK_SUBMITTED_EVENT));
        return true;
      } catch (cause) {
        recordFailure(cause);
        return false;
      }
    },
    [feedbackAvailable, upload]
  );
  const contextValue = useMemo<FeedbackContextValue>(
    () => ({
      isAvailable: feedbackAvailable,
      isAuthenticated,
      openFeedback,
      openQuickCapture,
      submitContextRating,
    }),
    [
      feedbackAvailable,
      isAuthenticated,
      openFeedback,
      openQuickCapture,
      submitContextRating,
    ]
  );
  const pending = snapshot.attempts.some(
    attempt => attempt.status === 'sending'
  );
  const cannotRetryCurrent = snapshot.attempts.some(
    attempt =>
      attempt.draftId === draft.id &&
      attempt.draftRevision === draft.revision &&
      attempt.status === 'error' &&
      !attempt.retryable
  );
  const activeAttempt =
    snapshot.attempts.find(attempt => attempt.id === activeAttemptId) ?? null;
  const acknowledgedAttemptId =
    open && activeAttempt?.status === 'sent' ? activeAttempt.id : null;
  useEffect(() => {
    if (!acknowledgedAttemptId) return;
    const timer = window.setTimeout(closeEditor, SENT_ACKNOWLEDGEMENT_MS);
    return () => window.clearTimeout(timer);
  }, [acknowledgedAttemptId, closeEditor]);
  return (
    <ProductFeedbackContext.Provider value={contextValue}>
      {children}
      <Dialog
        open={open}
        onOpenChange={next => {
          if (!next) closeEditor();
        }}
      >
        <DialogContent
          ref={editorRef}
          motion={temporaryCapture ? 'none' : 'auto'}
          className={`${COMFORTABLE_OVERLAY_CONTENT_CLASS} sm:max-w-lg`}
          showCloseButton
          // The close affordance has a reserved input-space footprint.
          primaryAction={{
            none: 'Feedback sends Return from its composer; focused controls keep native activation.',
          }}
          onCloseAutoFocus={restoreFocus}
          onOpenAutoFocus={event => {
            event.preventDefault();
            inputRef.current?.focus({ preventScroll: true });
          }}
          onEscapeKeyDown={event => {
            if (event.isComposing || event.keyCode === 229)
              event.preventDefault();
          }}
        >
          <DialogTitle className="sr-only">Submit feedback</DialogTitle>
          <DialogDescription className="sr-only">
            Return sends feedback. Shift Return adds a line.
          </DialogDescription>
          <FeedbackComposerView
            dialogSemantics={false}
            autoFocus={false}
            inputRef={assignInput}
            className="w-full border-0 bg-transparent shadow-none"
            attempt={activeAttempt}
            onRetry={retry}
            onEdit={editAttempt}
            onFinishWithoutImage={id => store.finishWithoutImage(id)}
            kind={draft.kind}
            onKindChange={kind => patch({ kind })}
            message={draft.message}
            onMessageChange={message => patch({ message })}
            screenshot={draft.image?.dataUrl ?? null}
            attachmentName={draft.image?.name}
            attachScreenshot={draft.attachImage}
            onAttachScreenshotChange={attachImage => patch({ attachImage })}
            diagnostics={draft.diagnostics}
            attachDiagnostics={draft.attachDiagnostics}
            onAttachDiagnosticsChange={attachDiagnostics =>
              patch({ attachDiagnostics })
            }
            error={error}
            busy={preparing.capture || preparing.image}
            diagnosticsPreparing={preparing.diagnostics}
            sendDisabled={pending || cannotRetryCurrent}
            onImageFiles={files => void imageFiles(files)}
            onCaptureImage={
              captureAvailable ? () => void captureImage() : undefined
            }
            onRemoveImage={() => patch({ image: null, attachImage: false })}
            onSubmit={send}
            onDismiss={closeEditor}
          />
        </DialogContent>
      </Dialog>
    </ProductFeedbackContext.Provider>
  );
}
export function useProductFeedback(): FeedbackContextValue {
  const value = useContext(ProductFeedbackContext);
  if (!value)
    throw new Error(
      'useProductFeedback must be used inside ProductFeedbackProvider'
    );
  return value;
}
export function useOptionalProductFeedback(): FeedbackContextValue | null {
  return useContext(ProductFeedbackContext);
}
