/**
 * LocalSessionsTransport — Fleet truth from the Agent Terminal Workspace
 * (ENG-002 W0.3): live PTY sessions (Claude Code / Codex / shells) become
 * ExawattAgents in the SAME FleetState the DOM board and the spatial map
 * consume.
 *
 * Source-agnostic per the ENG-003 boundary: the transport is written against
 * a minimal injected LocalSessionsSource (structurally satisfied by the
 * Electron preload PTY API) — core never touches Electron types.
 *
 * Status model:
 *   exited        -> 'complete' (code 0) or 'error'
 *   alive, explicit bell / human gate -> 'blocked'
 *   alive, delegated children outstanding -> 'working' (ENG-023: a Session
 *     whose team is running never reads as finished at fleet altitude)
 *   alive, source-reported working / settled -> 'working' / 'complete'
 *   alive, quiet turn boundary -> 'complete' (result ready)
 *   alive, output within workingWindowMs -> 'working'
 *   alive, quiet  -> 'idle'
 * The attention flag comes from the source (main-process bell/turn-boundary
 * detection) — the fleet surfaces show the SAME result-vs-needs-you truth the
 * tab strip does. Quiet completion is not promoted into the blocker queue.
 */
import type {
  AgentBlocker,
  AgentDelegation,
  AgentStatus,
  ExawattAgent,
} from '../types/index';
import { INITIAL_AGENT_METRICS } from '../types/index';
import type { FleetManager } from '../state/fleet-manager';

export interface LocalSessionAttention {
  kind: string;
  since: number;
}

export interface LocalSessionSnapshot {
  id: string;
  harness: string;
  title: string;
  cwd: string;
  projectDir: string;
  projectName: string;
  startedAt: number;
  exited: boolean;
  exitCode: number | null;
  /** tab/durable reference used when no current PTY id exists */
  sessionKey?: string;
  /** explicit because a cleanly stopped tab can have no exit code */
  sessionState?: 'live' | 'stopped';
  /** auto-summarized micro-context (W0.4) — becomes the agent's goal */
  contextSummary?: string | null;
  /** needs-operator flag (ENG-015 S1) — becomes 'blocked' + blockerInfo */
  attention?: LocalSessionAttention | null;
  /** harness-reported delegated children (ENG-023) — absent when the source
   *  does not report delegation, never an empty stand-in for zero */
  delegation?:
    | (AgentDelegation & {
        ownTurn?: 'generating' | 'available';
        blockedOn?: string | null;
      })
    | null;
  /** Main/source-owned activity truth. Undefined preserves compatibility
   *  with sources that only expose byte activity. */
  working?: boolean;
  /** Whether an Agent Session has ever been given work. Shells do not have
   *  turns; undefined preserves the legacy byte-inference posture. */
  engaged?: boolean;
  /**
   * Measured consumption for this Session over the live corpus window
   * (ENG-008 E5), joined by the caller from the local consumption read.
   * Undefined = the Session reports no usage — absent, never zero, so the
   * burn lens leaves it out of the ramp exactly like the Demo transport's
   * unreporting Agents.
   */
  rawTokens?: number;
  normalizedTokens?: number;
}

export interface LocalSessionsSource {
  list(): Promise<LocalSessionSnapshot[]>;
  /** fires on session output — the activity signal */
  onData(handler: (payload: { id: string }) => void): () => void;
  onExit(
    handler: (payload: { id: string; exitCode: number }) => void
  ): () => void;
}

export interface LocalSessionsOptions {
  /** re-list/reconcile cadence (new sessions, closed tabs, status decay) */
  pollMs?: number;
  /** output within this window = 'working' */
  workingWindowMs?: number;
  /** max one activity-driven upsert per session per this window */
  activityFlushMs?: number;
  /** injectable clock for tests */
  now?: () => number;
}

const DEFAULTS = {
  pollMs: 5000,
  workingWindowMs: 15000,
  activityFlushMs: 1000,
};

function basename(p: string): string {
  const parts = p.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? p;
}

export function sessionStatus(
  session: Pick<
    LocalSessionSnapshot,
    'exited' | 'exitCode' | 'attention' | 'delegation' | 'working' | 'engaged'
  > &
    Partial<Pick<LocalSessionSnapshot, 'harness'>>,
  lastActivityAt: number,
  now: number,
  workingWindowMs: number
): AgentStatus {
  if (session.exited)
    return session.exitCode == null || session.exitCode === 0
      ? 'complete'
      : 'error';
  // An operator gate outranks delegated work (same precedence as the tab
  // strip); running children outrank quiet bytes AND a stale turn boundary —
  // a Session whose team is working never reads as finished (ENG-023).
  if (session.attention && session.attention.kind !== 'turn-end')
    return 'blocked';
  if (session.delegation?.blockedOn) return 'blocked';
  if ((session.delegation?.children.length ?? 0) > 0) return 'working';
  if (session.delegation?.ownTurn === 'generating') return 'working';
  if (session.delegation?.ownTurn === 'available') return 'complete';
  if (session.working !== undefined) {
    if (session.working) return 'working';
    return session.harness !== 'shell' && session.engaged ? 'complete' : 'idle';
  }
  if (session.attention?.kind === 'turn-end') return 'complete';
  return now - lastActivityAt <= workingWindowMs ? 'working' : 'idle';
}

function sessionBlocker(
  session: LocalSessionSnapshot
): AgentBlocker | undefined {
  if (
    session.exited ||
    !session.attention ||
    session.attention.kind === 'turn-end'
  )
    return undefined;
  return {
    type: 'input_needed',
    title: 'Session rang the bell',
    description: `${session.title} in ${basename(session.cwd)} needs the operator.`,
    createdAt: session.attention.since,
  };
}

export function sessionToAgent(
  session: LocalSessionSnapshot,
  lastActivityAt: number,
  now: number,
  workingWindowMs: number
): ExawattAgent {
  return {
    id: session.id,
    name: `${basename(session.cwd)} · ${session.title}`,
    status: sessionStatus(session, lastActivityAt, now, workingWindowMs),
    goal:
      session.contextSummary?.trim() ||
      `Interactive ${session.title} session in ${session.cwd}`,
    projectId: session.projectDir,
    project: session.projectName,
    sessionKey: session.sessionKey ?? session.id,
    sessionState: session.sessionState ?? (session.exited ? 'stopped' : 'live'),
    // Live measured burn (ENG-008 E5) rides the same optional AgentMetrics
    // fields the Demo transport fills from demoAgentBurn — the burn lens and
    // Team tiles read one seam. Absent stays absent.
    metrics: {
      ...INITIAL_AGENT_METRICS,
      ...(session.rawTokens !== undefined
        ? { rawTokens: session.rawTokens }
        : {}),
      ...(session.normalizedTokens !== undefined
        ? { normalizedTokens: session.normalizedTokens }
        : {}),
    },
    lastActivityAt,
    blockerInfo: sessionBlocker(session),
    // Present only while children are live: presence IS the signal, so an
    // unreporting source and an empty team read identically as absent. Turn
    // truth is consumed above to keep Fleet and terminal tabs in lockstep,
    // but is not widened into the source-agnostic Agent contract.
    ...(session.delegation?.children.length
      ? { delegation: { children: session.delegation.children } }
      : {}),
    createdAt: session.startedAt,
  };
}

export class LocalSessionsTransport {
  private manager: FleetManager | null = null;
  private readonly opts: Required<Omit<LocalSessionsOptions, 'now'>>;
  private readonly now: () => number;
  private known = new Map<string, LocalSessionSnapshot>();
  private lastActivity = new Map<string, number>();
  /** last emitted (status + activity) per session — skip no-op upserts */
  private emitted = new Map<string, string>();
  private pendingActivity = new Set<string>();
  private unsubs: Array<() => void> = [];
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private syncSequence = 0;

  constructor(
    private readonly source: LocalSessionsSource,
    options: LocalSessionsOptions = {}
  ) {
    this.opts = {
      pollMs: options.pollMs ?? DEFAULTS.pollMs,
      workingWindowMs: options.workingWindowMs ?? DEFAULTS.workingWindowMs,
      activityFlushMs: options.activityFlushMs ?? DEFAULTS.activityFlushMs,
    };
    this.now = options.now ?? (() => Date.now());
  }

  initialize(manager: FleetManager): void {
    this.manager = manager;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    void this.sync();
    this.unsubs.push(this.source.onData(({ id }) => this.onActivity(id)));
    // exits re-list immediately so 'complete'/'error' lands without waiting
    // for the next poll
    this.unsubs.push(this.source.onExit(() => void this.sync()));
    this.pollTimer = setInterval(() => void this.sync(), this.opts.pollMs);
  }

  /** Reconcile immediately after authoritative workspace metadata changes. */
  refresh(): Promise<void> {
    return this.sync();
  }

  stop(): void {
    this.running = false;
    for (const off of this.unsubs.splice(0)) off();
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = null;
  }

  private onActivity(id: string): void {
    this.lastActivity.set(id, this.now());
    if (!this.known.has(id)) {
      // a session we haven't listed yet (fresh ignite) — reconcile now
      void this.sync();
      return;
    }
    // output arrives in bursts (60+/s) — coalesce to one upsert per window
    this.pendingActivity.add(id);
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => {
        this.flushTimer = null;
        for (const pid of this.pendingActivity) {
          const s = this.known.get(pid);
          if (s) this.upsert(s);
        }
        this.pendingActivity.clear();
      }, this.opts.activityFlushMs);
    }
  }

  private async sync(): Promise<void> {
    if (!this.running) return;
    const sequence = ++this.syncSequence;
    const list = await this.source.list();
    if (!this.running || sequence !== this.syncSequence) return;
    const seen = new Set<string>();
    for (const s of list) {
      seen.add(s.id);
      if (!this.lastActivity.has(s.id))
        this.lastActivity.set(s.id, s.startedAt);
      this.known.set(s.id, s);
      this.upsert(s);
    }
    // closed tabs leave the fleet
    for (const id of Array.from(this.known.keys())) {
      if (!seen.has(id)) {
        this.known.delete(id);
        this.lastActivity.delete(id);
        this.emitted.delete(id);
        this.manager?.removeAgent(id);
      }
    }
  }

  private upsert(session: LocalSessionSnapshot): void {
    if (!this.manager) return;
    const activityAt = this.lastActivity.get(session.id) ?? session.startedAt;
    const agent = sessionToAgent(
      session,
      activityAt,
      this.now(),
      this.opts.workingWindowMs
    );
    // Delegation participates by child identity + kind + label, so a child
    // arriving, finishing, resolving its type, or gaining its spawn label
    // re-emits without churning on every poll tick. Unit separators, not
    // punctuation: description is free text and must not alias the key.
    const delegationKey = (agent.delegation?.children ?? [])
      .map(
        child =>
          `${child.id}\u001f${child.agentType ?? ''}\u001f${child.description ?? ''}`
      )
      .join('\u001e');
    const key = `${agent.status}:${agent.sessionState}:${agent.lastActivityAt}:${agent.name}:${agent.goal}:${agent.projectId ?? ''}:${agent.project}:${session.attention?.kind ?? ''}:${session.attention?.since ?? ''}:${delegationKey}`;
    if (this.emitted.get(session.id) === key) return; // nothing changed
    this.emitted.set(session.id, key);
    this.manager.upsertAgent(agent);
  }
}
