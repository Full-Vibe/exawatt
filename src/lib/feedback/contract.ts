export const MAX_FEEDBACK_MESSAGE_CHARS = 12_000;
export const MAX_FEEDBACK_CONTEXT_BYTES = 32_000;
export const MAX_FEEDBACK_ATTACHMENT_BYTES = 5 * 1024 * 1024;
export const MAX_FEEDBACK_REQUEST_BYTES = 7 * 1024 * 1024;

export type FeedbackKind = 'general' | 'bug' | 'idea' | 'context_label';

export interface ProductFeedbackRequest {
  kind: FeedbackKind;
  sentiment?: -1 | 1 | null;
  message?: string | null;
  surface: string;
  appVersion?: string | null;
  buildSha?: string | null;
  platform?: string | null;
  context?: Record<string, unknown>;
  idempotencyKey: string;
  attachment?: { dataUrl: string; name?: string | null } | null;
}

export interface ParsedFeedback extends Omit<
  ProductFeedbackRequest,
  'attachment'
> {
  attachment: { bytes: Uint8Array; mimeType: string; extension: string } | null;
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATA_URL = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/;

function optionalText(
  value: unknown,
  name: string,
  maximum: number
): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') throw new Error(`${name} is invalid`);
  const clean = value.trim();
  if (!clean || clean.length > maximum || /\u0000/.test(clean)) {
    throw new Error(`${name} is invalid`);
  }
  return clean;
}

export function parseFeedbackRequest(raw: string): ParsedFeedback {
  if (new TextEncoder().encode(raw).byteLength > MAX_FEEDBACK_REQUEST_BYTES) {
    throw new Error('Request is too large');
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error('Request must be valid JSON');
  }
  if (!value || typeof value !== 'object')
    throw new Error('Request is invalid');
  const input = value as Record<string, unknown>;
  if (
    !['general', 'bug', 'idea', 'context_label'].includes(String(input.kind))
  ) {
    throw new Error('Feedback kind is invalid');
  }
  if (
    input.sentiment !== undefined &&
    input.sentiment !== null &&
    input.sentiment !== -1 &&
    input.sentiment !== 1
  ) {
    throw new Error('Feedback sentiment is invalid');
  }
  const message = optionalText(
    input.message,
    'Feedback message',
    MAX_FEEDBACK_MESSAGE_CHARS
  );
  const surface = optionalText(input.surface, 'Feedback surface', 120);
  if (!surface) throw new Error('Feedback surface is invalid');
  if (
    typeof input.idempotencyKey !== 'string' ||
    !UUID.test(input.idempotencyKey)
  ) {
    throw new Error('Idempotency key is invalid');
  }
  const context = input.context ?? {};
  if (!context || typeof context !== 'object' || Array.isArray(context)) {
    throw new Error('Feedback context is invalid');
  }
  if (
    new TextEncoder().encode(JSON.stringify(context)).byteLength >
    MAX_FEEDBACK_CONTEXT_BYTES
  ) {
    throw new Error('Feedback context is too large');
  }
  if (
    input.kind === 'context_label' &&
    input.sentiment !== -1 &&
    input.sentiment !== 1
  ) {
    throw new Error('Context-label feedback requires a vote');
  }
  if (input.kind !== 'context_label' && !message) {
    throw new Error('Feedback message is required');
  }

  let attachment: ParsedFeedback['attachment'] = null;
  if (input.attachment !== null && input.attachment !== undefined) {
    if (!input.attachment || typeof input.attachment !== 'object') {
      throw new Error('Feedback attachment is invalid');
    }
    const dataUrl = (input.attachment as { dataUrl?: unknown }).dataUrl;
    if (typeof dataUrl !== 'string')
      throw new Error('Feedback attachment is invalid');
    const match = DATA_URL.exec(dataUrl);
    if (!match) throw new Error('Feedback attachment type is invalid');
    const bytes = Uint8Array.from(Buffer.from(match[2], 'base64'));
    if (!bytes.byteLength || bytes.byteLength > MAX_FEEDBACK_ATTACHMENT_BYTES) {
      throw new Error('Feedback attachment is too large');
    }
    const mimeType = match[1];
    attachment = {
      bytes,
      mimeType,
      extension: mimeType === 'image/jpeg' ? 'jpg' : mimeType.split('/')[1],
    };
  }

  return {
    kind: input.kind as FeedbackKind,
    sentiment: (input.sentiment as -1 | 1 | null | undefined) ?? null,
    message,
    surface,
    appVersion: optionalText(input.appVersion, 'App version', 80),
    buildSha: optionalText(input.buildSha, 'Build SHA', 80),
    platform: optionalText(input.platform, 'Platform', 80),
    context: context as Record<string, unknown>,
    idempotencyKey: input.idempotencyKey,
    attachment,
  };
}
