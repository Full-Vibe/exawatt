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
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { COMFORTABLE_OVERLAY_CONTENT_CLASS } from '@/components/ui/overlay-presentation';
import { FeedbackReceipt } from './feedback-receipt';
import { QuickCaptureBar } from './quick-capture-bar';
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

const DUPLICATE_DELIVERY_WARNING =
  'Earlier delivery may have succeeded. Sending edits creates a new report.';
const UNRETRYABLE_ATTEMPT_REASON =
  'This attempt cannot be retried. Change the report to send a new one.';

function getDraftDeliveryWarning(
  attempts: readonly FeedbackAttempt[],
  draftId: string
): string | null {
  return attempts.some(
    attempt =>
      attempt.draftId === draftId &&
      (attempt.receipt || attempt.failureOutcome === 'unconfirmed')
  )
    ? DUPLICATE_DELIVERY_WARNING
    : null;
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
  const [error, setError] = useState<string | null>(null);
  // Explicit Edit creates a new draft identity but does not resolve the old write.
  const [warnedEditingDraftId, setWarnedEditingDraftId] = useState<
    string | null
  >(null);
  const [hiddenReceipts, setHiddenReceipts] = useState<ReadonlySet<string>>(
    () => new Set()
  );
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
        setWarnedEditingDraftId(null);
        setHiddenReceipts(new Set());
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
  }, [invalidateReads]);
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
      if (
        state.attempts.some(
          attempt =>
            attempt.status === 'sending' &&
            attempt.draftId === state.drafts.composer.id
        )
      )
        store.newDraft('composer', kind);
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
        setPreparing(value => ({ ...value, diagnostics: false }));
      })();
    },
    [feedbackAvailable, captureReads, rememberInvoker, store]
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
        const problem = recordFailure(cause);
        const retryable =
          problem?.retryable ?? !isCompatibleServiceProtocolError(cause);
        const failureOutcome =
          attempt.failureOutcome === 'unconfirmed' && !attempt.receipt
            ? 'unconfirmed'
            : problem && problem.status < 500 && problem.status !== 408
              ? 'not_accepted'
              : 'unconfirmed';
        store.fail(
          attempt.id,
          attempt.receipt
            ? retryable
              ? 'Text saved. Retry checks the same image.'
              : 'Text saved. Image delivery is incomplete. Review or finish without it.'
            : failureOutcome === 'not_accepted'
              ? 'Report not accepted. Review your draft.'
              : retryable
                ? 'Delivery unconfirmed. Draft kept. Retry checks the same report.'
                : 'Delivery unconfirmed. Draft kept. Review before sending another report.',
          retryable,
          failureOutcome
        );
      }
    },
    [store, upload]
  );
  const send = useCallback(() => {
    if (!open || Object.values(preparing).some(Boolean) || !tokenRef.current)
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
    const attempt = store.start('composer', request);
    if (!attempt) {
      setError(
        store.getSnapshot().attempts.some(value => value.status === 'sending')
          ? 'Still sending. New draft kept.'
          : UNRETRYABLE_ATTEMPT_REASON
      );
      return;
    }
    closeEditor();
    void executeAttempt(attempt);
  }, [open, preparing, store, closeEditor, executeAttempt]);
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
      setWarnedEditingDraftId(
        attempt.receipt || attempt.failureOutcome === 'unconfirmed'
          ? store.getSnapshot().drafts.composer.id
          : null
      );
      setError(null);
      setOpen(true);
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
    if (!capture || Object.values(preparing).some(Boolean)) return;
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
  }, [preparing, store, imageReads, patch]);

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
  const deliveryWarning =
    getDraftDeliveryWarning(snapshot.attempts, draft.id) ??
    (warnedEditingDraftId === draft.id ? DUPLICATE_DELIVERY_WARNING : null);
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
          className={`${COMFORTABLE_OVERLAY_CONTENT_CLASS} sm:max-w-xl`}
          showCloseButton
          // The close affordance has a reserved input-space footprint.
          primaryAction={{
            none: 'Feedback sends Return from its composer; focused controls keep native activation.',
          }}
          onCloseAutoFocus={restoreFocus}
          onEscapeKeyDown={event => {
            if (event.isComposing || event.keyCode === 229)
              event.preventDefault();
          }}
        >
          <DialogTitle className="sr-only">Submit feedback</DialogTitle>
          <DialogDescription className="sr-only">
            Return sends feedback. Shift Return adds a line.
          </DialogDescription>
          <QuickCaptureBar
            dialogSemantics={false}
            className="w-full border-0 bg-transparent shadow-none [&_textarea]:pr-12"
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
            error={
              [
                error,
                cannotRetryCurrent ? UNRETRYABLE_ATTEMPT_REASON : null,
                deliveryWarning,
              ]
                .filter(Boolean)
                .join(' ') || null
            }
            busy={Object.values(preparing).some(Boolean)}
            sendDisabled={pending || cannotRetryCurrent}
            onImageFiles={files => void imageFiles(files)}
            onCaptureImage={
              captureAvailable ? () => void captureImage() : undefined
            }
            onRemoveImage={() => patch({ image: null, attachImage: false })}
            onSubmit={send}
            onDismiss={closeEditor}
          />
          {snapshot.attempts.some(attempt =>
            hiddenReceipts.has(attempt.id)
          ) && (
            <div className="border-t border-border px-4 py-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setHiddenReceipts(new Set());
                  closeEditor();
                }}
              >
                Recover feedback
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
      {!open && isAuthenticated && snapshot.attempts.length > 0 && (
        <div className="pointer-events-none fixed inset-x-0 top-24 z-50 flex justify-center px-4">
          <div className="pointer-events-auto flex max-h-[60dvh] w-full max-w-xl flex-col gap-2 overflow-y-auto">
            {snapshot.attempts
              .filter(attempt => !hiddenReceipts.has(attempt.id))
              .map(attempt => (
                <FeedbackReceipt
                  key={attempt.id}
                  attempt={attempt}
                  store={store}
                  onHide={id =>
                    setHiddenReceipts(current => new Set([...current, id]))
                  }
                  onRetry={retry}
                  onEdit={editAttempt}
                />
              ))}
          </div>
        </div>
      )}
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
