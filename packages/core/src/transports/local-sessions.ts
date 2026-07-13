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
 *   alive, needs-operator flag (ENG-015 S1 attention) -> 'blocked'
 *   alive, output within workingWindowMs -> 'working'
 *   alive, quiet  -> 'idle'
 * The attention flag comes from the source (main-process bell/turn-boundary
 * detection) — the fleet surfaces show the SAME "needs you" truth the tab
 * strip does. This closes the W0.3 honesty note (no more guessing: quiet-
 * but-waiting sessions read 'blocked' only when the detector says so).
 */
import type { ExawattAgent, AgentStatus, AgentBlocker } from '../types/index';
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
  session: Pick<LocalSessionSnapshot, 'exited' | 'exitCode' | 'attention'>,
  lastActivityAt: number,
  now: number,
  workingWindowMs: number
): AgentStatus {
  if (session.exited)
    return session.exitCode == null || session.exitCode === 0
      ? 'complete'
      : 'error';
  if (session.attention) return 'blocked';
  return now - lastActivityAt <= workingWindowMs ? 'working' : 'idle';
}

function sessionBlocker(
  session: LocalSessionSnapshot
): AgentBlocker | undefined {
  if (session.exited || !session.attention) return undefined;
  return {
    type: 'input_needed',
    title:
      session.attention.kind === 'bell'
        ? 'Session rang the bell'
        : 'Turn ended — waiting on you',
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
    project: session.projectName,
    sessionKey: session.sessionKey ?? session.id,
    sessionState: session.sessionState ?? (session.exited ? 'stopped' : 'live'),
    metrics: { ...INITIAL_AGENT_METRICS },
    lastActivityAt,
    blockerInfo: sessionBlocker(session),
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
    const list = await this.source.list();
    if (!this.running) return;
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
    const key = `${agent.status}:${agent.sessionState}:${agent.lastActivityAt}:${agent.name}:${agent.goal}:${session.attention?.since ?? ''}`;
    if (this.emitted.get(session.id) === key) return; // nothing changed
    this.emitted.set(session.id, key);
    this.manager.upsertAgent(agent);
  }
}
