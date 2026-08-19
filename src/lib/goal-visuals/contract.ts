export const GOAL_VISUAL_SCHEMA_VERSION = 1;
/**
 * A request is an envelope plus one 64-character key: about 100 bytes. The
 * bound is deliberately far below anything that could carry a sentence, so a
 * caller that tried to smuggle text is refused by size before it is refused by
 * shape (BUG-091).
 */
export const MAX_GOAL_VISUAL_REQUEST_BYTES = 512;
export const MAX_GOAL_VISUAL_BYTES = 2_000_000;
export const GOAL_VISUAL_MIME_TYPE = 'image/jpeg' as const;

/** Lowercase SHA-256 hex, the only identity shape this service accepts. */
export const GOAL_VISUAL_IDENTITY_KEY_PATTERN = /^[a-f0-9]{64}$/;

/**
 * The V1 goal-visual request (`contracts/services/v1/schemas/goal-visuals.schema.json`).
 *
 * `identityKey` is derived on the client and opaque here: no Project name, no
 * accepted goal label, no prompt, instruction, path, or transcript. The service
 * cannot recover the goal it stands for, and does not need to — the prompt is
 * assembled from fixed word lists indexed by bytes of the key itself.
 */
export interface GoalVisualRequest {
  schemaVersion: typeof GOAL_VISUAL_SCHEMA_VERSION;
  identityKey: string;
}

export interface GoalVisualResponse {
  identityKey: string;
  dataUrl: string;
}

export type GoalVisualErrorCode =
  | 'unauthorized'
  | 'invalid_request'
  | 'authentication_unavailable'
  | 'quota_unavailable'
  | 'quota_reached'
  | 'cache_unavailable'
  | 'generation_unavailable'
  | 'generation_failed'
  | 'safety_rejected';

export function parseGoalVisualRequest(raw: string): GoalVisualRequest {
  if (Buffer.byteLength(raw, 'utf8') > MAX_GOAL_VISUAL_REQUEST_BYTES) {
    throw new Error('Request is too large');
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error('Request must be valid JSON');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Request is invalid');
  }
  const input = value as Record<string, unknown>;
  if (input.schemaVersion !== GOAL_VISUAL_SCHEMA_VERSION) {
    throw new Error('Schema version is unsupported');
  }
  // Closed object: a request carrying anything besides the identity is
  // refused rather than ignored, so a client that regresses to sending a
  // label learns immediately instead of transmitting it successfully.
  const allowedFields = new Set(['schemaVersion', 'identityKey']);
  if (Object.keys(input).some(field => !allowedFields.has(field))) {
    throw new Error('Request contains unsupported fields');
  }
  if (
    typeof input.identityKey !== 'string' ||
    !GOAL_VISUAL_IDENTITY_KEY_PATTERN.test(input.identityKey)
  ) {
    throw new Error('Identity key is invalid');
  }
  return {
    schemaVersion: GOAL_VISUAL_SCHEMA_VERSION,
    identityKey: input.identityKey,
  };
}

export function goalVisualDataUrl(bytes: Uint8Array): string {
  if (bytes.byteLength < 1 || bytes.byteLength > MAX_GOAL_VISUAL_BYTES) {
    throw new Error('Goal visual bytes are invalid');
  }
  return `data:${GOAL_VISUAL_MIME_TYPE};base64,${Buffer.from(bytes).toString('base64')}`;
}

export function parseGoalVisualResponse(value: unknown): GoalVisualResponse {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Goal visual response is invalid');
  }
  const response = value as Record<string, unknown>;
  if (
    typeof response.identityKey !== 'string' ||
    !GOAL_VISUAL_IDENTITY_KEY_PATTERN.test(response.identityKey) ||
    typeof response.dataUrl !== 'string' ||
    !response.dataUrl.startsWith(`data:${GOAL_VISUAL_MIME_TYPE};base64,`) ||
    response.dataUrl.length > Math.ceil((MAX_GOAL_VISUAL_BYTES * 4) / 3) + 64
  ) {
    throw new Error('Goal visual response is invalid');
  }
  return {
    identityKey: response.identityKey,
    dataUrl: response.dataUrl,
  };
}
