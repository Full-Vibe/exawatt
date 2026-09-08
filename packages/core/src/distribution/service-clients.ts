import type { OperatorStatsPublishPayload } from '../operator-stats';
import type { DistributionEndpointRefV1 } from './contract';
import {
  CompatibleServiceProtocolError,
  decodeCompatibleServiceJson,
  fetchCompatibleService,
  type CompatibleServiceFetch,
} from './service-protocol';

export interface CompatibleServiceCallOptions {
  fetcher?: CompatibleServiceFetch;
  signal?: AbortSignal;
}

export interface ContextLabelRequestV1 {
  schemaVersion: 1;
  sessionKey: string;
  projectName?: string | null;
  currentLabel?: string | null;
  currentLabelSource?:
    | 'provisional'
    | 'accepted'
    | 'operator'
    | 'restored'
    | null;
  initialInstruction?: string | null;
  recentInstructions: Array<{ text: string; submittedAt: number }>;
}

export interface ContextLabelResponseV1 {
  label: string;
  relationship: 'same_context' | 'new_context';
  confidence: number;
}

export interface ConversationSummariesRequestV1 {
  schemaVersion: 1;
  conversations: Array<{ key: string; turns: string[] }>;
}

export interface ConversationSummariesResponseV1 {
  conversations: Array<{ key: string; title: string; summary: string }>;
}

export interface GoalVisualRequestV1 {
  schemaVersion: 1;
  identityKey: string;
}

export interface GoalVisualResponseV1 {
  identityKey: string;
  dataUrl: string;
}

export type ProductFeedbackKindV1 =
  | 'general'
  | 'bug'
  | 'idea'
  | 'context_label';

export interface ProductFeedbackRequestV1 {
  schemaVersion: 1;
  kind: ProductFeedbackKindV1;
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

export interface ProductFeedbackResponseV1 {
  id: string;
  duplicate: boolean;
  attachmentStored: boolean;
}

export interface OperatorStatsProfileV1 {
  enabled: boolean;
  startedAt: string;
  lastSyncedAt: string;
}

export interface OperatorStatsProfileResponseV1 {
  profile: OperatorStatsProfileV1 | null;
}

export interface OperatorStatsPublishResponseV1 {
  handle: string;
  days: number;
  runs: number;
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const GOAL_IDENTITY = /^[a-f0-9]{64}$/;
const JPEG_DATA_URL = /^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/;

function object(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${name} is not an object`);
  }
  return value as Record<string, unknown>;
}

function expectedStatus(
  endpoint: DistributionEndpointRefV1,
  response: Response,
  allowed: readonly number[]
): void {
  if (allowed.includes(response.status)) return;
  throw new CompatibleServiceProtocolError(
    'invalid_response_status',
    `Compatible service returned unexpected success status ${response.status}`,
    endpoint.protocolVersion,
    String(endpoint.protocolVersion)
  );
}

function authorizedHeaders(accessToken: string, json = false): HeadersInit {
  return {
    authorization: `Bearer ${accessToken}`,
    ...(json ? { 'content-type': 'application/json' } : {}),
  };
}

async function callJson<T>(
  endpoint: DistributionEndpointRefV1,
  accessToken: string,
  method: 'GET' | 'POST',
  body: unknown | undefined,
  allowedStatuses: readonly number[],
  decode: (value: unknown) => T,
  options: CompatibleServiceCallOptions
): Promise<T> {
  const response = await fetchCompatibleService(
    endpoint,
    {
      method,
      headers: authorizedHeaders(accessToken, body !== undefined),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      ...(options.signal ? { signal: options.signal } : {}),
    },
    options.fetcher
  );
  expectedStatus(endpoint, response, allowedStatuses);
  return decodeCompatibleServiceJson(endpoint, response, decode);
}

function decodeContextLabel(value: unknown): ContextLabelResponseV1 {
  const input = object(value, 'context-label response');
  if (
    input.schemaVersion !== 1 ||
    typeof input.label !== 'string' ||
    input.label.length < 1 ||
    input.label.length > 72 ||
    (input.relationship !== 'same_context' &&
      input.relationship !== 'new_context') ||
    typeof input.confidence !== 'number' ||
    !Number.isFinite(input.confidence) ||
    input.confidence < 0 ||
    input.confidence > 1
  ) {
    throw new TypeError('context-label response is invalid');
  }
  return {
    label: input.label,
    relationship: input.relationship,
    confidence: input.confidence,
  };
}

function decodeConversationSummaries(
  value: unknown
): ConversationSummariesResponseV1 {
  const input = object(value, 'conversation-summaries response');
  if (
    input.schemaVersion !== 1 ||
    !Array.isArray(input.conversations) ||
    input.conversations.length > 8
  ) {
    throw new TypeError('conversation-summaries response is invalid');
  }
  return {
    conversations: input.conversations.map(value => {
      const row = object(value, 'conversation-summaries row');
      if (
        typeof row.key !== 'string' ||
        row.key.length < 1 ||
        row.key.length > 240 ||
        typeof row.title !== 'string' ||
        row.title.length < 1 ||
        row.title.length > 72 ||
        typeof row.summary !== 'string' ||
        row.summary.length < 1 ||
        row.summary.length > 220
      ) {
        throw new TypeError('conversation-summaries row is invalid');
      }
      return { key: row.key, title: row.title, summary: row.summary };
    }),
  };
}

function decodeGoalVisual(
  value: unknown,
  expectedIdentityKey: string
): GoalVisualResponseV1 {
  const input = object(value, 'goal-visual response');
  if (
    input.schemaVersion !== 1 ||
    input.identityKey !== expectedIdentityKey ||
    !GOAL_IDENTITY.test(expectedIdentityKey) ||
    typeof input.dataUrl !== 'string' ||
    input.dataUrl.length > 2_666_731 ||
    !JPEG_DATA_URL.test(input.dataUrl)
  ) {
    throw new TypeError('goal-visual response is invalid');
  }
  return { identityKey: expectedIdentityKey, dataUrl: input.dataUrl };
}

function decodeProductFeedback(value: unknown): ProductFeedbackResponseV1 {
  const input = object(value, 'product-feedback response');
  if (
    input.schemaVersion !== 1 ||
    typeof input.id !== 'string' ||
    !UUID.test(input.id) ||
    typeof input.duplicate !== 'boolean' ||
    typeof input.attachmentStored !== 'boolean'
  ) {
    throw new TypeError('product-feedback response is invalid');
  }
  return {
    id: input.id,
    duplicate: input.duplicate,
    attachmentStored: input.attachmentStored,
  };
}

function decodeOperatorStatsProfile(
  value: unknown
): OperatorStatsProfileResponseV1 {
  const input = object(value, 'operator-stats profile response');
  if (input.schemaVersion !== 1) {
    throw new TypeError('operator-stats profile response is invalid');
  }
  if (input.profile === null) return { profile: null };
  const profile = object(input.profile, 'operator-stats profile');
  if (
    typeof profile.enabled !== 'boolean' ||
    typeof profile.startedAt !== 'string' ||
    !Number.isFinite(Date.parse(profile.startedAt)) ||
    typeof profile.lastSyncedAt !== 'string' ||
    !Number.isFinite(Date.parse(profile.lastSyncedAt))
  ) {
    throw new TypeError('operator-stats profile response is invalid');
  }
  return {
    profile: {
      enabled: profile.enabled,
      startedAt: profile.startedAt,
      lastSyncedAt: profile.lastSyncedAt,
    },
  };
}

function decodeOperatorStatsPublish(
  value: unknown
): OperatorStatsPublishResponseV1 {
  const input = object(value, 'operator-stats publish response');
  if (
    input.schemaVersion !== 1 ||
    typeof input.handle !== 'string' ||
    input.handle.length > 39 ||
    !Number.isInteger(input.days) ||
    Number(input.days) < 0 ||
    Number(input.days) > 400 ||
    !Number.isInteger(input.runs) ||
    Number(input.runs) < 0 ||
    Number(input.runs) > 500
  ) {
    throw new TypeError('operator-stats publish response is invalid');
  }
  return {
    handle: input.handle,
    days: Number(input.days),
    runs: Number(input.runs),
  };
}

/** Exact production V1 operation used by Electron context-label enrichment. */
export function createContextLabel(
  endpoint: DistributionEndpointRefV1,
  accessToken: string,
  request: ContextLabelRequestV1,
  options: CompatibleServiceCallOptions = {}
): Promise<ContextLabelResponseV1> {
  return callJson(
    endpoint,
    accessToken,
    'POST',
    request,
    [200],
    decodeContextLabel,
    options
  );
}

/** Exact production V1 operation used by the recent-conversation catalog. */
export function summarizeConversations(
  endpoint: DistributionEndpointRefV1,
  accessToken: string,
  request: ConversationSummariesRequestV1,
  options: CompatibleServiceCallOptions = {}
): Promise<ConversationSummariesResponseV1> {
  return callJson(
    endpoint,
    accessToken,
    'POST',
    request,
    [200],
    decodeConversationSummaries,
    options
  );
}

/** Exact production V1 operation used by Electron and the HUD study. */
export function createGoalVisual(
  endpoint: DistributionEndpointRefV1,
  accessToken: string,
  request: GoalVisualRequestV1,
  options: CompatibleServiceCallOptions = {}
): Promise<GoalVisualResponseV1> {
  return callJson(
    endpoint,
    accessToken,
    'POST',
    request,
    [200],
    value => decodeGoalVisual(value, request.identityKey),
    options
  );
}

/** Exact production V1 operation used by the product-feedback provider. */
export function submitProductFeedback(
  endpoint: DistributionEndpointRefV1,
  accessToken: string,
  request: ProductFeedbackRequestV1,
  options: CompatibleServiceCallOptions = {}
): Promise<ProductFeedbackResponseV1> {
  return callJson(
    endpoint,
    accessToken,
    'POST',
    request,
    [200, 201],
    decodeProductFeedback,
    options
  );
}

/** Exact production V1 GET used by automatic operator-stat publication. */
export function getOperatorStatsProfile(
  endpoint: DistributionEndpointRefV1,
  accessToken: string,
  options: CompatibleServiceCallOptions = {}
): Promise<OperatorStatsProfileResponseV1> {
  return callJson(
    endpoint,
    accessToken,
    'GET',
    undefined,
    [200],
    decodeOperatorStatsProfile,
    options
  );
}

/** Exact production V1 POST used by automatic operator-stat publication. */
export function publishOperatorStats(
  endpoint: DistributionEndpointRefV1,
  accessToken: string,
  request: OperatorStatsPublishPayload,
  options: CompatibleServiceCallOptions = {}
): Promise<OperatorStatsPublishResponseV1> {
  return callJson(
    endpoint,
    accessToken,
    'POST',
    request,
    [200],
    decodeOperatorStatsPublish,
    options
  );
}

/** Exact production V1 DELETE used by the operator-profile removal control. */
export async function disableOperatorStatsProfile(
  endpoint: DistributionEndpointRefV1,
  accessToken: string,
  options: CompatibleServiceCallOptions = {}
): Promise<void> {
  const response = await fetchCompatibleService(
    endpoint,
    {
      method: 'DELETE',
      headers: authorizedHeaders(accessToken),
      ...(options.signal ? { signal: options.signal } : {}),
    },
    options.fetcher
  );
  expectedStatus(endpoint, response, [204]);
  const contentLength = response.headers.get('content-length');
  if (
    (contentLength !== null && contentLength !== '0') ||
    (await response.text()).length !== 0
  ) {
    throw new CompatibleServiceProtocolError(
      'invalid_response_body',
      'Compatible service returned a body for a 204 response',
      endpoint.protocolVersion,
      String(endpoint.protocolVersion)
    );
  }
}
