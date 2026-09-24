import type {
  AgentHarness,
  AgentPermissionMode,
  PtyHarness,
} from '../agent-sources';
import type { SessionBackgroundTask } from '../session-background-work';

/**
 * The desktop bridge's Session vocabulary: what the renderer asks the PTY
 * owner for, and what it answers with. Electron main constructs every shape
 * here and the renderer consumes it; neither side declares its own copy.
 */

export interface PtyCreateOptions {
  harness: PtyHarness;
  /** Working directory (worktree); defaults to the operator's home. */
  cwd?: string;
  cols?: number;
  rows?: number;
  /** Display title; defaults to the harness name. */
  title?: string;
  /** Exact provider conversation id. Presence means resume that id. */
  resumeSessionId?: string;
  /** Stable Exawatt Session identity; survives PTY process replacement. */
  durableSessionId?: string;
  /** Optional first task for a newly created interactive Agent. */
  initialPrompt?: string;
  /** Goal statement carried across a resume for context summaries (D21).
   *  Metadata only, never written to the process; a fresh create's
   *  initialPrompt already doubles as the stated task. */
  statedTask?: string;
  /** Persisted goal subtitle re-seeded into the summarizer on resume (D21).
   *  Metadata only, transported to the context summarizer. */
  restoredSubtitle?: string;
  /** Source-agnostic launch policy translated to provider CLI flags. */
  permissionMode?: AgentPermissionMode;
  /** Model choice resolved by the source catalog and pinned for this launch. */
  model?: string;
  /** Reasoning effort resolved beside the model and pinned for this launch. */
  effort?: string;
}

/**
 * What the PTY owner knows about one process: the answer to a create or a
 * model change. A row of `pty:list` adds main's live observations to it
 * (`PtySessionInfo`).
 */
export interface PtySessionRecord {
  id: string;
  durableSessionId: string;
  harness: PtyHarness;
  title: string;
  cwd: string;
  /** Directory-keyed Project grouping (worktree-aware git root). */
  projectDir: string;
  projectName: string;
  cols: number;
  rows: number;
  startedAt: number;
  exited: boolean;
  exitCode: number | null;
  /** The signal that ended the process (`SIGKILL`), null when none did.
   *  node-pty reports a signalled death as code 0, so the code alone cannot
   *  say an exit was clean (BUG-186). */
  exitSignal: string | null;
  /** Last output timestamp (ENG-015 S2: live status in the switcher). */
  lastDataAt: number;
  /** Durable provider identity; unlike `id`, survives a new PTY process.
   *  Null until explicitly captured. */
  harnessSessionId: string | null;
  /** Requested at launch; a native in-terminal change may differ. */
  launchModel?: string;
  launchEffort?: string;
}

/** `blocked` is a reported operator gate (ENG-023 D4): a question, a
 *  permission decision, or an MCP elicitation. Like `bell` and unlike
 *  `turn-end`, it needs the operator. */
export type PtyAttentionKind = 'bell' | 'turn-end' | 'blocked';

/** "This Session needs the operator" (ENG-015 S1). */
export interface PtyAttention {
  kind: PtyAttentionKind;
  /** When the attention was raised; the queue orders oldest first. */
  since: number;
}

/** Source-neutral visual identity for one durable Session goal (ENG-015 S4.1). */
export interface GoalVisual {
  identityKey: string;
  revision: number;
  state: 'fallback' | 'generating' | 'ready' | 'rejected';
  dataUrl?: string | null;
}

/**
 * What a persisted layout stores in place of a `GoalVisual` (BUG-031).
 *
 * `identityKey` is already a content address, so the pixels live once in
 * main's content-addressed side store and the layout carries only the
 * reference. Main resolves it back through `pty:restore-goal-visual`.
 */
export interface GoalVisualRef {
  identityKey: string;
  revision: number;
  state: GoalVisual['state'];
}

/** Quiet S4 catch-up generated only when returning after meaningful change. */
export interface PtyReentryRecap {
  id: string;
  text: string;
  awayMs: number;
  generatedAt: number;
}

/** One live delegated child (ENG-023). Deliberately richer than D1's dots
 *  need: D2's per-child rail enriches these rows rather than rebuilding them. */
export interface DelegatedChild {
  /** Harness-assigned child id; opaque, never shown to the operator. */
  id: string;
  /** The source's own agent kind ("Explore", "general-purpose", ...). */
  agentType: string | null;
  /**
   * The operator-legible spawn label from `PreToolUse[Agent|Task]` (ENG-023
   * D3a), adopted by correlation at child start. Null when the label was
   * never observed or correlation failed: a missing label renders as absent,
   * never invented. Labels only; results never enter this record.
   */
  description: string | null;
  startedAt: number;
}

/**
 * Why the Agent stopped and handed control back to the operator (ENG-023 D4).
 * A reason rather than a boolean because Terminal and Sessions say WHICH gate
 * is open, and because the reasons unblock differently.
 */
export type SessionBlockedReason = 'question' | 'permission' | 'elicitation';

/**
 * Harness-reported turn truth for one Session (ENG-023).
 *
 * Three facts, deliberately kept apart: `ownTurn` answers "is this Session
 * itself generating?", `children` answers "is its team still working?", and
 * `blockedOn` answers "is it waiting on a human?". A parent can be
 * `available` with children mid-flight, and an Agent can be `generating` AND
 * blocked: `AskUserQuestion` fires no `Stop`, so the turn is open while the
 * Agent does nothing but wait for an answer.
 */
export interface SessionDelegation {
  ownTurn: 'generating' | 'available';
  /** The operator gate the Agent is sitting behind, or null when it is not
   *  waiting on a human. Independent of `ownTurn` on purpose. */
  blockedOn: SessionBlockedReason | null;
  /** Live children, oldest first. */
  children: DelegatedChild[];
  /** Non-Agent work reported by the source; absent on older providers. */
  backgroundTasks?: SessionBackgroundTask[];
}

/**
 * Main's live observations of one Session. They ride along on every
 * `pty:list` row so a reload or a late attach sees them at once instead of
 * waiting for the next push.
 */
interface PtySessionLiveFacts {
  /** Auto-summarized micro-context (W0.4); null until the first summary. */
  contextSummary: string | null;
  /** Goal-level work-world projection (ENG-015 S4.1). */
  goalVisual: GoalVisual | null;
  /** Needs-operator flag (ENG-015 S1); null when clear. */
  attention: PtyAttention | null;
  /** Ever given work: a task, a resume, or a human keystroke (D22). */
  engaged: boolean;
  /** Main-owned activity truth (D29), including the self-resize redraw grace. */
  working: boolean;
  /** Harness-reported delegated work (ENG-023). Null means the source
   *  reports nothing live: read as unknown, never as zero. */
  delegation: SessionDelegation | null;
}

/** One row of `pty:list`: the record plus main's live observations. */
export type PtySessionInfo = PtySessionRecord & PtySessionLiveFacts;

/** A structured answer instead of a thrown error: IPC rejections arrive as
 *  opaque "Error invoking remote method" strings. */
export type PtyCreateResult =
  | { ok: true; session: PtySessionRecord }
  | { ok: false; error: string };

export interface SessionPauseResult {
  durableSessionId: string;
  status: 'paused' | 'already-paused' | 'unsupported' | 'failed';
  error?: string;
}

export type SessionPauseBatchResult =
  | { kind: 'needs-confirmation'; activeSessionIds: string[] }
  | { kind: 'completed'; results: SessionPauseResult[] };

export interface SessionModelChange {
  model: string;
  effort?: string;
}

export interface AgentEffortOption {
  id: string;
  label: string;
  description: string;
}

export interface AgentModelOption {
  id: string;
  label: string;
  description: string;
  defaultEffort: string | null;
  efforts: AgentEffortOption[];
}

export interface AgentModelCatalog {
  harness: AgentHarness;
  /** The model Exawatt pins for a new Agent unless the operator changes it. */
  effectiveModel: string | null;
  effectiveModelLabel: string;
  effectiveModelSource:
    | 'config'
    | 'harness-recommended'
    | 'account-default'
    | 'unavailable';
  /** The effort Exawatt pins unless null/auto leaves it to the harness. */
  effectiveEffort: string | null;
  effectiveEffortLabel: string;
  effectiveEffortSource:
    | 'config'
    | 'model-default'
    | 'environment'
    | 'unavailable';
  /** An environment override outranks CLI flags, so the UI must not promise
   *  a change the harness would ignore. */
  effortLocked: boolean;
  models: AgentModelOption[];
  catalogMode:
    | 'live-catalog'
    | 'configured-values'
    | 'source-owned'
    | 'unavailable';
  catalogProvenance: string;
  observedAt: number;
  selectionAction: 'choose-in-source' | null;
  /** True when this came from the disk cache rather than a fresh probe. */
  servedFromCache?: boolean;
}

/** A soft-closed Session in the Recently-closed ledger (D23). */
export interface ClosedSessionEntry {
  durableSessionId: string;
  title: string;
  /** Optional for v1 ledger compatibility; current writers preserve whether
   *  the title was the default identity or an explicit operator rename. */
  titleKind?: 'default' | 'operator';
  /** Goal subtitle at close time (D21 durable goal). */
  goal: string | null;
  /**
   * The harness as the ledger file recorded it. A string, not a
   * `PtyHarness`: the ledger is a file on disk, and a row written by a build
   * that knew a harness this build does not still reads back.
   */
  harness: string;
  cwd: string;
  projectDir: string;
  projectName: string;
  /** Provider conversation id; exact resume works after reopen. */
  harnessSessionId: string | null;
  /** The composer's stated task (re-anchors the summarizer on resume). */
  initialTask: string | null;
  closedAt: number;
}

export interface HarnessResumeCandidate {
  id: string;
  cwd: string;
  /** Provider session creation time, used to associate parallel launches. */
  startedAt: number;
  updatedAt: number;
  label: string;
  description: string | null;
}

export interface ResumeIdentityHint {
  durableSessionId: string;
  harness: AgentHarness;
  cwd: string;
  initialTask: string | null;
  harnessSessionId: string | null;
}

export interface ReconciledResumeIdentity {
  durableSessionId: string;
  harness: AgentHarness;
  cwd: string;
  harnessSessionId: string;
  source: 'durable-index' | 'task-correlation';
}

export interface RecentConversation {
  id: string;
  harness: AgentHarness;
  cwd: string;
  startedAt: number;
  updatedAt: number;
  title: string;
  description: string | null;
  titleSource: 'native' | 'generated' | 'fallback';
  needsSummary: boolean;
  /** Exact provider identity when known; null for retained-only Exawatt
   *  Sessions that cannot safely auto-resume a harness conversation. */
  providerSessionId: string | null;
  /** Continue the provider identity directly, or restore Exawatt's richer
   *  logical Session (including retained history) when the Project ledger
   *  owns this conversation. */
  continuation:
    | { kind: 'provider' }
    | { kind: 'exawatt-session'; durableSessionId: string };
}

export type WorktreeResult =
  | { ok: true; path: string }
  | { ok: false; error: string };

/** O(1) description of a paused Session; never reads the transcript. */
export interface RetainedHistoryMeta {
  bytes: number;
  updatedAt: number;
  exists: boolean;
}

/** The transcript as readable lines, rendered in main and bounded. */
export interface RetainedTranscript {
  lines: string[];
  truncated: number;
  corrupt: boolean;
}

/** A bounded, local snapshot of the source's own conversation for Clone. */
export interface SessionCloneContext {
  text: string;
  provenance: 'source-conversation';
  capturedAt: number;
  partial: boolean;
}

export type ClipboardReadResult =
  | { kind: 'image'; path: string | null }
  | { kind: 'text' | 'empty'; text: string };

export interface ClipboardPasteResult {
  kind: 'image' | 'text' | 'empty';
  path?: string;
}

/* ---- Pushes ------------------------------------------------------------- */

export interface PtyDataEvent {
  id: string;
  durableSessionId: string;
  data: string;
  cursor: number;
}

export interface PtyExitEvent {
  id: string;
  durableSessionId: string;
  exitCode: number;
  exitSignal: string | null;
}

export interface PtyIdentityEvent {
  id: string;
  durableSessionId: string;
  harnessSessionId: string;
}
