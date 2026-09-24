import type {
  AgentSourceAdapterId,
  AgentSourceEvidenceBasis,
} from '../agent-sources';
import type { AgentStatus } from '../types/agent';
import type {
  AGENT_PROJECTION_VERSION,
  AgentSourcePlacement,
  SourceAgentDiscoveryState,
} from '../agent-projection';
import type { SshHostAlias } from '../oc/ssh-config';
import type {
  ConnectedSourceView,
  SourceAuthority,
  SourceConnectionState,
  SourceCredentialOwner,
  SourceFailureClass,
  SourceTransport,
} from '../sources/connected-source';

/**
 * Configured Agent Sources over the desktop bridge (ENG-010 C1/C2, ENG-033
 * H2). The renderer receives names, freshness and projected coworkers; SSH
 * material, the OS keychain and the authenticated socket never cross.
 */

/** Passive enumeration of SSH config text. Listing a server is not
 *  contacting it. */
export interface SshAliasCandidates {
  aliases: readonly SshHostAlias[];
  /** True when a config file exists at all. False means nothing to offer. */
  configPresent: boolean;
  /** True when some Include target could not be read. */
  incompleteIncludes: boolean;
}

export interface AddConnectedSourceInput {
  adapterId: AgentSourceAdapterId;
  placement: AgentSourcePlacement;
  displayName: string;
  transport: SourceTransport;
  credentialOwner: SourceCredentialOwner;
}

export type ConnectedSourceAddResult =
  | { ok: true; source: ConnectedSourceView | null; created: boolean }
  | { ok: false; issues: readonly string[] };

/**
 * How current Exawatt's view of a source is. Independent of work state by
 * contract: none of these fields, and none of their labels, may be read as a
 * claim that remote work stopped, paused, or ended.
 */
export interface SourceConnectionView {
  state: SourceConnectionState;
  /** `Live` | `Reconnecting` | `Stale` | `Unavailable`. */
  label: string;
  /** Longer sentence for detail surfaces; still only about observation. */
  detail: string;
  observationAgeMs: number | null;
  stalePresentation: boolean;
  failure: SourceFailureClass | null;
}

export type ConnectedGatewayPhase =
  | 'idle'
  | 'opening-tunnel'
  | 'bootstrapping'
  | 'pairing'
  | 'discovering'
  | 'connected'
  | 'reconnecting'
  | 'failed';

/**
 * One thing the source itself said, with the standing of the claim attached.
 * `basis` and `provenance` travel with the value because a surface that shows
 * a version has to be able to say which check produced it and whether the
 * source was live or simulated.
 */
export interface ObservedSourceFact {
  value: string;
  basis: AgentSourceEvidenceBasis;
  /** Which check produced it, in the operator's words. */
  provenance: string;
}

/** One thing Exawatt may do with this source, and how it knows. */
export interface ObservedSourceCapability extends ObservedSourceFact {
  label: string;
}

/** The installation's own answers as raw tokens, for the Connect flow, so the
 *  surface owns the vocabulary it renders them in. */
export interface ObservedSourceFactsView {
  /** The source's own reported identity, or null when it declared none. */
  identity: string | null;
  version: string | null;
  /** Scope tokens the Gateway granted this device. */
  capabilities: readonly string[];
  observedAt: number | null;
}

export interface ConnectedSourceStatusView {
  sourceId: string;
  displayName: string;
  adapterId: AgentSourceAdapterId;
  placement: AgentSourcePlacement;
  /** `Local` | `Remote` | `Exawatt Cloud`. Quiet metadata, never a status. */
  placementLabel: string;
  /** True once this launch opened a session for the source. */
  observing: boolean;
  phase: ConnectedGatewayPhase;
  connection: SourceConnectionView;
  /**
   * The version the source reported, or null when this launch has not read
   * one. Null is "not observed", never "no version".
   */
  version: ObservedSourceFact | null;
  /** Empty for the same reason `version` is null, never a claim that the
   *  source can do nothing. */
  capabilities: readonly ObservedSourceCapability[];
  /** The source now reports a different installation than the plan maps. */
  identityDrift: boolean;
  /**
   * Bumped by every authoritative snapshot, and by nothing else. A renderer
   * keyed on it re-reads the roster when it moves; phase movement does not
   * bump it, so a surface that only cares about topology can ignore a
   * reconnect ladder.
   */
  snapshotRevision: number;
}

/** What the Connect dialog's discovery step chooses from. */
export interface DiscoveredSourceAgent {
  nativeAgentId: string;
  displayName: string;
  discoveryState: SourceAgentDiscoveryState;
  contextCount: number;
  /** False means this Agent opens on its work, not on a fabricated Home. */
  hasPrimaryConversation: boolean;
  /** The saved mapping, when this Agent already has one. */
  mapping: {
    exawattAgentId: string;
    projectId: string;
    projectLabel: string;
    displayNameOverride: string | null;
  } | null;
}

/** One projected coworker, ready to stand beside the local Agents. */
export interface RemoteAgentView {
  id: string;
  displayName: string;
  projectId: string;
  projectLabel: string;
  discoveryState: SourceAgentDiscoveryState;
  placement: AgentSourcePlacement;
  placementLabel: string;
  adapterId: AgentSourceAdapterId;
  source: { id: string; displayName: string };
  nativeAgentId: string;
  /** The source-declared `main` context, or null when it declares none. */
  primaryContextId: string | null;
  /**
   * D40 work state, in the vocabulary a local Agent already uses, or null
   * when the source has evidenced none. Read from the kernel's
   * `ProjectedAgent.workState`, never recomputed.
   *
   * Null is unknown, and it must never render as a positive claim: a
   * coworker whose source said nothing is not idle. Observed at `observedAt`;
   * a stale connection leaves it as last observed and `connection` says so.
   */
  workState: AgentStatus | null;
  contextCount: number;
  observedAt: number;
  createdAt: number;
  lastActiveAt: number;
  connection: SourceConnectionView;
  projectionVersion: typeof AGENT_PROJECTION_VERSION;
}

export type ConnectSourceResult =
  | {
      ok: true;
      sourceId: string;
      agents: readonly DiscoveredSourceAgent[];
      status: ConnectedSourceStatusView;
      /** What the source said about itself on this connection, so the
       *  operator confirms which installation they reached before importing
       *  anyone out of it. */
      observed: ObservedSourceFactsView | null;
    }
  | {
      ok: false;
      sourceId: string;
      outcome: 'unknown-source' | 'identity-drift' | 'failed';
      failure: SourceFailureClass | null;
      message: string;
    };

/** One Project/name decision the Connect flow collected. */
export interface AgentMappingInput {
  nativeAgentId: string;
  projectId: string;
  projectLabel?: string;
  displayNameOverride?: string | null;
}

export type MapAgentsResult =
  | { ok: true; mapped: number }
  | { ok: false; issues: readonly string[] };

/**
 * A tick, not a payload. It names the source that moved and how fresh it is;
 * the renderer decides whether to pull the roster again.
 */
export interface ConnectedSourceChange {
  sourceId: string;
  phase: ConnectedGatewayPhase;
  connection: SourceConnectionView;
  snapshotRevision: number;
}

/* ---- Talking to a connected coworker (ENG-033 H2) ------------------------ */

/** Who said it. The product vocabulary, not the protocol's. */
export type ConversationRole = 'operator' | 'agent';

export interface ConversationTurnView {
  /**
   * Stable identity, derived from the turn rather than minted per read, so
   * an authoritative resnapshot reconciles instead of duplicating.
   */
  id: string;
  role: ConversationRole;
  text: string;
  at: number;
  /** The run that produced it, when the source names one. */
  runId: string | null;
  /** True when `text` was clipped to the per-turn budget. */
  clipped: boolean;
}

export interface ConversationRequest {
  /** Turns to return, newest backward. Clamped in main. */
  limit?: number;
  /** Page further back: the turns older than this one. */
  beforeTurnId?: string;
}

/**
 * `no-primary-conversation` is the explicit answer for a coworker whose
 * source declares no conversation at all. It is never an empty transcript,
 * which would read as silence from someone who has never been spoken to.
 */
type ConversationRefusal =
  | 'unknown-agent'
  | 'no-primary-conversation'
  | 'disconnected'
  | 'unreadable';

export type ConversationResult =
  | {
      ok: true;
      agentId: string;
      sourceId: string;
      contextId: string;
      /** Oldest to newest, in the order the source retains them. */
      turns: readonly ConversationTurnView[];
      /** Older turns exist beyond this page. Bounding is never silent. */
      hasMore: boolean;
      characterCount: number;
      observedAt: number;
      connection: SourceConnectionView;
    }
  | {
      ok: false;
      agentId: string;
      outcome: ConversationRefusal;
      message: string;
    };

export interface SendToAgentOptions {
  /** Reused verbatim on a retry, so a retry after a dropped connection
   *  resolves to the same run rather than posting the message twice. */
  idempotencyKey?: string;
}

/**
 * Every way a send declines, each distinct because the next step differs.
 * `read-only-source` means ask this source for write access;
 * `approval-pending` means the ask is standing and someone has to approve the
 * Exawatt device on the source. None of them is a claim about the coworker.
 */
export type SendRefusal =
  | 'unknown-agent'
  | 'read-only-source'
  | 'approval-pending'
  | 'no-primary-conversation'
  | 'disconnected'
  | 'invalid-message'
  | 'refused';

export type SendToAgentResult =
  | {
      ok: true;
      agentId: string;
      sourceId: string;
      contextId: string;
      runId: string | null;
      status: 'sent' | 'queued';
      idempotencyKey: string;
      at: number;
    }
  | {
      ok: false;
      agentId: string;
      outcome: SendRefusal;
      message: string;
    };

type ConversationUpdateKind =
  | 'delta'
  | 'complete'
  | 'bounded'
  | 'resnapshot';

export interface ConversationUpdate {
  agentId: string;
  sourceId: string;
  contextId: string;
  runId: string | null;
  /**
   * `bounded` says this run produced more than Exawatt forwards live; read
   * the conversation for the rest. `resnapshot` says observation reattached
   * and the authoritative history is the truth now.
   */
  kind: ConversationUpdateKind;
  /** Reply text for `delta`; empty for every other kind. */
  text: string;
  /**
   * Order within this process, monotonic across every source. Exawatt's own
   * counter, never the Gateway's frame sequence, which resets per connection
   * and replays nothing. Never a catch-up cursor.
   */
  ordinal: number;
  at: number;
}

/**
 * What Exawatt may do with one source, kept apart from freshness on purpose:
 * a read-only source is not a degraded connection.
 */
export interface SourceCommandAuthorityView {
  sourceId: string;
  displayName: string;
  /** What the Gateway granted on the last completed handshake. */
  authority: SourceAuthority;
  /** A write request is standing, waiting for someone to approve the
   *  Exawatt device on the source itself. */
  awaitingApproval: boolean;
  /** Exawatt can run the source's own approval of its own request over the
   *  operator's SSH login (ENG-033 H2.4 P3). */
  canApproveOnSource: boolean;
  /** What to run by hand, in order, while a request is standing; null when
   *  none is. */
  approveCommands: readonly string[] | null;
}

/**
 * What became of an operator's request to change a source's authority.
 *
 * `approval-required` is a first-class answer, not an error. Verified against a
 * live Gateway 2026-08-18: a device already approved at `operator.read` that
 * reconnects asking for `operator.write` is refused whether it presents its own
 * device token (`device token scope mismatch`) or the admin-capable shared
 * secret (`pairing required: device is asking for more scopes than currently
 * approved`), and the device record keeps its narrower scopes either way.
 * Raising an approved device's scope is a decision taken on the source, by the
 * person who owns it, with the source's own device tooling. Exawatt asks; it
 * cannot grant.
 *
 * `refused` is every other no. `unchanged` means Exawatt already holds the
 * authority asked for and put no question to the Gateway.
 */
type AuthorityRequestOutcome =
  | 'granted'
  | 'approval-required'
  | 'refused'
  | 'unchanged';

/**
 * How far a one-click approval got (ENG-033 H2.4 P3): asked the source, found
 * Exawatt's own request or could not, and ran the source's approval or was
 * refused it. Diagnostic evidence, never operator copy.
 */
type OwnApprovalStep =
  | 'asked'
  | 'not-found'
  | 'unreadable'
  | 'approve-refused'
  | 'approved';

export interface AuthorityRequestResult {
  outcome: AuthorityRequestOutcome;
  /** The authority Exawatt holds now, the granted truth in every branch, so
   *  a caller that reads nothing else still cannot act on authority the
   *  source did not give. */
  authority: SourceAuthority;
  /** One operator-facing sentence: what happened, and what to do about it. */
  message: string;
  /** Exawatt's own standing request on the source, when the source's pairing
   *  list named it. Present only beside `approval-required`. */
  pendingRequestId?: string;
  /** How far a one-click approval got, when this answers one. */
  approvalStep?: OwnApprovalStep;
}
