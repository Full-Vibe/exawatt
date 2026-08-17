import { cleanContextLabel } from '@/lib/context-labels/contract';

export const GOAL_VISUAL_SCHEMA_VERSION = 1;
export const MAX_GOAL_VISUAL_REQUEST_BYTES = 2_048;
export const MAX_GOAL_VISUAL_PROJECT_KEY_CHARS = 240;
export const MAX_GOAL_VISUAL_BYTES = 2_000_000;
export const GOAL_VISUAL_MIME_TYPE = 'image/jpeg' as const;

export interface GoalVisualRequest {
  schemaVersion: typeof GOAL_VISUAL_SCHEMA_VERSION;
  projectKey: string;
  label: string;
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

function cleanInline(value: string): string {
  return value.normalize('NFKC').replace(/\s+/g, ' ').trim();
}

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
  const allowedFields = new Set(['schemaVersion', 'projectKey', 'label']);
  if (Object.keys(input).some(field => !allowedFields.has(field))) {
    throw new Error('Request contains unsupported fields');
  }
  if (typeof input.projectKey !== 'string') {
    throw new Error('Project key is invalid');
  }
  const projectKey = cleanInline(input.projectKey);
  if (
    !projectKey ||
    projectKey.length > MAX_GOAL_VISUAL_PROJECT_KEY_CHARS ||
    /\p{Cc}/u.test(projectKey)
  ) {
    throw new Error('Project key is invalid');
  }
  const label = cleanContextLabel(input.label);
  if (!label) throw new Error('Accepted label is invalid');
  return { schemaVersion: GOAL_VISUAL_SCHEMA_VERSION, projectKey, label };
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
    !/^[a-f0-9]{64}$/.test(response.identityKey) ||
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
