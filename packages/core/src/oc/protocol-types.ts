// ============================================================
// OC Gateway wire format (INTERNAL — not exported)
// Raw JSON frames over WebSocket: req/res/event, NOT JSON-RPC 2.0.
// The protocol VERSION is negotiated per connection; see MIN_PROTOCOL and
// MAX_PROTOCOL below rather than assuming a single number here.
// ============================================================

// Base frame types
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

/**
 * Device identity for auth. Encodings are the Gateway's, not ours: it decodes
 * base64url and derives the id as SHA-256 over the raw key bytes. Sending hex
 * here is what "device identity mismatch" means on the wire.
 */
export interface OCDeviceIdentity {
  /** SHA-256 of the raw public key bytes, hex. */
  id: string;
  /** base64url raw Ed25519 public key, unpadded. */
  publicKey: string;
  /** base64url signature over the UTF-8 auth payload. */
  signature: string;
  signedAt: number; // unix ms timestamp
  nonce: string; // echo back the server's nonce
}

/**
 * Gateway protocol range Exawatt negotiates.
 *
 * These were pinned at 3/3 until a live connection to a current OpenClaw
 * install (2026.7.x) was rejected with "protocol mismatch": that server
 * accepts an operator client only when `maxProtocol >= 4 && minProtocol <= 4`.
 * A pinned client could not reach it at all.
 *
 * Advertising a RANGE rather than a single number is what keeps both eras
 * reachable: a v3 gateway sees a max at or above its own version, a v4 gateway
 * sees a min at or below its own, and each picks what it speaks. Widen
 * `MAX_PROTOCOL` only alongside evidence that the newer protocol's frames are
 * actually handled here.
 */
export const MIN_PROTOCOL = 3 as const;
export const MAX_PROTOCOL = 4 as const;

// Connect request params
export interface OCConnectParams {
  minProtocol: typeof MIN_PROTOCOL;
  maxProtocol: typeof MAX_PROTOCOL;
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

export interface CronAddParams {
  name: string;
  schedule: string; // cron expression
  prompt: string;
  sessionKey?: string;
  enabled?: boolean;
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
