import type { DiagnosticsReport } from '@exawatt/core/desktop-bridge';
import type {
  FeedbackKind,
  ProductFeedbackRequest,
  ProductFeedbackServiceResponseV1,
} from './contract';

type FeedbackEntry = 'composer';
type ComposerFeedbackKind = Exclude<FeedbackKind, 'context_label'>;
type FeedbackFailureOutcome = 'unconfirmed' | 'not_accepted';

export interface FeedbackImage {
  dataUrl: string;
  name: string;
  source: 'capture' | 'file';
}

export interface FeedbackDraft {
  readonly id: string;
  readonly revision: number;
  readonly kind: ComposerFeedbackKind;
  readonly message: string;
  readonly image: FeedbackImage | null;
  readonly attachImage: boolean;
  readonly diagnostics: DiagnosticsReport | null;
  readonly attachDiagnostics: boolean;
  /** Attribution belongs to the captured draft, not later navigation. */
  readonly context: Record<string, unknown> | null;
  readonly surface: string | null;
}

export interface FeedbackAttempt {
  readonly id: string;
  readonly entry: FeedbackEntry;
  readonly draftId: string;
  readonly draftRevision: number;
  readonly request: Readonly<ProductFeedbackRequest>;
  readonly status: 'sending' | 'sent' | 'partial' | 'error';
  readonly receipt: ProductFeedbackServiceResponseV1 | null;
  readonly error: string | null;
  readonly retryable: boolean;
  /** Retry permission is separate from whether an earlier write may exist. */
  readonly failureOutcome: FeedbackFailureOutcome | null;
  readonly acceptedWithoutImage: boolean;
}

interface FeedbackStoreSnapshot {
  readonly drafts: Readonly<Record<FeedbackEntry, FeedbackDraft>>;
  readonly attempts: readonly FeedbackAttempt[];
}

export type FeedbackDraftPatch = Partial<
  Omit<FeedbackDraft, 'id' | 'revision'>
>;
type FeedbackPayload = Omit<ProductFeedbackRequest, 'idempotencyKey'>;

export interface FeedbackStore {
  getSnapshot(): FeedbackStoreSnapshot;
  subscribe(listener: () => void): () => void;
  updateDraft(entry: FeedbackEntry, patch: FeedbackDraftPatch): boolean;
  newDraft(entry: FeedbackEntry, kind?: ComposerFeedbackKind): FeedbackDraft;
  start(entry: FeedbackEntry, payload: FeedbackPayload): FeedbackAttempt | null;
  retry(id: string): FeedbackAttempt | null;
  complete(id: string, receipt: ProductFeedbackServiceResponseV1): boolean;
  fail(
    id: string,
    error: string,
    retryable?: boolean,
    outcome?: FeedbackFailureOutcome
  ): boolean;
  editAttempt(id: string): boolean;
  finishWithoutImage(id: string): boolean;
  dismissAttempt(id: string): boolean;
  reset(): void;
}

function freeze(nested: unknown): void {
  if (!nested || typeof nested !== 'object' || Object.isFrozen(nested)) return;
  Object.values(nested).forEach(freeze);
  Object.freeze(nested);
}

/** Clone at the send boundary: later edits cannot change a retry's payload. */
function immutableCopy<T>(value: T): T {
  const copy = JSON.parse(JSON.stringify(value)) as T;
  freeze(copy);
  return copy;
}

function draft(kind: ComposerFeedbackKind = 'general'): FeedbackDraft {
  return {
    id: crypto.randomUUID(),
    revision: 0,
    kind,
    message: '',
    image: null,
    attachImage: false,
    diagnostics: null,
    attachDiagnostics: false,
    context: null,
    surface: null,
  };
}

export function feedbackDelivery(
  request: Pick<ProductFeedbackRequest, 'attachment'>,
  receipt: ProductFeedbackServiceResponseV1
): 'complete' | 'partial' {
  return request.attachment && !receipt.attachmentStored
    ? 'partial'
    : 'complete';
}

/**
 * One renderer-lifetime composer draft, regardless of its invoking command.
 * Reads/capture use useLatestRequest; accepted writes keep their own identity.
 * Reset on account change or unmount drops all private in-memory evidence.
 */
export function createFeedbackStore(): FeedbackStore {
  let snapshot: FeedbackStoreSnapshot = {
    drafts: { composer: draft() },
    attempts: [],
  };
  freeze(snapshot);
  const listeners = new Set<() => void>();
  function publish(next: FeedbackStoreSnapshot) {
    // Freeze shared snapshots without cloning large image strings on each edit.
    freeze(next);
    snapshot = next;
    listeners.forEach(listener => listener());
  }
  function ownsDraft(attempt: FeedbackAttempt) {
    const current = snapshot.drafts[attempt.entry];
    return (
      current.id === attempt.draftId &&
      current.revision === attempt.draftRevision
    );
  }
  function replaceAttempt(attempt: FeedbackAttempt) {
    publish({
      ...snapshot,
      attempts: snapshot.attempts.map(current =>
        current.id === attempt.id ? attempt : current
      ),
    });
  }
  function pending() {
    return snapshot.attempts.some(attempt => attempt.status === 'sending');
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    updateDraft(entry: FeedbackEntry, patch: FeedbackDraftPatch): boolean {
      const current = snapshot.drafts[entry];
      if (
        snapshot.attempts.some(
          attempt =>
            attempt.status === 'sending' &&
            ownsDraft(attempt) &&
            attempt.entry === entry
        )
      )
        return false;
      publish({
        ...snapshot,
        drafts: {
          ...snapshot.drafts,
          [entry]: { ...current, ...patch, revision: current.revision + 1 },
        },
      });
      return true;
    },
    newDraft(entry: FeedbackEntry, kind?: ComposerFeedbackKind) {
      const next = draft(kind);
      publish({ ...snapshot, drafts: { ...snapshot.drafts, [entry]: next } });
      return next;
    },
    start(
      entry: FeedbackEntry,
      payload: FeedbackPayload
    ): FeedbackAttempt | null {
      // The synchronous lock covers double activation before React rerenders.
      if (pending()) return null;
      const current = snapshot.drafts[entry];
      const previous = snapshot.attempts.find(
        attempt => attempt.entry === entry && ownsDraft(attempt)
      );
      if (previous) {
        if (
          !previous.retryable ||
          !['error', 'partial'].includes(previous.status)
        )
          return null;
        const retry: FeedbackAttempt = {
          ...previous,
          status: 'sending',
          error: null,
        };
        replaceAttempt(retry);
        return retry;
      }
      const id = crypto.randomUUID();
      const attempt: FeedbackAttempt = {
        id,
        entry,
        draftId: current.id,
        draftRevision: current.revision,
        request: immutableCopy({ ...payload, idempotencyKey: id }),
        status: 'sending',
        receipt: null,
        error: null,
        retryable: true,
        failureOutcome: null,
        acceptedWithoutImage: false,
      };
      publish({ ...snapshot, attempts: [...snapshot.attempts, attempt] });
      return attempt;
    },
    retry(id: string): FeedbackAttempt | null {
      const current = snapshot.attempts.find(attempt => attempt.id === id);
      if (
        !current ||
        !current.retryable ||
        !['error', 'partial'].includes(current.status) ||
        pending()
      )
        return null;
      const attempt: FeedbackAttempt = {
        ...current,
        status: 'sending',
        error: null,
      };
      replaceAttempt(attempt);
      return attempt;
    },
    complete(id: string, receipt: ProductFeedbackServiceResponseV1): boolean {
      const current = snapshot.attempts.find(attempt => attempt.id === id);
      if (!current || current.status !== 'sending') return false;
      const complete =
        feedbackDelivery(current.request, receipt) === 'complete';
      const attempt: FeedbackAttempt = {
        ...current,
        status: complete ? 'sent' : 'partial',
        receipt: immutableCopy(receipt),
        error: null,
        failureOutcome: null,
      };
      publish({
        drafts:
          complete && ownsDraft(current)
            ? { ...snapshot.drafts, [current.entry]: draft() }
            : snapshot.drafts,
        attempts: snapshot.attempts.map(value =>
          value.id === id ? attempt : value
        ),
      });
      return true;
    },
    fail(
      id: string,
      error: string,
      retryable = true,
      outcome: FeedbackFailureOutcome = 'unconfirmed'
    ): boolean {
      const current = snapshot.attempts.find(attempt => attempt.id === id);
      if (!current || current.status !== 'sending') return false;
      replaceAttempt({
        ...current,
        status: 'error',
        error,
        retryable,
        // A refused retry cannot prove that the preceding lost response meant
        // no write. Only a validated saved-report receipt resolves that doubt.
        failureOutcome:
          current.failureOutcome === 'unconfirmed' && !current.receipt
            ? 'unconfirmed'
            : outcome,
      });
      return true;
    },
    editAttempt(id: string): boolean {
      const current = snapshot.attempts.find(attempt => attempt.id === id);
      if (!current || current.status === 'sending' || !ownsDraft(current))
        return false;
      // Editing creates a new identity; the old uncertain attempt is retained.
      publish({
        ...snapshot,
        drafts: {
          ...snapshot.drafts,
          [current.entry]: {
            ...snapshot.drafts[current.entry],
            id: crypto.randomUUID(),
            revision: 0,
          },
        },
      });
      return true;
    },
    finishWithoutImage(id: string): boolean {
      const current = snapshot.attempts.find(attempt => attempt.id === id);
      if (
        !current ||
        !['partial', 'error'].includes(current.status) ||
        !current.request.attachment ||
        !current.receipt ||
        current.receipt.attachmentStored
      )
        return false;
      const attempt: FeedbackAttempt = {
        ...current,
        status: 'sent',
        acceptedWithoutImage: true,
        retryable: false,
        failureOutcome: null,
      };
      publish({
        drafts: ownsDraft(current)
          ? { ...snapshot.drafts, [current.entry]: draft() }
          : snapshot.drafts,
        attempts: snapshot.attempts.map(value =>
          value.id === id ? attempt : value
        ),
      });
      return true;
    },
    dismissAttempt(id: string): boolean {
      // Failure evidence remains recoverable until explicit resolution/reset.
      if (
        !snapshot.attempts.some(
          attempt => attempt.id === id && attempt.status === 'sent'
        )
      )
        return false;
      publish({
        ...snapshot,
        attempts: snapshot.attempts.filter(attempt => attempt.id !== id),
      });
      return true;
    },
    reset() {
      publish({ drafts: { composer: draft() }, attempts: [] });
    },
  };
}
