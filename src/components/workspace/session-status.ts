/**
 * Shared live-Session turn state (ENG-016 D22/D29).
 *
 * Keep this module render-free: the strip, Sessions overview, and command
 * switcher all consume the same derivation and language, while their visual
 * components remain free to choose the appropriate footprint.
 */
export type SessionGlyphState =
  | 'working'
  | 'blocked'
  | 'done'
  | 'fresh'
  | 'quiet';

export interface SessionAttentionSignal {
  kind?: 'bell' | 'turn-end' | 'roadmap-blocked' | 'blocked';
  since: number;
}

/** Turn completion is a ready result, not an operator gate. Presence-only
 *  legacy signals remain conservative needs-you state. Every consumer that
 *  exposes or navigates attention must use this same predicate. */
export function attentionNeedsOperator(
  attention?: Pick<SessionAttentionSignal, 'kind'> | null
): boolean {
  return Boolean(attention && attention.kind !== 'turn-end');
}

/**
 * Attention sources are independent facts, not last-writer-wins state. A
 * harness result can arrive while the same Session remains roadmap-blocked;
 * in that collision the operator gate must stay visible. Within the winning
 * class, retain the oldest signal so the jump queue remains stable.
 */
export function mergeSessionAttentionSignals(
  ...signals: Array<SessionAttentionSignal | null | undefined>
): SessionAttentionSignal | undefined {
  const present = signals.filter(
    (signal): signal is SessionAttentionSignal =>
      signal !== null && signal !== undefined
  );
  if (present.length === 0) return undefined;
  const operatorGates = present.filter(attentionNeedsOperator);
  const candidates = operatorGates.length > 0 ? operatorGates : present;
  return candidates.reduce((oldest, signal) =>
    signal.since < oldest.since ? signal : oldest
  );
}

/** Compose independent attention producers by Session identity. Keeping this
 * next to signal precedence prevents render and navigation surfaces from
 * accidentally reintroducing object-spread/last-writer semantics. */
export function mergeSessionAttentionMaps(
  ...sources: Array<Readonly<Record<string, SessionAttentionSignal>>>
): Record<string, SessionAttentionSignal> {
  const sessionIds = new Set(sources.flatMap(source => Object.keys(source)));
  const merged: Record<string, SessionAttentionSignal> = {};
  for (const sessionId of sessionIds) {
    const signal = mergeSessionAttentionSignals(
      ...sources.map(source => source[sessionId])
    );
    if (signal) merged[sessionId] = signal;
  }
  return merged;
}

/**
 * The MARKER is the contract (ENG-016 D51, BUG-009).
 *
 * A Session is a ⌘J target exactly when a surface paints it amber. That
 * sounds tautological and was not: the strip painted from `tabIsLive(tab)`
 * while the jump queue filtered on `tab.exitCode === null`, two different
 * predicates over two different fields. One reconciliation branch sets both
 * `resumeState: 'live'` and a non-null `exitCode` for a session that exited
 * while adopted, so that tab showed an amber marker the jump could never
 * reach — the operator's report: "I see an orange needs-attention tab but
 * cmd+j doesn't jump to it, it does nothing."
 *
 * Both directions were wrong. The mirror case — `exitCode === null` on a
 * restored-but-not-live tab — would have let ⌘J navigate to a Session with
 * no visible marker, which is the surprise-navigation the queue's own
 * comment forbids.
 *
 * So eligibility lives here, next to the predicate it depends on, and every
 * surface that paints or navigates attention calls it rather than restating
 * it. `live` is the caller's `tabIsLive(tab)`; keeping it a plain boolean is
 * what lets this module stay render-free and free of workspace types.
 */
export interface AttentionCandidate {
  sessionId: string | null;
  live: boolean;
}

export function paintsAttention(
  candidate: AttentionCandidate,
  attention: Readonly<Record<string, SessionAttentionSignal>>
): boolean {
  if (!candidate.sessionId || !candidate.live) return false;
  return attentionNeedsOperator(attention[candidate.sessionId]);
}

/**
 * The ⌘J queue: every painted target, oldest signal first, minus the one you
 * are already standing on. Derived from `paintsAttention` so the queue and
 * the markers cannot disagree.
 */
export function attentionJumpQueue(
  candidates: readonly AttentionCandidate[],
  attention: Readonly<Record<string, SessionAttentionSignal>>,
  activeSessionId: string | null
): string[] {
  const painted = new Set<string>();
  for (const candidate of candidates) {
    if (paintsAttention(candidate, attention)) {
      painted.add(candidate.sessionId as string);
    }
  }
  return orderedAttentionTargets(attention, activeSessionId).filter(sessionId =>
    painted.has(sessionId)
  );
}

/** One ordering function feeds both command availability and navigation. */
export function orderedAttentionTargets(
  attention: Record<string, SessionAttentionSignal>,
  activeSessionId: string | null
): string[] {
  return Object.entries(attention)
    .filter(
      ([sessionId, signal]) =>
        sessionId !== activeSessionId && attentionNeedsOperator(signal)
    )
    .sort((a, b) => a[1].since - b[1].since)
    .map(([sessionId]) => sessionId);
}

/**
 * Everything known about one Session's turn, from both channels at once:
 * what the bytes showed and what the harness reported.
 *
 * Named and exported because more than one question is asked of these facts —
 * which light to draw, and whether closing this tab would interrupt work — and
 * every asker has to start from the same ones. A surface that reaches past
 * this for the raw activity map is reading byte evidence where turn truth is
 * meant, which is the shape of every status lie this area has produced.
 */
export interface SessionTurnFacts {
  /** inferred from the PTY stream: bytes are arriving right now */
  working: boolean;
  /** false for shells — they have no turn state */
  agent: boolean;
  started: boolean;
  /** harness-reported outstanding children; false when unreported (ENG-023) */
  delegatedBusy?: boolean;
  /** harness-reported operator gate — a question, permission, or elicitation
   *  the Agent is waiting on (ENG-023 D4) */
  blocked?: boolean;
  /** the source's OWN report of its turn, when it makes one (ENG-015 S1.1).
   *  Undefined means unreported, and the inferred byte activity stands. */
  ownTurn?: 'generating' | 'available';
}

/**
 * The per-Session channels a workspace surface holds, keyed as they arrive
 * from main: `activity`/`engaged`/`delegation` by sessionId, `summaries` by
 * durable id.
 */
export interface SessionTurnSources {
  activity: Record<string, boolean>;
  engaged: Record<string, boolean>;
  summaries: Record<string, string>;
  delegation: Record<string, SessionDelegation>;
}

/**
 * Compose one tab's turn facts from every channel that has an opinion.
 *
 * The composition itself is the thing worth sharing. It was written out by
 * hand at five surfaces — strip, exposé, Project dot, close paths, roadmap
 * lens — and the ones that forgot a channel are precisely the ones that
 * lied: a lens that read only `activity` called a mid-tool-call Agent
 * `waiting`, and a close confirmation that read only `activity` offered no
 * warning at all. Forgetting a channel should require deleting an argument,
 * not merely failing to remember one.
 */
export function sessionTurnFacts(
  tab: {
    sessionId: string | null;
    harness: string;
    durableSessionId: string;
  },
  { activity, engaged, summaries, delegation }: SessionTurnSources
): SessionTurnFacts {
  const reported = tab.sessionId ? delegation[tab.sessionId] : undefined;
  return {
    working: !!(tab.sessionId && activity[tab.sessionId]),
    agent: tab.harness !== 'shell',
    started:
      !!(tab.sessionId && engaged[tab.sessionId]) ||
      !!summaries[tab.durableSessionId],
    delegatedBusy: sessionDelegationBusy(reported),
    blocked: sessionReportedBlocked(reported),
    ownTurn: reported?.ownTurn,
  };
}

/** Working wins; agents split on whether they were ever given work; shells
 * are simply quiet between output because they do not have turns.
 *
 * Delegated work counts as working (ENG-023). A Session whose own turn ended
 * while its children keep going has produced no result to read, and reporting
 * one is the specific lie this rule exists to stop — measured at 74 seconds of
 * "result ready" while a child was mid-flight. The operator's framing: if the
 * team is working, they're working. */
export function sessionGlyphState({
  working,
  agent,
  started,
  delegatedBusy = false,
  blocked = false,
  ownTurn,
}: SessionTurnFacts): SessionGlyphState {
  // Outranks every other fact, including a still-open turn. An Agent parked on
  // a question IS mid-turn — `Stop` has not fired — but "working" is the one
  // thing it is provably not doing, and the operator is the only one who can
  // change that. Nothing below can be more urgent.
  if (blocked) return 'blocked';
  if (delegatedBusy) return 'working';
  // A source that declares its own boundary outranks byte activity in BOTH
  // directions. Measured on a real Session, inference trailed the reported
  // truth by 6-7s every turn — long enough to show "working" for an Agent
  // that had already finished, and to hide a result that was ready.
  if (ownTurn === 'generating') return 'working';
  // `available` resolves through the SAME rest vocabulary as inference, so a
  // reported turn changes when the strip is right, never what it can say.
  if (ownTurn === 'available') {
    if (!agent) return 'quiet';
    return started ? 'done' : 'fresh';
  }
  if (working) return 'working';
  if (!agent) return 'quiet';
  return started ? 'done' : 'fresh';
}

/**
 * The roadmap lens speaks in three states where the light has five.
 *
 * Both surfaces that summon the lens — the workspace and exposé — used to
 * collapse them by hand from the raw activity map, which read a mid-tool-call
 * Agent as `waiting` and a Session parked on a question as `waiting` too.
 * Collapsing the LIGHT instead means the lens can only ever differ from the
 * tab strip by being coarser, never by disagreeing.
 */
export function sessionLensTurnState({
  facts,
  attention,
}: {
  facts: SessionTurnFacts;
  attention?: SessionAttentionSignal | null;
}): 'working' | 'waiting' | 'needs-you' {
  const light = sessionStatusLightState({
    state: sessionGlyphState(facts),
    attention,
  });
  if (light === 'needs-you') return 'needs-you';
  return light === 'active' ? 'working' : 'waiting';
}

/**
 * Project durable Session truth into the approved five-light vocabulary.
 * A quiet turn boundary is a ready result; an explicit bell, roadmap block, or
 * reported operator gate is a human gate. Presence-only legacy flags remain
 * conservative needs-you.
 *
 * Every input goes THROUGH `deriveStatusLightState`. It used to short-circuit
 * to `result` on a turn-end signal, and that bypass is what let one Session
 * render two contradictory answers: a green result while the harness reported
 * the turn still open, flipping to a blue spinner the moment focus cleared the
 * signal and revealed the state underneath. Focusing a tab must change what
 * the operator has SEEN, never what is true.
 */
export function sessionStatusLightState({
  state,
  attention,
  fault = false,
}: {
  state: SessionGlyphState;
  attention?: SessionAttentionSignal | null;
  fault?: boolean;
}): StatusLightState {
  return deriveStatusLightState({
    fault,
    // A reported gate is a CONDITION, not an unseen event: it survives the
    // operator looking at the tab, because looking does not answer a question.
    needsOperator: state === 'blocked' || attentionNeedsOperator(attention),
    // A turn-end signal claims a result only when no fresher truth contradicts
    // it. Inference no longer raises one over a reported-open turn, and this
    // keeps the surface honest if some future producer does.
    hasResult:
      state === 'done' || (attention?.kind === 'turn-end' && state !== 'working'),
    active: state === 'working',
  });
}

/** Tooltip copy — one voice across every Session surface. */
export const SESSION_GLYPH_COPY: Record<SessionGlyphState, string> = {
  // NOT "output streaming": the light is active for a reported-open turn with
  // no bytes at all — a long tool call, a slow first token — and a tooltip
  // that names a mechanism the operator can see is not happening teaches them
  // to distrust the light (BUG-008).
  working: 'working — turn in progress',
  blocked: 'needs you — waiting on your answer',
  done: 'result ready — turn finished',
  fresh: 'new — not given a task yet',
  quiet: 'quiet — waiting or between turns',
};

/** Attention is intentionally calm: it means unseen, not necessarily bad. */
export const ATTENTION_GLYPH_COPY =
  'Needs you — Agent requested input or hit a roadmap block. Open this Session to respond.';

export const FAULT_GLYPH_COPY =
  'Agent failed — open the Session for error details or recovery.';

/** Compact state words for visible labels and accessible names. */
export const SESSION_GLYPH_LABEL: Record<SessionGlyphState, string> = {
  working: 'working',
  blocked: 'needs you',
  done: 'result ready',
  fresh: 'new',
  quiet: 'quiet',
};

/**
 * How many dots a delegation cluster draws before it stops counting up
 * (ENG-023). Dots are a presence channel, not a readout — a workflow fanning
 * out sixteen children should read as "lots", and the exact number lives in
 * the tooltip and the accessible name where a number belongs.
 */
export const DELEGATION_DOT_CAP = 5;

/** Whether a Session has delegated work outstanding. `null`/absent delegation
 *  means the source does not report it — absent, never zero. */
export function sessionDelegationBusy(
  delegation?: SessionDelegation | null
): boolean {
  return !!delegation && delegation.children.length > 0;
}

/** The harness reported an open operator gate (ENG-023 D4). */
export function sessionReportedBlocked(
  delegation?: SessionDelegation | null
): boolean {
  return !!delegation?.blockedOn;
}

/** Names the gate for the tooltip and the accessible name. */
export const SESSION_BLOCKED_COPY: Record<
  NonNullable<SessionDelegation['blockedOn']>,
  string
> = {
  question: 'Needs you — the Agent asked a question and is waiting on your answer.',
  permission: 'Needs you — the Agent is waiting on a permission decision.',
  elicitation: 'Needs you — a tool is waiting on input from you.',
};

/**
 * One sentence naming the delegated work. Kinds are the source's own agent
 * names, deduplicated and in first-seen order, because three Explores read as
 * one kind of help rather than three unrelated facts.
 */
export function delegationCopy(
  delegation?: SessionDelegation | null
): string | null {
  const children = delegation?.children ?? [];
  if (children.length === 0) return null;
  const kinds = [
    ...new Set(
      children
        .map(child => child.agentType?.trim())
        .filter((kind): kind is string => !!kind)
    ),
  ];
  const count = `${children.length} delegated ${
    children.length === 1 ? 'agent' : 'agents'
  } working`;
  return kinds.length > 0 ? `${count} — ${kinds.join(', ')}` : count;
}

/**
 * The Sessions-altitude child rail (ENG-023 D3a) — one row per delegated
 * child, capped so the rail's vertical budget is constant and the tile
 * footprint never moves. With more children than rows, the last row becomes
 * a summary; the full census stays in the presence-dot tooltip, where D1 put
 * it. Render-free so Terminal's D2 rail can consume the same projection.
 */
export const DELEGATION_RAIL_ROW_CAP = 3;

export interface DelegationRailRow {
  key: string;
  agentType: string | null;
  description: string | null;
  startedAt: number;
}

export function delegationRailRows(
  delegation?: SessionDelegation | null
): { rows: DelegationRailRow[]; overflow: number } {
  const children = delegation?.children ?? [];
  const shown =
    children.length > DELEGATION_RAIL_ROW_CAP
      ? children.slice(0, DELEGATION_RAIL_ROW_CAP - 1)
      : children;
  return {
    rows: shown.map(child => ({
      key: child.id,
      agentType: child.agentType,
      description: child.description ?? null,
      startedAt: child.startedAt,
    })),
    overflow: children.length - shown.length,
  };
}

/**
 * Minute-granularity elapsed time for a child row. Seconds would make a tile
 * grid tick like a stopwatch — motion without meaning at comparison altitude.
 * Returns '' for a non-finite start time (an older main process may omit
 * wire fields): no elapsed is honest, "NaNm" is a bug on a status surface.
 */
export function delegationElapsedLabel(now: number, startedAt: number): string {
  if (!Number.isFinite(now) || !Number.isFinite(startedAt)) return '';
  const minutes = Math.floor(Math.max(0, now - startedAt) / 60_000);
  if (minutes < 1) return '<1m';
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/**
 * Tooltip for the status light, corrected for delegation.
 *
 * A generic "turn in progress" is true but incurious for a Session that is
 * quiet precisely because it handed the work to someone else; that one says
 * so, because the operator's next question is who.
 */
export function sessionGlyphCopy(
  state: SessionGlyphState,
  delegation?: SessionDelegation | null
): string {
  // "Needs you" is the answer to a question the operator will immediately ask
  // back: needs me for WHAT? The reported reason is the only place that is
  // known, so it is the only place that can say.
  if (state === 'blocked' && delegation?.blockedOn) {
    return SESSION_BLOCKED_COPY[delegation.blockedOn];
  }
  if (state === 'working' && sessionDelegationBusy(delegation)) {
    return 'working — delegated agents running';
  }
  return SESSION_GLYPH_COPY[state];
}
import {
  deriveStatusLightState,
  type StatusLightState,
} from '@/components/status-light/protocol';
import type { SessionDelegation } from '@/types/electron';
