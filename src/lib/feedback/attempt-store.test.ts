import { describe, expect, it } from 'vitest';
import { createFeedbackStore, feedbackDelivery } from './attempt-store';
import type { ProductFeedbackServiceResponseV1 } from './contract';

const request = {
  kind: 'bug' as const,
  message: 'The Session label did not refresh.',
  surface: 'feedback-composer',
  context: { nested: { sessions: 3 } },
  attachment: { dataUrl: 'data:image/png;base64,cG5n', name: 'evidence' },
};
const receipt: ProductFeedbackServiceResponseV1 = {
  id: '223e4567-e89b-42d3-a456-426614174000',
  duplicate: false,
  attachmentStored: true,
};

describe('feedback draft and attempt ownership', () => {
  it('locks before a rerender and freezes one same-key retry payload', () => {
    const store = createFeedbackStore();
    store.updateDraft('composer', { message: request.message, kind: 'bug' });
    const input = structuredClone(request);
    const attempt = store.start('composer', input)!;
    expect(store.start('composer', input)).toBeNull();
    expect(store.updateDraft('composer', { message: 'Changed while sending' })).toBe(false);
    input.context.nested.sessions = 99;
    expect(attempt.request.context).toEqual(request.context);
    expect(Object.isFrozen(attempt.request.context?.nested)).toBe(true);
    store.fail(attempt.id, 'The response was lost.');
    const retry = store.retry(attempt.id)!;
    expect(retry.id).toBe(attempt.id);
    expect(retry.request).toBe(attempt.request);
    expect(store.retry(attempt.id)).toBeNull();
  });

  it('cannot clear newer input or restore older evidence over it', () => {
    const store = createFeedbackStore();
    const first = store.start('composer', request)!;
    const newer = store.newDraft('composer', 'idea');
    store.updateDraft('composer', { message: 'A newer thought' });
    expect(store.start('composer', { ...request, message: 'A newer thought' })).toBeNull();
    store.complete(first.id, receipt);
    expect(store.getSnapshot().drafts.composer).toMatchObject({
      id: newer.id,
      kind: 'idea',
      message: 'A newer thought',
    });
    expect(store.editAttempt(first.id)).toBe(false);
    expect(store.dismissAttempt(first.id)).toBe(true);
    expect(store.getSnapshot().drafts.composer.message).toBe('A newer thought');
  });

  it('editing the composer preserves captured evidence and attribution', () => {
    const store = createFeedbackStore();
    store.updateDraft('composer', {
      kind: 'bug',
      message: request.message,
      image: { ...request.attachment, source: 'capture' },
      attachImage: true,
      context: { url: '/fleet', projectName: 'Captured project', origin: 'shortcut' },
      surface: 'feedback-composer',
    });
    const captured = store.getSnapshot().drafts.composer;
    store.updateDraft('composer', { message: 'A clearer description' });
    const edited = store.getSnapshot().drafts.composer;
    expect(edited.id).toBe(captured.id);
    expect(edited.image).toBe(captured.image);
    expect(edited.context).toBe(captured.context);
    expect(edited.surface).toBe(captured.surface);
    expect(edited.kind).toBe(captured.kind);
    expect(edited.attachImage).toBe(true);
  });

  it('retains text and image on partial delivery and reuses identity even through send', () => {
    const store = createFeedbackStore();
    store.updateDraft('composer', {
      message: request.message,
      image: { ...request.attachment, source: 'file' },
      attachImage: true,
    });
    const attempt = store.start('composer', request)!;
    store.complete(attempt.id, { ...receipt, attachmentStored: false });
    expect(store.getSnapshot().attempts[0].status).toBe('partial');
    expect(store.getSnapshot().drafts.composer.image).toEqual({ ...request.attachment, source: 'file' });
    expect(store.dismissAttempt(attempt.id)).toBe(false);
    const retry = store.start('composer', { ...request, context: { changedSinceSend: true } })!;
    expect(retry.request).toBe(attempt.request);
    store.complete(attempt.id, { ...receipt, duplicate: true });
    expect(store.getSnapshot().attempts[0]).toMatchObject({ status: 'sent', receipt: { duplicate: true } });
    expect(store.getSnapshot().drafts.composer.message).toBe('');
  });

  it('explicit acceptance without the image keeps the partial service receipt truthful', () => {
    const store = createFeedbackStore();
    const attempt = store.start('composer', request)!;
    const partial = { ...receipt, attachmentStored: false };
    store.complete(attempt.id, partial);
    expect(store.finishWithoutImage(attempt.id)).toBe(true);
    expect(store.getSnapshot().attempts[0]).toMatchObject({
      status: 'sent',
      acceptedWithoutImage: true,
      receipt: partial,
    });
    expect(store.retry(attempt.id)).toBeNull();
  });

  it('editing after an uncertain outcome creates a new attempt instead of mutating the old one', () => {
    const store = createFeedbackStore();
    store.updateDraft('composer', { message: request.message });
    const attempt = store.start('composer', request)!;
    store.fail(attempt.id, 'Outcome unknown');
    expect(store.editAttempt(attempt.id)).toBe(true);
    store.updateDraft('composer', { message: 'An edited report' });
    const edited = store.start('composer', { ...request, message: 'An edited report' })!;
    expect(edited.id).not.toBe(attempt.id);
    expect(attempt.request.message).toBe(request.message);
    expect(store.getSnapshot().attempts).toHaveLength(2);
  });

  it('can explicitly finish confirmed text after an image retry fails, without changing the frozen report', () => {
    const store = createFeedbackStore();
    const attempt = store.start('composer', request)!;
    const partial = { ...receipt, attachmentStored: false };
    store.complete(attempt.id, partial);
    store.retry(attempt.id);
    expect(store.finishWithoutImage(attempt.id)).toBe(false);
    store.fail(attempt.id, 'Retry refused', false);
    expect(store.finishWithoutImage(attempt.id)).toBe(true);
    const finished = store.getSnapshot().attempts[0];
    expect(finished).toMatchObject({
      id: attempt.id,
      status: 'sent',
      acceptedWithoutImage: true,
      retryable: false,
      receipt: partial,
    });
    expect(finished.request).toBe(attempt.request);
    expect(store.retry(attempt.id)).toBeNull();
  });

  it('never treats an unknown or unaccepted report as saved without an image', () => {
    const store = createFeedbackStore();
    const attempt = store.start('composer', request)!;
    expect(store.finishWithoutImage(attempt.id)).toBe(false);
    store.fail(attempt.id, 'No confirmation');
    expect(store.finishWithoutImage(attempt.id)).toBe(false);
    expect(store.getSnapshot().attempts[0]).toMatchObject({ status: 'error', receipt: null });
    expect(store.getSnapshot().attempts[0].request).toBe(attempt.request);
  });

  it('keeps uncertainty separate from permission to retry, even after a later refusal', () => {
    const store = createFeedbackStore();
    const first = store.start('composer', request)!;
    store.fail(first.id, 'Response lost', true, 'unconfirmed');
    const retry = store.retry(first.id)!;
    store.fail(retry.id, 'Retry refused', false, 'not_accepted');
    expect(store.getSnapshot().attempts[0]).toMatchObject({
      retryable: false,
      failureOutcome: 'unconfirmed',
      receipt: null,
    });
    expect(store.getSnapshot().attempts[0].request).toBe(first.request);
    expect(store.retry(first.id)).toBeNull();
  });

  it('a confirmed receipt resolves earlier uncertainty but a nonretryable protocol failure does not', () => {
    const store = createFeedbackStore();
    const first = store.start('composer', request)!;
    store.fail(first.id, 'Response lost', true, 'unconfirmed');
    store.retry(first.id);
    store.complete(first.id, receipt);
    expect(store.getSnapshot().attempts[0].failureOutcome).toBeNull();
    const next = store.start('composer', request)!;
    store.fail(next.id, 'Invalid success codec', false, 'unconfirmed');
    expect(store.retry(next.id)).toBeNull();
    expect(store.getSnapshot().attempts.find(attempt => attempt.id === next.id)?.failureOutcome).toBe('unconfirmed');
  });

  it('account reset discards evidence and ignores every old completion', () => {
    const store = createFeedbackStore();
    store.updateDraft('composer', {
      message: 'Private account data',
      image: { ...request.attachment, source: 'capture' },
      context: { projectName: 'Private project' },
      surface: 'feedback-composer',
    });
    const attempt = store.start('composer', request)!;
    store.reset();
    expect(store.complete(attempt.id, receipt)).toBe(false);
    expect(store.fail(attempt.id, 'Old account failure')).toBe(false);
    expect(store.retry(attempt.id)).toBeNull();
    expect(store.getSnapshot().drafts.composer).toMatchObject({ message: '', image: null, diagnostics: null, context: null, surface: null });
    expect(store.getSnapshot().attempts).toEqual([]);
  });

  it('distinguishes complete text-only delivery from a missing requested image', () => {
    const partial = { ...receipt, attachmentStored: false };
    expect(feedbackDelivery({ attachment: null }, partial)).toBe('complete');
    expect(feedbackDelivery(request, partial)).toBe('partial');
  });

  it('publishes stable snapshots only on actual transitions and unsubscribes listeners', () => {
    const store = createFeedbackStore();
    const original = store.getSnapshot();
    expect(store.getSnapshot()).toBe(original);
    const seen: unknown[] = [];
    const unsubscribe = store.subscribe(() => seen.push(store.getSnapshot()));
    store.updateDraft('composer', { message: 'Retained while dismissed' });
    expect(seen).toHaveLength(1);
    expect(store.getSnapshot()).not.toBe(original);
    unsubscribe();
    store.reset();
    expect(seen).toHaveLength(1);
  });
});
