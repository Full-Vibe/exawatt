/**
 * Codex app-server read adapter (ENG-023 D5).
 *
 * The interactive Codex TUI remains the owner of the Agent Session. This
 * adapter starts a separate, read-side app-server and asks the Codex-owned
 * protocol for thread lineage and lifecycle. It never reads rollout files,
 * process trees, worktrees, or terminal text.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { EventEmitter } from 'events';
import * as os from 'os';
import * as path from 'path';
import { defaultShell, type PtySessionInfo } from '../pty/session-manager';
import { planLoginShell, shellQuote } from '../pty/login-shell';
import type { DelegationReportSink } from './delegation-monitor';

const MINIMUM_PROTOCOL_VERSION = [0, 147, 0] as const;
const MAX_FRAME_BYTES = 2 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 4_000;
const POLL_INTERVAL_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;
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

function protocolError(message: string): Error {
  return new Error(`Codex delegation protocol incompatible: ${message}`);
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
    throw protocolError('thread/list response has no data array');
  }
  const nextCursor = nullableString(page.nextCursor);
  if (nextCursor === undefined) {
    throw protocolError('thread/list response has an invalid cursor');
  }
  const data = page.data.map((candidate, index) => {
    const thread = object(candidate);
    if (!thread)
      throw protocolError(`thread/list row ${index} is not an object`);
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
      throw protocolError(
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
    throw protocolError('thread/turns/list response has no data array');
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
    throw protocolError('thread/turns/list returned an invalid latest turn');
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
    throw protocolError('thread/items/list response has no data array');
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
      throw protocolError('subAgentActivity item has an invalid shape');
    }
    if (!latest.has(childId)) latest.set(childId, kind);
  }
  return latest;
}

/** JSON-RPC client for the installed Codex app-server. */
export class CodexAppServerClient implements CodexDelegationProtocol {
  private process: ChildProcessWithoutNullStreams | null = null;
  private nextRequestId = 1;
  private pending = new Map<number, PendingRequest>();
  private stdoutBuffer = '';
  private stderrTail = '';
  private connected = false;

  async connect(): Promise<void> {
    if (this.connected && this.process) return;
    const shell = await defaultShell();
    const plan = planLoginShell(shell, {
      command: `${codexInvocation()} app-server --stdio`,
      directory: os.homedir(),
    });
    const child = spawn(shell, plan.args, {
      cwd: plan.cwd,
      env: { ...process.env, SHELL: shell },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.process = child;
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => this.acceptOutput(String(chunk)));
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', chunk => {
      this.stderrTail = `${this.stderrTail}${String(chunk)}`.slice(-4_096);
    });
    child.on('error', error => this.fail(error));
    child.on('exit', (code, signal) => {
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
      if (!version || !codexProtocolVersionSupported(version)) {
        throw protocolError('installed app-server is older than 0.147.0');
      }
      this.notify('initialized', {});
      this.connected = true;
    } catch (error) {
      this.close();
      throw error;
    }
  }

  close(): void {
    const child = this.process;
    this.process = null;
    this.connected = false;
    this.stdoutBuffer = '';
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
    throw protocolError('thread/list exceeded the bounded descendant pages');
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
        throw protocolError('thread/items/list response has an invalid cursor');
      }
      cursor = nextCursor;
      if (!cursor) return latest;
    }
    throw protocolError(
      'thread/items/list exceeded the bounded activity pages'
    );
  }

  private request(method: string, params: JsonObject): Promise<unknown> {
    const id = this.nextRequestId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex app-server request timed out: ${method}`));
      }, REQUEST_TIMEOUT_MS);
      timer.unref?.();
      this.pending.set(id, { resolve, reject, timer });
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

  private acceptOutput(chunk: string): void {
    this.stdoutBuffer += chunk;
    if (Buffer.byteLength(this.stdoutBuffer) > MAX_FRAME_BYTES) {
      this.fail(protocolError('app-server frame exceeded 2 MiB'));
      return;
    }
    for (;;) {
      const newline = this.stdoutBuffer.indexOf('\n');
      if (newline < 0) return;
      const line = this.stdoutBuffer.slice(0, newline).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1);
      if (!line) continue;
      let message: JsonObject | null = null;
      try {
        message = object(JSON.parse(line));
      } catch {
        // handled below
      }
      if (!message) {
        this.fail(protocolError('app-server emitted invalid JSON'));
        return;
      }
      const id = finiteNumber(message.id);
      if (id === undefined) continue; // notification; this adapter is read-only
      const pending = this.pending.get(id);
      if (!pending) continue;
      clearTimeout(pending.timer);
      this.pending.delete(id);
      const error = object(message.error);
      if (error) {
        pending.reject(
          new Error(
            typeof error.message === 'string'
              ? error.message
              : 'Codex app-server request failed'
          )
        );
      } else if ('result' in message) {
        pending.resolve(message.result);
      } else {
        pending.reject(protocolError('JSON-RPC response has no result'));
      }
    }
  }

  private fail(error: Error): void {
    if (!this.process && !this.connected && this.pending.size === 0) return;
    const child = this.process;
    this.process = null;
    this.connected = false;
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
  updatedAt: number;
  live: boolean;
}

interface ObservedRoot {
  threadId: string;
  children: Map<string, ObservedChild>;
}

export interface CodexDelegationObserverOptions {
  clientFactory?: () => CodexDelegationProtocol;
  pollIntervalMs?: number;
  sink?: DelegationReportSink;
  autoPoll?: boolean;
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
  private client: CodexDelegationProtocol | null = null;
  private sink: DelegationReportSink | null = null;
  private timer: NodeJS.Timeout | null = null;
  private polling = false;
  private retryMs = 1_000;

  constructor(options: CodexDelegationObserverOptions = {}) {
    this.clientFactory =
      options.clientFactory ?? (() => new CodexAppServerClient());
    this.pollIntervalMs = options.pollIntervalMs ?? POLL_INTERVAL_MS;
    this.autoPoll = options.autoPoll ?? true;
    this.sink = options.sink ?? null;
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
    this.roots.set(session.id, {
      threadId: session.harnessSessionId,
      children: new Map(),
    });
    if (this.autoPoll) this.schedule(0);
  }

  drop(sessionId: string): void {
    this.roots.delete(sessionId);
    if (this.roots.size === 0) {
      if (this.timer) clearTimeout(this.timer);
      this.timer = null;
      this.client?.close();
      this.client = null;
    }
  }

  /** Exposed for deterministic tests and the protocol evaluator. */
  async pollNow(): Promise<void> {
    if (this.polling || this.roots.size === 0) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.polling = true;
    try {
      const client = this.client ?? this.clientFactory();
      this.client = client;
      await client.connect();
      const roots = [...this.roots.entries()];
      const snapshots = await Promise.all(
        roots.map(
          async ([sessionId, root]) =>
            [
              sessionId,
              root.threadId,
              await this.snapshot(client, root),
            ] as const
        )
      );
      for (const [sessionId, threadId, children] of snapshots) {
        if (this.roots.get(sessionId)?.threadId === threadId) {
          this.publish(sessionId, children);
        }
      }
      this.retryMs = 1_000;
      if (this.autoPoll) this.schedule(this.pollIntervalMs);
    } catch {
      // Unsupported, unavailable, timed out, or malformed all mean ABSENT.
      // The terminal remains wholly usable and the adapter retries in backoff.
      this.withdrawAll();
      this.client?.close();
      this.client = null;
      if (this.autoPoll) this.schedule(this.retryMs);
      this.retryMs = Math.min(MAX_BACKOFF_MS, this.retryMs * 2);
    } finally {
      this.polling = false;
    }
  }

  private async snapshot(
    client: CodexDelegationProtocol,
    root: ObservedRoot
  ): Promise<Map<string, ObservedChild>> {
    const descendants = await client.listDescendants(root.threadId);
    const children = new Map<string, ObservedChild>();
    const unresolved = (
      await Promise.all(
        descendants.map(async thread => {
          const previous = root.children.get(thread.id);
          if (
            previous &&
            !previous.live &&
            previous.updatedAt === thread.updatedAt
          ) {
            children.set(thread.id, previous);
            return null;
          }
          const turn = await client.latestTurn(thread.id);
          const observed: ObservedChild = {
            id: thread.id,
            agentType: childAgentType(thread),
            description: childDescription(thread),
            startedAt: thread.createdAt * 1_000,
            updatedAt: thread.updatedAt,
            live: turn?.status === 'inProgress',
          };
          children.set(thread.id, observed);
          const ambiguous =
            turn === null ||
            (turn.status === 'interrupted' && turn.completedAt === null);
          return ambiguous ? { thread, observed } : null;
        })
      )
    ).filter(
      (item): item is { thread: CodexChildThread; observed: ObservedChild } =>
        item !== null
    );

    // A second read-side app-server reports turns owned by the interactive
    // TUI as interrupted/null while they are still running. The immediate
    // parent's source-owned activity disambiguates that state exactly.
    const unresolvedByParent = new Map<string, typeof unresolved>();
    for (const item of unresolved) {
      const siblings = unresolvedByParent.get(item.thread.parentThreadId) ?? [];
      siblings.push(item);
      unresolvedByParent.set(item.thread.parentThreadId, siblings);
    }
    await Promise.all(
      [...unresolvedByParent].map(async ([parentThreadId, items]) => {
        const activity = await client.latestSubagentActivity(
          parentThreadId,
          items.map(item => item.thread.id)
        );
        for (const item of items) {
          const kind = activity.get(item.thread.id);
          item.observed.live = kind === 'started' || kind === 'interacted';
        }
      })
    );
    return children;
  }

  private publish(
    sessionId: string,
    nextChildren: Map<string, ObservedChild>
  ): void {
    const root = this.roots.get(sessionId);
    const sink = this.sink;
    if (!root || !sink) return;
    const beforeLive = new Map(
      [...root.children].filter(([, child]) => child.live)
    );
    const afterLive = [...nextChildren.values()]
      .filter(child => child.live)
      .sort(
        (left, right) =>
          left.startedAt - right.startedAt || left.id.localeCompare(right.id)
      );
    const afterIds = new Set(afterLive.map(child => child.id));
    for (const childId of beforeLive.keys()) {
      if (!afterIds.has(childId)) {
        sink.report(sessionId, { kind: 'child-end', childId });
      }
    }
    for (const child of afterLive) {
      if (!beforeLive.has(child.id)) {
        sink.report(sessionId, {
          kind: 'child-start',
          childId: child.id,
          agentType: child.agentType,
          description: child.description,
          at: child.startedAt,
        });
      }
    }
    root.children = nextChildren;
  }

  private withdraw(sessionId: string): void {
    this.sink?.clearReportedChildren(sessionId);
    const root = this.roots.get(sessionId);
    if (root) root.children = new Map();
  }

  private withdrawAll(): void {
    for (const sessionId of this.roots.keys()) this.withdraw(sessionId);
  }

  private schedule(delay: number): void {
    if (this.roots.size === 0 || this.timer) return;
    this.timer = setTimeout(() => void this.pollNow(), delay);
    this.timer.unref?.();
  }
}

export const codexDelegationObserver = new CodexDelegationObserver();
