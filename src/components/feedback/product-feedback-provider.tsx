'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import {
  Camera,
  Check,
  ImagePlus,
  LoaderCircle,
  MessageSquareWarning,
  X,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import type { DiagnosticsReport } from '@/types/electron';
import type {
  FeedbackKind,
  ProductFeedbackRequest,
} from '@/lib/feedback/contract';
import {
  applyBuildMetadata,
  type FeedbackBuildInfo,
} from '@/lib/feedback/build-metadata';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
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
  isAuthenticated: boolean;
  openFeedback: () => void;
  /** ENG-025 F1: the keyboard-first capture bar; no-op when signed out */
  openQuickCapture: (kind?: QuickFeedbackKind) => void;
  submitContextRating: (rating: ContextRating) => Promise<boolean>;
}

const ProductFeedbackContext = createContext<FeedbackContextValue | null>(null);

function wait(milliseconds: number) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function dataUrlFromFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read that image.'));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });
}

export function ProductFeedbackProvider({ children }: { children: ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [open, setOpen] = useState(false);
  const [kind, setKind] =
    useState<Exclude<FeedbackKind, 'context_label'>>('general');
  const [message, setMessage] = useState('');
  const [attachment, setAttachment] = useState<string | null>(null);
  const [captureAvailable, setCaptureAvailable] = useState(false);
  const [status, setStatus] = useState<
    'idle' | 'capturing' | 'submitting' | 'sent' | 'error'
  >('idle');
  const [error, setError] = useState<string | null>(null);
  const tokenRef = useRef<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => setCaptureAvailable(!!window.electron?.feedback), []);

  const syncSession = useCallback((session: Session | null) => {
    // The Electron evaluator installs an explicit fake token after load. A
    // slower cached-session read must not race in afterward and undo that
    // test-only state; production preload never exposes this capability.
    if (
      !session &&
      window.electron?.feedback?.testMode &&
      tokenRef.current?.startsWith('test-')
    ) {
      return;
    }
    const token = session?.access_token ?? null;
    tokenRef.current = token;
    const authenticated = !!session?.user && !!token;
    setIsAuthenticated(authenticated);
    void window.electron?.pty?.setContextAuth?.(token);
    void window.electron?.feedback?.setAuthenticated(authenticated);
    if (!authenticated) {
      setOpen(false);
      setQuickOpen(false);
    }
  }, []);

  useEffect(() => {
    let supabase: ReturnType<typeof createClient>;
    try {
      supabase = createClient();
    } catch {
      syncSession(null);
      return;
    }
    void supabase.auth
      .getSession()
      .then(({ data }) => syncSession(data.session));
    const { data: subscription } = supabase.auth.onAuthStateChange(
      (_event: AuthChangeEvent, session: Session | null) => syncSession(session)
    );
    return () => subscription.subscription.unsubscribe();
  }, [syncSession]);

  useEffect(
    () =>
      window.electron?.menu?.onCommand(command => {
        if (command === 'submit-feedback' && tokenRef.current) {
          setError(null);
          setStatus('idle');
          setOpen(true);
        }
      }),
    []
  );

  useEffect(() => {
    if (!window.electron?.feedback?.testMode) return;
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
  }, []);

  const submit = useCallback(
    async (
      request: Omit<ProductFeedbackRequest, 'idempotencyKey'>
    ): Promise<boolean> => {
      const token = tokenRef.current;
      if (!token) return false;
      let build: FeedbackBuildInfo | null = null;
      try {
        build = (await window.electron?.app?.getBuildInfo?.()) ?? null;
      } catch {
        // Build metadata is useful context, never a condition of feedback.
      }
      try {
        const response = await fetch('/api/feedback', {
          method: 'POST',
          headers: {
            authorization: `Bearer ${token}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            ...applyBuildMetadata(request, build),
            platform:
              request.platform ??
              window.electron?.platform ??
              navigator.platform,
            idempotencyKey: crypto.randomUUID(),
          } satisfies ProductFeedbackRequest),
        });
        if (response.ok) {
          window.dispatchEvent(new CustomEvent(FEEDBACK_SUBMITTED_EVENT));
        } else {
          // ENG-030 OS1.2. Feedback is the channel the external-user audit
          // found dead; a silent failure here is the one failure that also
          // destroys the report of itself.
          captureAnalyticsEvent({
            name: 'hosted_call_failed',
            surface: analyticsSurface(),
            service: 'product_feedback',
            failure: hostedFailureForStatus(response.status),
            statusCode: response.status,
          });
        }
        return response.ok;
      } catch {
        captureAnalyticsEvent({
          name: 'hosted_call_failed',
          surface: analyticsSurface(),
          service: 'product_feedback',
          failure: 'network',
          statusCode: null,
        });
        return false;
      }
    },
    []
  );

  const openFeedback = useCallback(() => {
    if (!tokenRef.current) return;
    setError(null);
    setStatus('idle');
    setOpen(true);
  }, []);

  // ENG-025 F1 quick capture. The draft survives dismissal and failed sends;
  // the screenshot is captured BEFORE the bar renders so it never contains
  // the capture UI itself.
  const [quickOpen, setQuickOpen] = useState(false);
  const [quickKind, setQuickKind] = useState<QuickFeedbackKind>('general');
  const [quickMessage, setQuickMessage] = useState('');
  const [quickShot, setQuickShot] = useState<string | null>(null);
  const [quickAttach, setQuickAttach] = useState(false);
  // ENG-025 F5. Collected alongside the screenshot, before the bar renders,
  // so the toggle is instant and the bundle describes the moment the operator
  // hit ⌘⇧F rather than the moment they decided to attach it.
  const [quickDiagnostics, setQuickDiagnostics] =
    useState<DiagnosticsReport | null>(null);
  const [quickAttachDiagnostics, setQuickAttachDiagnostics] = useState(false);
  const [quickError, setQuickError] = useState<string | null>(null);
  const [sentPulse, setSentPulse] = useState(false);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  const closeQuick = useCallback(() => {
    setQuickOpen(false);
    restoreFocusRef.current?.focus?.();
    restoreFocusRef.current = null;
  }, []);

  const openQuickCapture = useCallback(
    (kind: QuickFeedbackKind = 'general') => {
      if (!tokenRef.current) return;
      void (async () => {
        setQuickError(null);
        setQuickKind(kind);
        let shot: string | null = null;
        try {
          shot =
            (await window.electron?.feedback?.captureScreenshot?.()) ?? null;
        } catch {
          shot = null;
        }
        setQuickShot(shot);
        let report: DiagnosticsReport | null = null;
        try {
          report =
            (await window.electron?.app?.getDiagnosticsReport?.(
              !!tokenRef.current
            )) ?? null;
        } catch {
          report = null;
        }
        setQuickDiagnostics(report);
        // A bug report usually wants the evidence; other kinds opt in.
        setQuickAttach(kind === 'bug' && !!shot);
        setQuickAttachDiagnostics(kind === 'bug' && !!report);
        restoreFocusRef.current =
          document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null;
        setQuickOpen(true);
      })();
    },
    []
  );

  useEffect(() => {
    const onOpen = (event: Event) => {
      const kind = (event as CustomEvent<QuickFeedbackDetail>).detail?.kind;
      openQuickCapture(kind ?? 'general');
    };
    window.addEventListener(OPEN_QUICK_FEEDBACK_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_QUICK_FEEDBACK_EVENT, onOpen);
  }, [openQuickCapture]);

  useEffect(() => {
    if (!sentPulse) return;
    const timer = setTimeout(() => setSentPulse(false), 1600);
    return () => clearTimeout(timer);
  }, [sentPulse]);

  const submitQuick = useCallback(async () => {
    const clean = quickMessage.trim();
    if (!clean) return;
    const kind = quickKind;
    const attachment =
      quickAttach && quickShot
        ? { dataUrl: quickShot, name: 'screenshot' }
        : null;
    const diagnostics = resolveQuickDiagnostics(
      kind,
      quickAttachDiagnostics,
      quickDiagnostics
    );
    const attribution = sampleQuickFeedbackAttribution();
    // Optimistic: the bar closes on Enter; a failed send reopens it with the
    // draft intact.
    closeQuick();
    const sent = await submit({
      kind,
      message: clean,
      surface: 'quick-capture',
      context: withDiagnostics(
        {
          schemaVersion: 1,
          url: window.location.href,
          viewport: { width: window.innerWidth, height: window.innerHeight },
          projectName: attribution?.projectName ?? null,
          durableSessionId: attribution?.durableSessionId ?? null,
        },
        diagnostics
      ),
      attachment,
    });
    if (sent) {
      setQuickMessage('');
      setQuickShot(null);
      setQuickAttach(false);
      setQuickDiagnostics(null);
      setQuickAttachDiagnostics(false);
      setSentPulse(true);
      return;
    }
    setQuickError('Send failed, draft kept');
    setQuickOpen(true);
  }, [
    closeQuick,
    quickAttach,
    quickAttachDiagnostics,
    quickDiagnostics,
    quickKind,
    quickMessage,
    quickShot,
    submit,
  ]);

  const submitContextRating = useCallback(
    async (rating: ContextRating) => {
      if (!tokenRef.current) return false;
      const correction =
        rating.betterLabel?.replace(/\s+/g, ' ').trim() || null;
      if (correction) {
        const accepted = await window.electron?.pty?.correctContext?.(
          rating.durableSessionId,
          correction
        );
        if (!accepted) return false;
      }
      return submit({
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
      });
    },
    [submit]
  );

  const capture = useCallback(async () => {
    const captureScreenshot = window.electron?.feedback?.captureScreenshot;
    if (!captureScreenshot) {
      fileRef.current?.click();
      return;
    }
    setStatus('capturing');
    setError(null);
    setOpen(false);
    await wait(180);
    try {
      setAttachment(await captureScreenshot());
      setStatus('idle');
    } catch {
      setError(
        'Could not capture this window. You can attach an image instead.'
      );
      setStatus('error');
    } finally {
      setOpen(true);
    }
  }, []);

  const sendGeneral = useCallback(async () => {
    const clean = message.trim();
    if (!clean) {
      setError('Tell us what happened or what you would like to improve.');
      return;
    }
    setStatus('submitting');
    setError(null);
    const sent = await submit({
      kind,
      message: clean,
      surface: window.location.pathname || 'unknown',
      context: {
        schemaVersion: 1,
        url: window.location.href,
        viewport: { width: window.innerWidth, height: window.innerHeight },
      },
      attachment: attachment
        ? { dataUrl: attachment, name: 'screenshot' }
        : null,
    });
    if (!sent) {
      setStatus('error');
      setError(
        'Feedback could not be sent. Your text is still here—try again.'
      );
      return;
    }
    setStatus('sent');
    await wait(700);
    setOpen(false);
    setMessage('');
    setAttachment(null);
    setKind('general');
    setStatus('idle');
  }, [attachment, kind, message, submit]);

  const contextValue = useMemo<FeedbackContextValue>(
    () => ({
      isAuthenticated,
      openFeedback,
      openQuickCapture,
      submitContextRating,
    }),
    [isAuthenticated, openFeedback, openQuickCapture, submitContextRating]
  );

  return (
    <ProductFeedbackContext.Provider value={contextValue}>
      {children}
      <Dialog
        open={open}
        onOpenChange={next => status !== 'submitting' && setOpen(next)}
      >
        <DialogContent className="max-w-xl border-hud-cyan/20 bg-hud-panel p-0 text-foreground shadow-2xl">
          <div className="border-b border-hud-cyan/20 px-6 py-5">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-base">
                <MessageSquareWarning className="size-4 text-hud-cyan" />
                Submit feedback
              </DialogTitle>
              <DialogDescription>
                Bugs, rough edges, and ideas all land in the same review queue.
              </DialogDescription>
            </DialogHeader>
          </div>
          <div className="grid gap-5 px-6 py-1">
            <div className="grid gap-2">
              <Label htmlFor="feedback-kind">Type</Label>
              <Select
                value={kind}
                onValueChange={value => setKind(value as typeof kind)}
              >
                <SelectTrigger
                  id="feedback-kind"
                  className="bg-[var(--exa-hud-fill)]"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="general">General feedback</SelectItem>
                  <SelectItem value="bug">Bug report</SelectItem>
                  <SelectItem value="idea">Product idea</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="feedback-message">What should we know?</Label>
              <Textarea
                id="feedback-message"
                autoFocus
                value={message}
                maxLength={12_000}
                rows={6}
                onChange={event => setMessage(event.target.value)}
                placeholder="What happened, what did you expect, or what would make this better?"
                className="min-h-32 resize-y bg-[var(--exa-hud-fill)]"
              />
              <div className="text-right font-mono text-chrome-micro text-muted-foreground">
                {message.length.toLocaleString()} / 12,000
              </div>
            </div>
            <div className="grid gap-2">
              <Label>
                Screenshot{' '}
                <span className="font-normal text-muted-foreground">
                  (optional)
                </span>
              </Label>
              {attachment ? (
                <div className="flex items-center gap-3 rounded-md border border-hud-cyan/20 bg-[var(--exa-hud-fill)] p-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={attachment}
                    alt="Feedback attachment preview"
                    className="h-14 w-24 rounded object-cover"
                  />
                  <div className="min-w-0 flex-1 text-xs text-muted-foreground">
                    Window capture attached
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Remove screenshot"
                    onClick={() => setAttachment(null)}
                  >
                    <X className="size-4" />
                  </Button>
                </div>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  className="justify-start gap-2 bg-[var(--exa-hud-fill)]"
                  onClick={() => void capture()}
                  disabled={status === 'capturing'}
                >
                  {status === 'capturing' ? (
                    <LoaderCircle className="size-4 animate-spin" />
                  ) : captureAvailable ? (
                    <Camera className="size-4" />
                  ) : (
                    <ImagePlus className="size-4" />
                  )}
                  {captureAvailable ? 'Capture this window' : 'Attach an image'}
                </Button>
              )}
              <input
                ref={fileRef}
                className="sr-only"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={async event => {
                  const file = event.target.files?.[0];
                  if (!file) return;
                  if (file.size > 5 * 1024 * 1024) {
                    setError('Screenshots must be 5 MB or smaller.');
                    setStatus('error');
                    return;
                  }
                  try {
                    setAttachment(await dataUrlFromFile(file));
                    setError(null);
                    setStatus('idle');
                  } catch (cause) {
                    setError(
                      cause instanceof Error
                        ? cause.message
                        : 'Could not read that image.'
                    );
                    setStatus('error');
                  }
                }}
              />
            </div>
            <div aria-live="polite" className="min-h-5 text-xs">
              {error && <span className="text-destructive">{error}</span>}
              {status === 'sent' && (
                <span className="inline-flex items-center gap-1.5 text-emerald-400">
                  <Check className="size-3.5" /> Feedback sent
                </span>
              )}
            </div>
          </div>
          <DialogFooter className="border-t border-hud-cyan/20 px-6 py-4">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={status === 'submitting'}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => void sendGeneral()}
              disabled={status === 'submitting' || status === 'sent'}
            >
              {status === 'submitting' && (
                <LoaderCircle className="size-4 animate-spin" />
              )}
              Send feedback
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {quickOpen && (
        <>
          {/* transparent backdrop: click-away dismisses but keeps the draft */}
          <div
            className="fixed inset-0 z-50"
            onMouseDown={closeQuick}
            aria-hidden
          />
          <div className="pointer-events-none fixed inset-x-0 top-24 z-50 flex justify-center px-4">
            <div className="pointer-events-auto animate-in fade-in slide-in-from-top-2 duration-150">
              <QuickCaptureBar
                kind={quickKind}
                onKindChange={setQuickKind}
                message={quickMessage}
                onMessageChange={setQuickMessage}
                screenshot={quickShot}
                attachScreenshot={quickAttach}
                diagnostics={quickDiagnostics}
                attachDiagnostics={quickAttachDiagnostics}
                onAttachDiagnosticsChange={setQuickAttachDiagnostics}
                onAttachScreenshotChange={setQuickAttach}
                error={quickError}
                onSubmit={() => void submitQuick()}
                onDismiss={closeQuick}
              />
            </div>
          </div>
        </>
      )}
      {sentPulse && (
        <div className="pointer-events-none fixed inset-x-0 top-6 z-50 flex justify-center">
          <div className="animate-in fade-in slide-in-from-top-1 flex items-center gap-1.5 rounded-full border border-hud-cyan/20 bg-hud-panel px-3 py-1 text-xs text-muted-foreground shadow-lg duration-200">
            <Check className="size-3.5 text-emerald-400" /> Feedback sent
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

/** Chrome atoms are also rendered in isolation by the component workbench and
 * unit tests; those callers can omit the application-level provider. */
export function useOptionalProductFeedback(): FeedbackContextValue | null {
  return useContext(ProductFeedbackContext);
}
