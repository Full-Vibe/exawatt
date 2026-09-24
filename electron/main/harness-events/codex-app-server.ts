/**
 * Codex app-server read adapter (ENG-023 D5).
 *
 * The interactive Codex TUI remains the owner of the Agent Session. This
 * adapter starts a separate, read-side app-server and asks the Codex-owned
 * protocol for thread lineage and lifecycle. It never reads rollout files,
 * process trees, worktrees, or terminal text.
 */
import {
  execFile,
  spawn,
  type ChildProcessWithoutNullStreams,
} from 'child_process';
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';
import { defaultShell, type PtySessionInfo } from '../pty/session-manager';
import { planLoginShell, shellQuote } from '../pty/login-shell';
import type { DelegationReportSink } from './delegation-monitor';
import {
  delegationObservations,
  type DelegationObservations,
  type DelegationObservation,
} from './delegation-observation';

const MINIMUM_PROTOCOL_VERSION = [0, 147, 0] as const;
const MAX_FRAME_BYTES = 2 * 1024 * 1024;
/** How much of an oversize frame's head and tail is kept to find its id. */
const FRAME_EDGE_CHARS = 64;
const REQUEST_TIMEOUT_MS = 4_000;
const POLL_INTERVAL_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;
const MAX_ROOT_READS = 4;
const MAX_CHILD_READS = 2;
export const CODEX_OBSERVER_MAX_CONCURRENT_READS =
  MAX_ROOT_READS * MAX_CHILD_READS;
const DESCENDANT_PAGE_SIZE = 200;
const MAX_DESCENDANT_PAGES = 20;
const ACTIVITY_WINDOW = 256;
const MAX_ACTIVITY_PAGES = 20;
const SUBAGENT_SOURCE_KINDS = [
  'subAgent',
  'subAgentReview',
  'subAgentCompact',
  'subAgentThreadSpawn',
  'subAgentOther',
] as const;

type JsonObject = Record<string, unknown>;

export interface CodexChildThread {
  id: string;
  parentThreadId: string;
  agentNickname: string | null;
  agentRole: string | null;
  agentPath: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface CodexTurnSummary {
  status: 'completed' | 'interrupted' | 'failed' | 'inProgress';
  completedAt: number | null;
}

export type CodexSubagentActivity = 'started' | 'interacted' | 'interrupted';

export interface CodexDelegationProtocol {
  readonly version?: string | null;
  connect(): Promise<void>;
  close(): void;
  listDescendants(ancestorThreadId: string): Promise<CodexChildThread[]>;
  latestTurn(threadId: string): Promise<CodexTurnSummary | null>;
  latestSubagentActivity(
    parentThreadId: string,
    childThreadIds: readonly string[]
  ): Promise<Map<string, CodexSubagentActivity>>;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
  method: string;
}

function object(value: unknown): JsonObject | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

function nullableString(value: unknown): string | null | undefined {
  return value === null ? null : typeof value === 'string' ? value : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}

export class CodexProtocolReadError extends Error {
  constructor(
    readonly method: string,
    readonly code: number | undefined,
    message: string
  ) {
    super(message);
  }
  get unsupported(): boolean {
    return (
      this.code === -32601 ||
      /method[^\r\n]*(?:not[ -]supported|unsupported|not[ -]found)|unsupported[ -]method/i.test(
        this.message
      )
    );
  }
}

function observationFailure(error: unknown): DelegationObservation['reason'] {
  // A Session's own data past Exawatt's limits is Exawatt's to disclose, not
  // Codex's (BUG-183). A permanent verdict is the installed provider
  // declining the protocol, not a read Exawatt is retrying, so it discloses
  // as unsupported.
  if (isSessionDataError(error)) return 'unreadable';
  return (error instanceof CodexProtocolReadError && error.unsupported) ||
    isPermanentVerdict(error)
    ? 'unsupported'
    : 'read-failed';
}

/**
 * A verdict about the installed provider, not about this attempt.
 *
 * Every other failure this adapter meets is transient: a spawn that failed, a
 * request that timed out, a process that exited. Asking again is the right
 * response to those. A protocol verdict is different in kind: the installed
 * app-server is older than the schema this adapter reads, or it broke the
 * wire protocol itself (a line that is not JSON, a response with no result),
 * and asking the same binary again returns the same verdict. Throwing it as a
 * plain error put it on the retry ladder, which spawned a login shell and a
 * `codex app-server` every 30 seconds for as long as any Codex Session was
 * live (BUG-146). The marker is what lets the observer remember it instead.
 *
 * It is a claim about the BINARY, so it is never made from one Session's
 * data: a page that is too large, too long or shaped unexpectedly for one
 * Session is a `CodexSessionDataError` (BUG-183).
 */
export class CodexProtocolIncompatibleError extends Error {
  readonly permanent = true as const;

  constructor(message: string) {
    super(`Codex delegation protocol incompatible: ${message}`);
    this.name = 'CodexProtocolIncompatibleError';
  }
}

/** Is this a verdict about the binary rather than a failure of the attempt? */
export function isPermanentVerdict(error: unknown): error is Error {
  return (
    error instanceof Error &&
    (error as { permanent?: unknown }).permanent === true
  );
}

/**
 * A failure that belongs to ONE Session's data, not to the installed binary
 * (BUG-183).
 *
 * The strict parser refusing a child row, a lineage past the bounded pages,
 * a response over Exawatt's own 2 MiB frame cap: each depends on what that
 * Session holds. Asking again for another Session answers normally; asking
 * again for this one answers the same until its data changes. So it is
 * withdrawn and retried per read on its own ladder, never held as a verdict
 * about Codex, never closes the shared connection, and is never disclosed as
 * Codex refusing something: these are Exawatt's limits.
 */
export class CodexSessionDataError extends Error {
  readonly scope = 'session' as const;

  constructor(message: string) {
    super(`Codex Session data unreadable: ${message}`);
    this.name = 'CodexSessionDataError';
  }
}

/** Is this a failure of one Session's data rather than of the binary? */
export function isSessionDataError(error: unknown): error is Error {
  return (
    error instanceof Error &&
    (error as { scope?: unknown }).scope === 'session'
  );
}

/** "This binary cannot do X": held per binary path and version. */
function binaryVerdict(message: string): Error {
  return new CodexProtocolIncompatibleError(message);
}

/** "This Session's data could not be read": per Session, retried. */
function sessionDataError(message: string): Error {
  return new CodexSessionDataError(message);
}

function codexInvocation(): string {
  const fixtureBin = process.env.EXAWATT_TEST_HARNESS_BIN;
  if (
    process.env.EXAWATT_TEST === '1' &&
    fixtureBin &&
    path.isAbsolute(fixtureBin)
  ) {
    return shellQuote(path.join(fixtureBin, 'codex'));
  }
  return 'codex';
}

export function codexProtocolVersion(userAgent: unknown): number[] | null {
  if (typeof userAgent !== 'string') return null;
  const match = /\/(\d+)\.(\d+)\.(\d+)(?:[-+][^ ]+)?(?:\s|$)/.exec(userAgent);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function codexProtocolVersionSupported(
  version: readonly number[]
): boolean {
  for (let index = 0; index < MINIMUM_PROTOCOL_VERSION.length; index += 1) {
    const actual = version[index] ?? 0;
    const minimum = MINIMUM_PROTOCOL_VERSION[index];
    if (actual > minimum) return true;
    if (actual < minimum) return false;
  }
  return true;
}

export function parseCodexThreadPage(value: unknown): {
  data: CodexChildThread[];
  nextCursor: string | null;
} {
  const page = object(value);
  if (!page || !Array.isArray(page.data)) {
    throw sessionDataError('thread/list response has no data array');
  }
  const nextCursor = nullableString(page.nextCursor);
  if (nextCursor === undefined) {
    throw sessionDataError('thread/list response has an invalid cursor');
  }
  const data = page.data.map((candidate, index) => {
    const thread = object(candidate);
    if (!thread)
      throw sessionDataError(`thread/list row ${index} is not an object`);
    const id = nullableString(thread.id);
    const parentThreadId = nullableString(thread.parentThreadId);
    const agentNickname = nullableString(thread.agentNickname);
    const agentRole = nullableString(thread.agentRole);
    const createdAt = finiteNumber(thread.createdAt);
    const updatedAt = finiteNumber(thread.updatedAt);
    if (
      !id ||
      !parentThreadId ||
      agentNickname === undefined ||
      agentRole === undefined ||
      createdAt === undefined ||
      updatedAt === undefined
    ) {
      throw sessionDataError(
        `thread/list row ${index} has an invalid child shape`
      );
    }
    const source = object(thread.source);
    const subAgent = object(source?.subAgent);
    const threadSpawn = object(subAgent?.thread_spawn);
    const agentPath = nullableString(threadSpawn?.agent_path) ?? null;
    return {
      id,
      parentThreadId,
      agentNickname,
      agentRole,
      agentPath,
      createdAt,
      updatedAt,
    };
  });
  return { data, nextCursor };
}

export function parseCodexLatestTurn(value: unknown): CodexTurnSummary | null {
  const page = object(value);
  if (!page || !Array.isArray(page.data)) {
    throw sessionDataError('thread/turns/list response has no data array');
  }
  if (page.data.length === 0) return null;
  const turn = object(page.data[0]);
  const status = turn?.status;
  const completedAt = nullableNumber(turn?.completedAt);
  if (
    !turn ||
    (status !== 'completed' &&
      status !== 'interrupted' &&
      status !== 'failed' &&
      status !== 'inProgress') ||
    completedAt === undefined
  ) {
    throw sessionDataError('thread/turns/list returned an invalid latest turn');
  }
  return { status, completedAt };
}

function nullableNumber(value: unknown): number | null | undefined {
  return value === null ? null : finiteNumber(value);
}

export function parseCodexSubagentActivity(
  value: unknown
): Map<string, CodexSubagentActivity> {
  const page = object(value);
  if (!page || !Array.isArray(page.data)) {
    throw sessionDataError('thread/items/list response has no data array');
  }
  const latest = new Map<string, CodexSubagentActivity>();
  // The request is descending. First source-reported activity for a child is
  // its latest; older rows must never overwrite a later resume/interruption.
  for (const entryValue of page.data) {
    const entry = object(entryValue);
    const item = object(entry?.item);
    if (item?.type !== 'subAgentActivity') continue;
    const childId = nullableString(item.agentThreadId);
    const kind = item.kind;
    if (
      !childId ||
      (kind !== 'started' && kind !== 'interacted' && kind !== 'interrupted')
    ) {
      throw sessionDataError('subAgentActivity item has an invalid shape');
    }
    if (!latest.has(childId)) latest.set(childId, kind);
  }
  return latest;
}

async function launchCodexAppServer(): Promise<ChildProcessWithoutNullStreams> {
  const shell = await defaultShell();
  const plan = planLoginShell(shell, {
    command: `${codexInvocation()} app-server --stdio`,
    directory: os.homedir(),
  });
  return spawn(shell, plan.args, {
    cwd: plan.cwd,
    env: { ...process.env, SHELL: shell },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

/** The protocol returns item envelopes in requested descending order. */
export function parseCodexConversationItems(value: unknown): unknown[] {
  const page = object(value);
  if (!Array.isArray(page?.data))
    throw sessionDataError('thread/items/list response has no data array');
  return [...page.data].reverse().map(entry => {
    const item = object(object(entry)?.item);
    if (!item)
      throw sessionDataError('thread/items/list entry has no item object');
    return item;
  });
}

/**
 * The request id of a frame too large to parse. Verified on the installed
 * 0.156.1 app-server (2026-09-23): a result frame is serialized id-first,
 * `{"id":1,"result":…}`, and an error frame id-last,
 * `{"error":…,"id":3}`, so one edge names the request. Null for a
 * notification or any other layout.
 */
function oversizeFrameId(frame: {
  head: string;
  tail: string;
}): number | null {
  const match =
    /^\s*\{\s*"id"\s*:\s*(\d+)\s*,/u.exec(frame.head) ??
    /,\s*"id"\s*:\s*(\d+)\s*\}\s*$/u.exec(frame.tail);
  return match ? Number(match[1]) : null;
}

const execFileAsync = promisify(execFile);

/**
 * Where the operator's login shell finds `codex`. One shell spawn, made once
 * when a permanent verdict is recorded, so the verdict can be keyed to the
 * binary it judged. Null when the shell did not answer with an absolute path;
 * the verdict is then keyed to the observed Session set alone.
 */
async function resolveCodexBinary(): Promise<string | null> {
  const shell = await defaultShell();
  const plan = planLoginShell(shell, {
    command: `command -v ${codexInvocation()}`,
  });
  try {
    const result = await execFileAsync(shell, plan.args, {
      cwd: plan.cwd,
      timeout: 8_000,
      maxBuffer: 64 * 1024,
      encoding: 'utf8',
    });
    const resolved = result.stdout.split('\n')[0]?.trim();
    return resolved && path.isAbsolute(resolved) ? resolved : null;
  } catch {
    return null;
  }
}

/**
 * The binary as it is on disk right now. A `stat`, never a spawn: this is what
 * a remembered verdict is re-checked against on every poll, so it has to be
 * free. Null when the path is gone, which counts as a change.
 */
function fingerprintCodexBinary(binaryPath: string): string | null {
  try {
    const stats = fs.statSync(binaryPath);
    return `${stats.ino}:${stats.size}:${stats.mtimeMs}`;
  } catch {
    return null;
  }
}

/** JSON-RPC client for the installed Codex app-server. */
export class CodexAppServerClient implements CodexDelegationProtocol {
  private process: ChildProcessWithoutNullStreams | null = null;
  private nextRequestId = 1;
  private pending = new Map<number, PendingRequest>();
  private stdoutBuffer = '';
  private stdoutBufferBytes = 0;
  /**
   * A frame over the cap being skipped to its newline. Only its edges are
   * kept, because they carry the request id that names whose read it was.
   */
  private oversize: { head: string; tail: string } | null = null;
  private stderrTail = '';
  private connected = false;
  version: string | null = null;

  private generation = 0;
  private connecting: Promise<void> | null = null;

  constructor(
    private readonly launch: () => Promise<ChildProcessWithoutNullStreams> = launchCodexAppServer
  ) {}

  async connect(): Promise<void> {
    if (this.connected && this.process) return;
    if (this.connecting) return this.connecting;
    const connecting = this.open(++this.generation);
    this.connecting = connecting;
    try {
      await connecting;
    } finally {
      if (this.connecting === connecting) this.connecting = null;
    }
  }

  private async open(generation: number): Promise<void> {
    const child = await this.launch();
    if (this.generation !== generation) {
      child.kill();
      throw new Error('Codex app-server connection superseded');
    }
    this.process = child;
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      if (this.process === child) this.acceptOutput(String(chunk));
    });
    child.stderr.setEncoding('utf8');
    this.stderrTail = '';
    child.stderr.on('data', chunk => {
      if (this.process !== child) return;
      this.stderrTail = `${this.stderrTail}${String(chunk)}`.slice(-4_096);
    });
    child.on('error', error => {
      if (this.process === child) this.fail(error);
    });
    child.on('exit', (code, signal) => {
      if (this.process !== child) return;
      this.fail(
        new Error(
          `Codex app-server exited (${code ?? signal ?? 'unknown'})${
            this.stderrTail ? `: ${this.stderrTail.trim()}` : ''
          }`
        )
      );
    });

    try {
      const initialized = object(
        await this.request('initialize', {
          clientInfo: {
            name: 'exawatt-delegation',
            title: 'Exawatt delegation observer',
            version: '1',
          },
          capabilities: {
            experimentalApi: true,
            requestAttestation: false,
          },
        })
      );
      const version = codexProtocolVersion(initialized?.userAgent);
      this.version = version?.join('.') ?? null;
      if (!version || !codexProtocolVersionSupported(version)) {
        throw binaryVerdict('installed app-server is older than 0.147.0');
      }
      if (this.process !== child)
        throw new Error('Codex app-server connection superseded');
      this.notify('initialized', {});
      this.connected = true;
    } catch (error) {
      if (this.process === child) this.close();
      throw error;
    }
  }

  close(): void {
    this.generation += 1;
    this.connecting = null;
    const child = this.process;
    this.process = null;
    this.connected = false;
    this.stdoutBuffer = '';
    this.stdoutBufferBytes = 0;
    this.oversize = null;
    if (child && !child.killed) child.kill();
    this.rejectPending(new Error('Codex app-server connection closed'));
  }

  async listDescendants(ancestorThreadId: string): Promise<CodexChildThread[]> {
    const descendants: CodexChildThread[] = [];
    let cursor: string | null = null;
    for (let pageIndex = 0; pageIndex < MAX_DESCENDANT_PAGES; pageIndex += 1) {
      const page = parseCodexThreadPage(
        await this.request('thread/list', {
          ancestorThreadId,
          limit: DESCENDANT_PAGE_SIZE,
          sortKey: 'created_at',
          sortDirection: 'asc',
          sourceKinds: SUBAGENT_SOURCE_KINDS,
          ...(cursor ? { cursor } : {}),
        })
      );
      descendants.push(...page.data);
      cursor = page.nextCursor;
      if (!cursor) return descendants;
    }
    throw sessionDataError('thread/list exceeded the bounded descendant pages');
  }

  async latestTurn(threadId: string): Promise<CodexTurnSummary | null> {
    return parseCodexLatestTurn(
      await this.request('thread/turns/list', {
        threadId,
        limit: 1,
        sortDirection: 'desc',
        itemsView: 'summary',
      })
    );
  }

  async latestSubagentActivity(
    parentThreadId: string,
    childThreadIds: readonly string[]
  ): Promise<Map<string, CodexSubagentActivity>> {
    const wanted = new Set(childThreadIds);
    const latest = new Map<string, CodexSubagentActivity>();
    let cursor: string | null = null;
    for (let pageIndex = 0; pageIndex < MAX_ACTIVITY_PAGES; pageIndex += 1) {
      const response = await this.request('thread/items/list', {
        threadId: parentThreadId,
        limit: ACTIVITY_WINDOW,
        sortDirection: 'desc',
        ...(cursor ? { cursor } : {}),
      });
      const page = object(response);
      const activities = parseCodexSubagentActivity(response);
      for (const [childId, kind] of activities) {
        if (!latest.has(childId)) latest.set(childId, kind);
      }
      if ([...wanted].every(childId => latest.has(childId))) return latest;
      const nextCursor = nullableString(page?.nextCursor);
      if (nextCursor === undefined) {
        throw sessionDataError('thread/items/list response has an invalid cursor');
      }
      cursor = nextCursor;
      if (!cursor) return latest;
    }
    throw sessionDataError(
      'thread/items/list exceeded the bounded activity pages'
    );
  }

  /** An explicit local handoff reads only this exact thread's recent items. */
  async recentConversationItems(threadId: string): Promise<unknown[]> {
    const page = object(
      await this.request('thread/items/list', {
        threadId,
        limit: 80,
        sortDirection: 'desc',
      })
    );
    return parseCodexConversationItems(page);
  }

  private request(method: string, params: JsonObject): Promise<unknown> {
    const id = this.nextRequestId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex app-server request timed out: ${method}`));
      }, REQUEST_TIMEOUT_MS);
      timer.unref?.();
      this.pending.set(id, { resolve, reject, timer, method });
      try {
        this.write({ method, id, params });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private notify(method: string, params: JsonObject): void {
    this.write({ method, params });
  }

  private write(message: JsonObject): void {
    const child = this.process;
    if (!child || !child.stdin.writable) {
      throw new Error('Codex app-server is unavailable');
    }
    child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  /**
   * Split stdout into frames. A frame over `MAX_FRAME_BYTES` is Exawatt's own
   * limit meeting ONE response, so it fails that one read and nothing else
   * (BUG-183): the bytes are skipped to the frame's newline, the connection
   * stays up, and every other Session's read on it proceeds. Failing the
   * connection instead rejected every in-flight read with the same error,
   * which is how one Session's large page became a verdict on all of them.
   */
  private acceptOutput(chunk: string): void {
    let rest = chunk;
    while (rest.length > 0) {
      const newline = rest.indexOf('\n');
      const piece = newline < 0 ? rest : rest.slice(0, newline);
      rest = newline < 0 ? '' : rest.slice(newline + 1);
      if (this.oversize) {
        this.oversize.tail = (this.oversize.tail + piece).slice(
          -FRAME_EDGE_CHARS
        );
      } else {
        this.stdoutBuffer += piece;
        this.stdoutBufferBytes += Buffer.byteLength(piece);
        if (this.stdoutBufferBytes > MAX_FRAME_BYTES) {
          this.oversize = {
            head: this.stdoutBuffer.slice(0, FRAME_EDGE_CHARS),
            tail: this.stdoutBuffer.slice(-FRAME_EDGE_CHARS),
          };
          this.stdoutBuffer = '';
          this.stdoutBufferBytes = 0;
        }
      }
      if (newline < 0) return;
      const oversize = this.oversize;
      const line = this.stdoutBuffer.trim();
      this.oversize = null;
      this.stdoutBuffer = '';
      this.stdoutBufferBytes = 0;
      if (oversize) this.rejectOversize(oversize);
      else if (line && !this.acceptFrame(line)) return;
    }
  }

  /** Fail the one read an oversize frame answered; a notification is dropped. */
  private rejectOversize(frame: { head: string; tail: string }): void {
    const id = oversizeFrameId(frame);
    const pending = id === null ? undefined : this.pending.get(id);
    // No id, or nobody waiting: a notification this read-only adapter never
    // reads. An unattributable response times out like any lost reply.
    if (id === null || !pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(id);
    pending.reject(
      sessionDataError(
        `${pending.method} response exceeded Exawatt's 2 MiB read limit`
      )
    );
  }

  /** One complete frame. False when it broke the protocol and the connection. */
  private acceptFrame(line: string): boolean {
    let message: JsonObject | null = null;
    try {
      message = object(JSON.parse(line));
    } catch {
      // handled below
    }
    if (!message) {
      this.fail(binaryVerdict('app-server emitted invalid JSON'));
      return false;
    }
    const id = finiteNumber(message.id);
    if (id === undefined) return true; // notification; this adapter is read-only
    const pending = this.pending.get(id);
    if (!pending) return true;
    clearTimeout(pending.timer);
    this.pending.delete(id);
    const error = object(message.error);
    if (error) {
      pending.reject(
        new CodexProtocolReadError(
          pending.method,
          finiteNumber(error.code),
          typeof error.message === 'string'
            ? error.message
            : 'Codex app-server request failed'
        )
      );
    } else if ('result' in message) {
      pending.resolve(message.result);
    } else {
      pending.reject(binaryVerdict('JSON-RPC response has no result'));
    }
    return true;
  }

  private fail(error: Error): void {
    if (!this.process && !this.connected && this.pending.size === 0) return;
    const child = this.process;
    this.process = null;
    this.connected = false;
    this.stdoutBuffer = '';
    this.stdoutBufferBytes = 0;
    this.oversize = null;
    if (child && !child.killed) child.kill();
    this.rejectPending(error);
  }

  private rejectPending(error: Error): void {
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    this.pending.clear();
  }
}

interface ObservedChild {
  id: string;
  agentType: string;
  description: string | null;
  startedAt: number;
  live: boolean;
  completed: boolean;
}

interface ObservedRoot {
  threadId: string;
}

export interface CodexDelegationObserverOptions {
  clientFactory?: () => CodexDelegationProtocol;
  pollIntervalMs?: number;
  sink?: DelegationReportSink;
  autoPoll?: boolean;
  observations?: DelegationObservations;
  /** Where the login shell finds the binary; spawned once per verdict. */
  resolveBinary?: () => Promise<string | null>;
  /** The binary as it is on disk; a stat, checked on every poll. */
  fingerprintBinary?: (binaryPath: string) => string | null;
}

/**
 * A permanent verdict the observer holds instead of retrying.
 *
 * It is only ever about the BINARY ("this Codex cannot do X"), never about a
 * Session's data (BUG-183), because holding it stops every Session's reads.
 * Keyed to the binary that was judged, by path, on-disk fingerprint and the
 * version it reported, and to the set of Sessions it was judged over. The
 * verdict lifts when either changes: the binary was upgraded or replaced, or
 * a new Codex Session was launched, which is the operator's own moment to
 * have upgraded it. Nothing lifts it on a timer, because a timer is what it
 * replaces.
 */
interface CodexDelegationVerdict {
  error: Error;
  /** The provider's own `initialize` user agent, when it answered one. */
  version: string | null;
  binaryPath: string | null;
  fingerprint: string | null;
  recordedAt: number;
}

interface SessionManagerLike extends EventEmitter {
  list(): PtySessionInfo[];
}

function childDescription(thread: CodexChildThread): string | null {
  const leaf = thread.agentPath?.split('/').filter(Boolean).pop();
  if (leaf) return leaf.replace(/[_-]+/g, ' ');
  return thread.agentNickname;
}

function childAgentType(thread: CodexChildThread): string {
  return thread.agentRole?.trim() || 'Codex';
}

/** Bounded workers settle every started read before the next poll may begin. */
async function settleConcurrent<T, R>(
  values: readonly T[],
  concurrency: number,
  read: (value: T) => Promise<R>
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(values.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, async () => {
      for (;;) {
        const index = cursor++;
        if (index >= values.length) return;
        try {
          results[index] = {
            status: 'fulfilled',
            value: await read(values[index]),
          };
        } catch (reason) {
          results[index] = { status: 'rejected', reason };
        }
      }
    })
  );
  return results;
}

interface ObservedCensus {
  children: Map<string, ObservedChild>;
  observation: DelegationObservation;
}

/**
 * One shared observer for every Exawatt-owned Codex PTY. It polls only while a
 * correlated Codex Session is live, reuses one app-server process, and always
 * resnapshots descendants after reconnect.
 */
export class CodexDelegationObserver {
  private readonly roots = new Map<string, ObservedRoot>();
  private readonly clientFactory: () => CodexDelegationProtocol;
  private readonly pollIntervalMs: number;
  private readonly autoPoll: boolean;
  private readonly observations: DelegationObservations;
  private readonly resolveBinary: () => Promise<string | null>;
  private readonly fingerprintBinary: (binaryPath: string) => string | null;
  private client: CodexDelegationProtocol | null = null;
  private sink: DelegationReportSink | null = null;
  private timer: NodeJS.Timeout | null = null;
  private polling = false;
  private retryMs = 1_000;
  /**
   * The verdict being held, with the Session-set generation it was judged
   * over. A generation bump is a new Session or a dropped one; either is a
   * reason to look once more.
   */
  private held: { verdict: CodexDelegationVerdict; generation: number } | null =
    null;
  private rootsGeneration = 0;
  /**
   * Reads whose failure belongs to one Session's data, keyed by the read
   * (`lineage:<root>`, `activity:<parent>`), each on its own ladder (BUG-183).
   * A healthy read deletes its entry and the map empties with the last root,
   * so it holds at most one entry per failing read of a live Session.
   */
  private readonly unreadable = new Map<
    string,
    { retryAt: number; retryMs: number; error: Error }
  >();

  constructor(options: CodexDelegationObserverOptions = {}) {
    this.clientFactory =
      options.clientFactory ?? (() => new CodexAppServerClient());
    this.pollIntervalMs = options.pollIntervalMs ?? POLL_INTERVAL_MS;
    this.autoPoll = options.autoPoll ?? true;
    this.observations = options.observations ?? delegationObservations;
    this.sink = options.sink ?? null;
    this.resolveBinary = options.resolveBinary ?? resolveCodexBinary;
    this.fingerprintBinary = options.fingerprintBinary ?? fingerprintCodexBinary;
  }

  /** The permanent verdict this observer is holding, if any. */
  get verdict(): CodexDelegationVerdict | null {
    return this.held?.verdict ?? null;
  }

  attach(manager: SessionManagerLike, sink: DelegationReportSink): void {
    this.sink = sink;
    for (const session of manager.list()) this.observe(session);
    manager.on('session', (session: PtySessionInfo) => this.observe(session));
    manager.on(
      'identity',
      (id: string, _durableSessionId: string, harnessSessionId: string) => {
        const session = manager.list().find(candidate => candidate.id === id);
        if (session) this.observe({ ...session, harnessSessionId });
      }
    );
    manager.on('exit', (id: string) => this.drop(id));
  }

  observe(session: PtySessionInfo): void {
    if (
      session.harness !== 'codex' ||
      session.exited ||
      !session.harnessSessionId
    ) {
      return;
    }
    const existing = this.roots.get(session.id);
    if (existing?.threadId === session.harnessSessionId) return;
    if (existing) this.withdraw(session.id);
    this.observations.drop(session.id);
    this.roots.set(session.id, {
      threadId: session.harnessSessionId,
    });
    this.rootsGeneration += 1;
    if (this.autoPoll) this.schedule(0);
  }

  drop(sessionId: string): void {
    if (this.roots.delete(sessionId)) this.rootsGeneration += 1;
    this.observations.drop(sessionId);
    if (this.roots.size === 0) {
      if (this.timer) clearTimeout(this.timer);
      this.timer = null;
      this.client?.close();
      this.client = null;
      this.unreadable.clear();
    }
  }

  /** Exposed for deterministic tests and the protocol evaluator. */
  async pollNow(): Promise<void> {
    if (this.polling || this.roots.size === 0) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.holdsVerdict()) {
      // Nothing is spawned while a verdict stands. The re-check above was a
      // stat; the next one is scheduled at the ladder's ceiling, so a held
      // verdict costs one stat every thirty seconds and no process.
      if (this.autoPoll) this.schedule(MAX_BACKOFF_MS);
      return;
    }
    this.polling = true;
    const client = this.client ?? this.clientFactory();
    this.client = client;
    const roots = [...this.roots.entries()];
    // Three kinds of failure, three scopes (BUG-183). A verdict about the
    // binary stops every Session; a failure of one Session's data withdraws
    // that Session alone and leaves the connection up; anything else is the
    // attempt failing, which closes the connection and rides the ladder.
    let failed = false;
    let verdict: Error | null = null;
    try {
      await client.connect();
      const snapshots = await settleConcurrent(
        roots,
        MAX_ROOT_READS,
        ([, root]) => this.snapshot(client, root)
      );
      if (this.client !== client) return;
      for (let index = 0; index < roots.length; index += 1) {
        const [sessionId, root] = roots[index];
        // Identity can change while reads are in flight, including A → B → A.
        // Object identity represents the observation generation, not its name.
        if (this.roots.get(sessionId) !== root) continue;
        const snapshot = snapshots[index];
        if (snapshot.status === 'fulfilled') {
          this.publish(sessionId, snapshot.value.children);
          this.observations.report(
            'codex',
            sessionId,
            snapshot.value.observation
          );
        } else if (isPermanentVerdict(snapshot.reason)) {
          verdict = snapshot.reason;
        } else {
          this.withdraw(sessionId, snapshot.reason, client.version);
          if (!isSessionDataError(snapshot.reason)) failed = true;
        }
      }
    } catch (error) {
      if (this.client !== client) return;
      if (isPermanentVerdict(error)) {
        verdict = error;
      } else {
        failed = true;
        for (const [sessionId, root] of roots) {
          if (this.roots.get(sessionId) === root)
            this.withdraw(sessionId, error, client.version);
        }
      }
    } finally {
      this.polling = false;
      if (verdict !== null && this.client === client) {
        // A verdict about the binary is about every Session it serves, so
        // every one is withdrawn, not only the Session whose read met it:
        // none may keep a census painted from before the verdict.
        for (const sessionId of this.roots.keys()) {
          this.withdraw(sessionId, verdict, client.version);
        }
        failed = true;
      }
      if (this.client === client && failed) {
        client.close();
        this.client = null;
      }
      if (verdict !== null) this.remember(verdict, client);
      if (this.autoPoll) {
        this.schedule(
          verdict !== null
            ? MAX_BACKOFF_MS
            : failed
              ? this.retryMs
              : this.pollIntervalMs
        );
      }
      this.retryMs =
        failed && verdict === null
          ? Math.min(MAX_BACKOFF_MS, this.retryMs * 2)
          : 1_000;
    }
  }

  /**
   * One read whose failure can belong to a Session's data. While its ladder
   * runs, the read is not sent and its last data error answers instead, so a
   * page that is over Exawatt's limit is not re-read every poll; the first
   * read that succeeds clears it.
   */
  private async dataRead<T>(key: string, read: () => Promise<T>): Promise<T> {
    const backoff = this.unreadable.get(key);
    if (backoff && backoff.retryAt > Date.now()) throw backoff.error;
    try {
      const value = await read();
      this.unreadable.delete(key);
      return value;
    } catch (error) {
      if (isSessionDataError(error)) {
        const retryMs = backoff
          ? Math.min(MAX_BACKOFF_MS, backoff.retryMs * 2)
          : 1_000;
        this.unreadable.set(key, {
          retryAt: Date.now() + retryMs,
          retryMs,
          error,
        });
      }
      throw error;
    }
  }

  /**
   * Hold a permanent verdict instead of retrying it.
   *
   * Recorded synchronously, so a poll that starts before the binary is
   * resolved already sees it held; the binary path and fingerprint arrive
   * afterwards from the one shell spawn this costs, and only if this verdict
   * is still the one being held.
   */
  private remember(error: Error, client: CodexDelegationProtocol): void {
    const verdict: CodexDelegationVerdict = {
      error,
      version: client.version ?? null,
      binaryPath: null,
      fingerprint: null,
      recordedAt: Date.now(),
    };
    this.held = { verdict, generation: this.rootsGeneration };
    console.warn(
      `[codex-delegation] holding a permanent verdict, no retry until the binary or the Session set changes: ${error.message}` +
        (verdict.version ? ` (${verdict.version})` : '')
    );
    this.resolveBinary()
      .then(binaryPath => {
        if (this.held?.verdict !== verdict || binaryPath === null) return;
        verdict.binaryPath = binaryPath;
        verdict.fingerprint = this.fingerprintBinary(binaryPath);
      })
      .catch(() => {
        // Unresolved is allowed: the verdict then lifts on a Session change.
      });
  }

  /**
   * Whether the held verdict still applies. It lifts when the Session set
   * changed since it was judged or when the binary on disk is no longer the
   * one it was judged against; both are re-checked here, at no more than the
   * cost of one stat.
   */
  private holdsVerdict(): boolean {
    const held = this.held;
    if (held === null) return false;
    if (held.generation !== this.rootsGeneration) {
      this.held = null;
      return false;
    }
    const { binaryPath, fingerprint } = held.verdict;
    if (
      binaryPath !== null &&
      this.fingerprintBinary(binaryPath) !== fingerprint
    ) {
      this.held = null;
      return false;
    }
    return true;
  }

  private async snapshot(
    client: CodexDelegationProtocol,
    root: ObservedRoot
  ): Promise<ObservedCensus> {
    // Failure of lineage invalidates the root. Lifecycle reads only invalidate
    // their child (or the ambiguous siblings sharing one parent activity read).
    const descendants = await this.dataRead(`lineage:${root.threadId}`, () =>
      client.listDescendants(root.threadId)
    );
    const children = new Map<string, ObservedChild>();
    const unresolved: { thread: CodexChildThread; observed: ObservedChild }[] =
      [];
    const failures: DelegationObservation['reason'][] = [];
    const turns = await settleConcurrent(descendants, MAX_CHILD_READS, thread =>
      client.latestTurn(thread.id)
    );
    for (let index = 0; index < descendants.length; index += 1) {
      const thread = descendants[index];
      const result = turns[index];
      if (result.status === 'rejected') {
        failures.push(observationFailure(result.reason));
        continue;
      }
      const turn = result.value;
      const observed: ObservedChild = {
        id: thread.id,
        agentType: childAgentType(thread),
        description: childDescription(thread),
        startedAt: thread.createdAt * 1_000,
        live: turn?.status === 'inProgress',
        completed: turn?.status === 'completed',
      };
      if (
        turn === null ||
        (turn.status === 'interrupted' && turn.completedAt === null)
      ) {
        unresolved.push({ thread, observed });
      } else children.set(thread.id, observed);
    }

    // TUI-owned turns can look interrupted/null. Only the immediate parent's
    // source-owned activity can disambiguate; a missing activity is NOT idle.
    const byParent = new Map<string, typeof unresolved>();
    for (const item of unresolved) {
      const siblings = byParent.get(item.thread.parentThreadId) ?? [];
      siblings.push(item);
      byParent.set(item.thread.parentThreadId, siblings);
    }
    const parents = [...byParent];
    const activities = await settleConcurrent(
      parents,
      MAX_CHILD_READS,
      ([parent, items]) =>
        this.dataRead(`activity:${parent}`, () =>
          client.latestSubagentActivity(
            parent,
            items.map(item => item.thread.id)
          )
        )
    );
    for (let index = 0; index < parents.length; index += 1) {
      const result = activities[index];
      if (result.status === 'rejected') {
        failures.push(observationFailure(result.reason));
        continue;
      }
      for (const { thread, observed } of parents[index][1]) {
        const kind = result.value.get(thread.id);
        if (!kind) {
          failures.push('read-failed');
          continue;
        }
        observed.live = kind === 'started' || kind === 'interacted';
        children.set(thread.id, observed);
      }
    }
    return {
      children,
      observation: {
        state: failures.length
          ? children.size
            ? 'partial'
            : 'unavailable'
          : 'complete',
        reason: failures.includes('unsupported')
          ? 'unsupported'
          : failures.includes('unreadable')
            ? 'unreadable'
            : failures.length
              ? 'read-failed'
              : null,
        version: client.version ?? null,
        observedAt: Date.now(),
      },
    };
  }

  private publish(
    sessionId: string,
    nextChildren: Map<string, ObservedChild>
  ): void {
    const root = this.roots.get(sessionId);
    const sink = this.sink;
    if (!root || !sink) return;
    const afterLive = [...nextChildren.values()]
      .filter(child => child.live)
      .sort(
        (left, right) =>
          left.startedAt - right.startedAt || left.id.localeCompare(right.id)
      );
    sink.reconcileReportedChildren(
      sessionId,
      afterLive.map(({ id, agentType, description, startedAt }) => ({
        id,
        agentType,
        description,
        startedAt,
      })),
      [...nextChildren.values()]
        .filter(child => child.completed)
        .map(child => child.id)
    );
  }

  private withdraw(
    sessionId: string,
    error?: unknown,
    version?: string | null
  ): void {
    this.sink?.clearReportedChildren(sessionId);
    if (error !== undefined)
      this.observations.report('codex', sessionId, {
        state: 'unavailable',
        reason: observationFailure(error),
        version: version ?? null,
        observedAt: Date.now(),
      });
  }

  private schedule(delay: number): void {
    if (this.roots.size === 0 || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.pollNow();
    }, delay);
    this.timer.unref?.();
  }
}

export const codexDelegationObserver = new CodexDelegationObserver();
