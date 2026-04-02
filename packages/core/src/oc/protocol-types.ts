// ============================================================
// OC Protocol v3 — Wire format types (INTERNAL — not exported)
// These represent the raw JSON frames over WebSocket.
// Protocol: req/res/event (NOT JSON-RPC 2.0)
// ============================================================

// Base frame types
export type OCFrameType = 'req' | 'res' | 'event';

export interface OCRequest<P = unknown> {
  type: 'req';
  id: string;
  method: string;
  params: P;
}

export interface OCResponse<R = unknown> {
  type: 'res';
  id: string;
  ok: boolean;
  payload: R;
  error?: { code: string; message: string };
}

export interface OCEvent<P = unknown> {
  type: 'event';
  event: string;
  payload: P;
  seq?: number;
  stateVersion?: number;
}

// Connect challenge (first frame server sends)
export interface OCConnectChallenge {
  nonce: string;
  ts: number;
}

// Device identity for auth
export interface OCDeviceIdentity {
  id: string; // device fingerprint
  publicKey: string; // hex-encoded Ed25519 public key
  signature: string; // hex-encoded signature of the auth payload
  signedAt: number; // unix ms timestamp
  nonce: string; // echo back the server's nonce
}

// Connect request params
export interface OCConnectParams {
  minProtocol: 3;
  maxProtocol: 3;
  role: string;
  scopes: string[];
  auth?: { token?: string; deviceToken?: string; password?: string };
  device?: OCDeviceIdentity;
  client: {
    id: string;
    version: string;
    platform: string;
    mode: string;
    instanceId?: string;
  };
  caps: string[];
  userAgent: string;
  locale: string;
}

// Hello OK payload
export interface OCHelloOk {
  type: 'hello-ok';
  protocol: number;
  policy: { tickIntervalMs: number };
  auth: { deviceToken: string };
}

// ---- Method Params ----

export interface ChatSendParams {
  text: string;
  sessionKey?: string;
  idempotencyKey?: string;
}

export interface ChatHistoryParams {
  sessionKey?: string;
  limit?: number;
}

export interface ChatAbortParams {
  sessionKey?: string;
}

export interface ChatInjectParams {
  text: string;
  sessionKey?: string;
}

export interface SessionsListParams {}
export interface SessionsGetParams {
  key: string;
}
export interface SessionsResetParams {
  key: string;
}
export interface SessionsPatchParams {
  key: string;
  patch: {
    thinkingLevel?: number;
    verboseLevel?: number;
    model?: string;
  };
}

export interface CronListParams {}
export interface CronAddParams {
  name: string;
  schedule: string; // cron expression
  prompt: string;
  sessionKey?: string;
  enabled?: boolean;
}
export interface CronRunParams {
  jobId: string;
}
export interface CronUpdateParams {
  jobId: string;
  patch: Partial<CronAddParams>;
}
export interface CronRemoveParams {
  jobId: string;
}
export interface CronStatusParams {}
export interface CronRunsParams {
  jobId: string;
}

// ---- Method Results ----

export interface OCSession {
  key: string;
  agentId: string;
  createdAt: number;
  lastActiveAt: number;
  transcript?: OCTranscriptEntry[];
}

export interface OCTranscriptEntry {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  runId?: string;
}

export interface ChatSendResult {
  runId: string;
  status: 'ok' | 'queued';
}

export interface ChatHistoryResult {
  messages: OCTranscriptEntry[];
  sessionKey: string;
}

export interface SessionsListResult {
  sessions: OCSession[];
}

export interface OCCronJob {
  id: string;
  name: string;
  schedule: string;
  prompt: string;
  sessionKey?: string;
  enabled: boolean;
  lastRun?: number;
  nextRun?: number;
  status?: 'idle' | 'running' | 'error';
}

export interface OCCronRun {
  id: string;
  jobId: string;
  startedAt: number;
  completedAt?: number;
  status: 'success' | 'error' | 'running';
  error?: string;
}

export interface CronListResult {
  jobs: OCCronJob[];
}
export interface CronRunsResult {
  runs: OCCronRun[];
}

export interface OCHealthResult {
  uptime: number;
  version: string;
  agents: number;
  sessions: number;
}

// ---- Event Payloads ----

export interface ChatSegmentPayload {
  sessionKey: string;
  runId: string;
  delta: string;
  done: boolean;
}

export interface ChatToolPayload {
  sessionKey: string;
  runId: string;
  tool: string;
  input: Record<string, unknown>;
  output?: string;
  done: boolean;
}

export interface PresencePayload {
  agentId: string;
  online: boolean;
  sessionCount: number;
}

export interface TickPayload {
  ts: number;
}

export interface HealthPayload {
  uptime: number;
  healthy: boolean;
}

// Known event names
export type OCEventName =
  | 'connect.challenge'
  | 'chat.segment'
  | 'chat.tool'
  | 'presence'
  | 'tick'
  | 'health'
  | 'agent';

// Typed event union
export type OCTypedEvent =
  | (OCEvent<OCConnectChallenge> & { event: 'connect.challenge' })
  | (OCEvent<ChatSegmentPayload> & { event: 'chat.segment' })
  | (OCEvent<ChatToolPayload> & { event: 'chat.tool' })
  | (OCEvent<PresencePayload> & { event: 'presence' })
  | (OCEvent<TickPayload> & { event: 'tick' })
  | (OCEvent<HealthPayload> & { event: 'health' });
