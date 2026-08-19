/**
 * The connected coworker's front door, as pure decision logic (ENG-033 H2).
 *
 * No React, no IO, no clock. The surface renders whatever this module hands
 * it; every product rule from
 * `docs/engineering/projects/connected-openclaw-and-hosted-agents.md` lives
 * here, so the surface cannot disagree with the policy:
 *
 * - opening an Agent returns to its own primary conversation and never
 *   guesses from the latest or busiest context;
 * - a source that declares no primary conversation leads with Automations and
 *   offers no composer, rather than fabricating a Home;
 * - the composer addresses the primary conversation only; viewing subordinate
 *   work never retargets it;
 * - write authority is a source fact with three operator-visible positions,
 *   and the surface names what completes the one the operator is sitting in;
 * - a reconnecting or stale connection keeps last-known content, marks it not
 *   current, and never implies the remote work ended;
 * - a refused send names the reason and the next step, and the typed text
 *   survives it;
 * - a retried message is reconciled against the source's own history rather
 *   than resent blind, so a message that landed is never posted twice.
 *
 * Nothing in this file may conclude anything about the remote Agent's work
 * from Exawatt's own connection.
 */

import type { SourceFailureClass } from '@exawatt/core';

/* -------------------------------------------------------------------------- */
/* Vocabulary                                                                 */
/* -------------------------------------------------------------------------- */

/** How many turns the front door holds before the operator asks for more. */
export const CONVERSATION_PAGE_SIZE = 50;

/** History stays collapsed until the operator opens it. */
export const HISTORY_STARTS_COLLAPSED = true;

export const REMOTE_CONNECTION_STATES = [
  'live',
  'reconnecting',
  'stale',
  'unavailable',
] as const;
export type RemoteConnectionState = (typeof REMOTE_CONNECTION_STATES)[number];

/**
 * Where the source stands on this device's authority to write.
 *
 * `approval-pending` is a real waiting state, not an error: a device paired
 * for reading cannot raise its own scope, and the approval happens on the
 * machine that runs the Agent.
 */
export const WRITE_AUTHORITY_STATES = [
  'granted',
  'approval-pending',
  'not-requested',
  'unobserved',
] as const;
export type WriteAuthority = (typeof WRITE_AUTHORITY_STATES)[number];

export const COMPOSER_WITHHELD_REASONS = [
  'conversation-loading',
  'no-primary-conversation',
  'write-access-not-requested',
  'write-access-awaiting-approval',
  'write-access-unobserved',
  'connection-unavailable',
] as const;
export type ComposerWithheldReason = (typeof COMPOSER_WITHHELD_REASONS)[number];

/** Every way a send can come back refused, in operator terms. */
export const SEND_REFUSALS = [
  'no-write-authority',
  'no-primary-conversation',
  'disconnected',
  'unknown-agent',
  'unrecognized',
] as const;
export type SendRefusal = (typeof SEND_REFUSALS)[number];

export const CONVERSATION_TURN_ROLES = ['operator', 'agent', 'system'] as const;
export type ConversationTurnRole = (typeof CONVERSATION_TURN_ROLES)[number];

/* -------------------------------------------------------------------------- */
/* Inputs                                                                     */
/* -------------------------------------------------------------------------- */

export interface ConversationTurn {
  id: string;
  role: ConversationTurnRole;
  text: string;
  /** Epoch ms as the source reported it. */
  timestamp: number;
  /**
   * Echo of the id this client attached when it sent an operator turn. The
   * source may omit it; reconciliation falls back to the text.
   */
  clientId?: string | null;
}

/** What `conversation(agentId)` answered. */
export type ConversationLoad =
  | { kind: 'loading' }
  | {
      kind: 'declared';
      contextId: string;
      turns: readonly ConversationTurn[];
      /** The source has turns older than the ones carried here. */
      olderAvailable: boolean;
    }
  /** The source declares no primary conversation for this Agent. */
  | { kind: 'absent' }
  /** Exawatt could not read one. Last-known content, if any, still stands. */
  | {
      kind: 'unread';
      contextId: string | null;
      turns: readonly ConversationTurn[];
      olderAvailable: boolean;
    };

export interface RemoteConnectionView {
  state: RemoteConnectionState;
  /** `Live` | `Reconnecting` | `Last seen 4 minutes ago` | a failure class. */
  label: string;
  /** True while Exawatt must not present its cached view as current. */
  stalePresentation: boolean;
  failure: SourceFailureClass | null;
}

export interface RemoteWorkItem {
  id: string;
  title: string;
  detail: string | null;
}

export interface RemoteAutomation {
  id: string;
  name: string;
  schedule: string;
  lastRun: string | null;
  nextRun: string | null;
}

export interface RemoteHistoryEntry {
  id: string;
  title: string;
  detail: string | null;
}

export interface RemoteWorkStack {
  /** Meaningful current work. A cron run belongs in Automations, not here. */
  current: readonly RemoteWorkItem[];
  automations: readonly RemoteAutomation[];
  /** Everything that already happened. Collapsed by default. */
  history: readonly RemoteHistoryEntry[];
}

export const EMPTY_WORK_STACK: RemoteWorkStack = {
  current: [],
  automations: [],
  history: [],
};

export interface RemoteAgentIdentity {
  id: string;
  name: string;
}

export interface RemoteAgentInput {
  agent: RemoteAgentIdentity;
  connection: RemoteConnectionView;
  authority: WriteAuthority;
  conversation: ConversationLoad;
  work: RemoteWorkStack;
  /**
   * A subordinate context the operator opened beneath the Agent. It changes
   * what is on screen and never what the composer addresses.
   */
  viewing?: { contextId: string; title: string } | null;
  /** True when the host can carry a send-access request to the source. */
  canRequestWriteAccess?: boolean;
  /** True when the host can repair observation. */
  canReconnect?: boolean;
}

/* -------------------------------------------------------------------------- */
/* Presentation                                                               */
/* -------------------------------------------------------------------------- */

export interface ComposerTarget {
  contextId: string;
  agentName: string;
  /** Product copy for the target. Always the Agent's own conversation. */
  label: string;
  /** Structural proof the target is the front door, not what is on screen. */
  isPrimaryConversation: true;
}

export interface ComposerAction {
  id: 'request-send-access' | 'reconnect';
  label: string;
}

export type ComposerState =
  | { kind: 'ready'; target: ComposerTarget; placeholder: string }
  | {
      kind: 'withheld';
      reason: ComposerWithheldReason;
      /** Null only when the Agent has no primary conversation at all. */
      target: ComposerTarget | null;
      headline: string;
      detail: string | null;
      action: ComposerAction | null;
    };

export type FrontDoor =
  | { kind: 'loading'; heading: string }
  | {
      kind: 'conversation';
      heading: string;
      contextId: string;
      turns: readonly ConversationTurn[];
      olderAvailable: boolean;
    }
  | { kind: 'automations-lead'; heading: string; note: string };

export interface Freshness {
  state: RemoteConnectionState;
  /** True while the content on screen is last known rather than current. */
  marked: boolean;
  /** The badge that says so, or null while the view is current. */
  badge: string | null;
  /** One meta line about Exawatt's observation. Never about the Agent. */
  line: string;
}

export interface WorkSectionItem {
  id: string;
  title: string;
  detail: string | null;
  /** Work beneath an Agent is subordinate. It is never a coworker. */
  subordinate: true;
}

export type WorkSectionId = 'work' | 'automations' | 'history';

export interface WorkSection {
  id: WorkSectionId;
  title: string;
  items: readonly WorkSectionItem[];
  /** True when the section opens closed and the operator expands it. */
  collapsed: boolean;
  /** What the collapsed section holds, or null when nothing is withheld. */
  summary: string | null;
}

export interface RemoteAgentPresentation {
  frontDoor: FrontDoor;
  composer: ComposerState;
  freshness: Freshness;
  /** Ordered. Automations leads when there is no primary conversation. */
  sections: readonly WorkSection[];
  /** True when a subordinate context is on screen beneath the front door. */
  subordinateOpen: boolean;
}

/* -------------------------------------------------------------------------- */
/* Copy                                                                       */
/* -------------------------------------------------------------------------- */

export const FRONT_DOOR_HEADING = 'Conversation';
export const AUTOMATIONS_HEADING = 'Automations';
export const WORK_HEADING = 'Work';
export const HISTORY_HEADING = 'History';

/**
 * The reviewed treatment in `/hud-gallery/connected-source` already says this
 * about the Agent whose source declares no conversation. It is repeated
 * verbatim so the two surfaces agree.
 */
export const NO_CONVERSATION_NOTE = 'Conversation unavailable on this source';

export const LAST_KNOWN_BADGE = 'Last known';

/** One line per authority position: what is true, and what completes it. */
export const WRITE_AUTHORITY_COPY: Readonly<
  Record<
    Exclude<WriteAuthority, 'granted'>,
    { headline: string; detail: string }
  >
> = {
  'not-requested': {
    headline: 'This device is paired for reading',
    detail: 'Request send access to talk to this Agent from Exawatt.',
  },
  'approval-pending': {
    headline: 'Send access requested',
    detail: 'Approve it on the machine that runs this Agent to finish.',
  },
  unobserved: {
    headline: 'Access not read yet',
    detail: 'Reconnect to read what this device is allowed to do.',
  },
};

export const SEND_REFUSAL_COPY: Readonly<
  Record<SendRefusal, { headline: string; nextStep: string }>
> = {
  'no-write-authority': {
    headline: 'This device is paired for reading',
    nextStep: 'Request send access, then approve it on the source.',
  },
  'no-primary-conversation': {
    headline: 'This Agent has no conversation on its source',
    nextStep: 'Its Automations are what it runs today.',
  },
  disconnected: {
    headline: 'Exawatt is not connected to this source right now',
    nextStep: 'Reconnect, then send again.',
  },
  'unknown-agent': {
    headline: 'The source no longer reports this Agent',
    nextStep: 'Open source details to remap or detach it.',
  },
  unrecognized: {
    headline: 'The source refused the message',
    nextStep: 'Reconnect, then send again.',
  },
};

const REQUEST_ACCESS_ACTION: ComposerAction = {
  id: 'request-send-access',
  label: 'Request send access',
};

const RECONNECT_ACTION: ComposerAction = {
  id: 'reconnect',
  label: 'Reconnect',
};

/* -------------------------------------------------------------------------- */
/* Turns                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * One ordered, deduplicated transcript. Order is by timestamp, then by id so
 * two turns stamped the same millisecond keep a stable seat. A turn seen
 * twice keeps the later copy, because a stream update revises a turn the
 * snapshot already carried rather than adding a second one.
 */
export function mergeTurns(
  existing: readonly ConversationTurn[],
  incoming: readonly ConversationTurn[]
): readonly ConversationTurn[] {
  const byId = new Map<string, ConversationTurn>();
  for (const turn of existing) byId.set(turn.id, turn);
  for (const turn of incoming) byId.set(turn.id, turn);
  return [...byId.values()].sort((a, b) =>
    a.timestamp === b.timestamp
      ? a.id.localeCompare(b.id)
      : a.timestamp - b.timestamp
  );
}

/** The bounded window the front door shows: the newest page of turns. */
export function boundTurns(
  turns: readonly ConversationTurn[],
  limit: number = CONVERSATION_PAGE_SIZE
): readonly ConversationTurn[] {
  if (limit <= 0) return [];
  return turns.length <= limit ? turns : turns.slice(turns.length - limit);
}

/* -------------------------------------------------------------------------- */
/* Streamed updates                                                           */
/* -------------------------------------------------------------------------- */

export interface ConversationUpdate {
  agentId: string;
  contextId: string;
  /** The run the turns belong to. Kept so a later snapshot can reconcile. */
  runId?: string | null;
  turns: readonly ConversationTurn[];
}

/**
 * Absorb a streamed update into the front door.
 *
 * An update for another Agent, or for a context that is not this Agent's
 * primary conversation, is ignored: subordinate work reports beneath the
 * Agent and never writes into its Home.
 */
export function applyConversationUpdate(
  current: readonly ConversationTurn[],
  update: ConversationUpdate,
  target: { agentId: string; primaryContextId: string | null }
): readonly ConversationTurn[] {
  if (target.primaryContextId === null) return current;
  if (update.agentId !== target.agentId) return current;
  if (update.contextId !== target.primaryContextId) return current;
  return mergeTurns(current, update.turns);
}

/* -------------------------------------------------------------------------- */
/* Sending                                                                    */
/* -------------------------------------------------------------------------- */

export interface OutboundMessage {
  localId: string;
  text: string;
  status: 'sending' | 'refused';
  refusal: SendRefusal | null;
  /** When the source accepted it. Null until it does. */
  acceptedAt: number | null;
}

export type OutboxAction =
  /** The operator pressed send. A retry reuses its original localId. */
  | { type: 'send'; localId: string; text: string }
  /** The source accepted it, at this moment on Exawatt's clock. */
  | { type: 'accepted'; localId: string; at: number }
  | { type: 'refused'; localId: string; refusal: SendRefusal }
  /**
   * An authoritative transcript arrived. Anything it already carries is
   * delivered and leaves the outbox; anything it does not carry stays exactly
   * as it was, so a reconnect never resends and never double-posts.
   */
  | { type: 'reconcile'; turns: readonly ConversationTurn[] }
  | { type: 'discard'; localId: string };

export const EMPTY_OUTBOX: readonly OutboundMessage[] = [];

/**
 * True when the source's own record shows this message was received.
 *
 * The obvious rule, that the transcript echoes the operator's own turn back,
 * is wrong against a real Gateway. `chat.history` returns the AGENT's messages
 * and not the operator's: a message sent through the gateway arrives wrapped
 * in an envelope that the history projection strips, so a sent message never
 * appears in the transcript no matter how long anyone waits. Retiring on that
 * echo would leave every sent message pending forever, which reads as "it did
 * not go" for a message that went.
 *
 * Verified live: a message sent to a real coworker was answered, and the
 * transcript afterwards carried the reply alone.
 *
 * So the evidence of receipt is a reply that came AFTER the message was
 * accepted. An echoed operator turn still counts when a source does provide
 * one, since some may, and a matching client id counts wherever it appears.
 */
export function historyCarries(
  turns: readonly ConversationTurn[],
  message: { localId: string; text: string; acceptedAt?: number | null }
): boolean {
  if (
    turns.some(
      turn => turn.clientId != null && turn.clientId === message.localId
    )
  ) {
    return true;
  }
  if (
    turns.some(turn => turn.role === 'operator' && turn.text === message.text)
  ) {
    return true;
  }
  const acceptedAt = message.acceptedAt;
  if (acceptedAt == null) return false;
  return turns.some(
    turn => turn.role === 'agent' && turn.timestamp >= acceptedAt
  );
}

export function outboxReducer(
  state: readonly OutboundMessage[],
  action: OutboxAction
): readonly OutboundMessage[] {
  switch (action.type) {
    case 'send': {
      const existing = state.find(entry => entry.localId === action.localId);
      if (existing) {
        // A retry of the same message. It keeps its identity so the source's
        // own history can tell later whether the first attempt landed.
        return state.map(entry =>
          entry.localId === action.localId
            ? { ...entry, status: 'sending' as const, refusal: null }
            : entry
        );
      }
      return [
        ...state,
        {
          localId: action.localId,
          text: action.text,
          status: 'sending' as const,
          refusal: null,
          acceptedAt: null,
        },
      ];
    }
    case 'accepted':
      // Accepted is not answered. The entry stays until the source's own
      // record shows the coworker received it, which `reconcile` decides;
      // stamping the moment is what lets it tell a reply to THIS message from
      // one that was already there.
      return state.map(entry =>
        entry.localId === action.localId
          ? { ...entry, acceptedAt: action.at }
          : entry
      );
    case 'refused':
      return state.map(entry =>
        entry.localId === action.localId
          ? { ...entry, status: 'refused', refusal: action.refusal }
          : entry
      );
    case 'reconcile':
      return state.filter(entry => !historyCarries(action.turns, entry));
    case 'discard':
      return state.filter(entry => entry.localId !== action.localId);
  }
}

/** Normalize whatever the bridge answered into one closed refusal set. */
export function normalizeSendRefusal(value: unknown): SendRefusal {
  return (SEND_REFUSALS as readonly string[]).includes(value as string) &&
    value !== 'unrecognized'
    ? (value as SendRefusal)
    : 'unrecognized';
}

/* -------------------------------------------------------------------------- */
/* The decision                                                               */
/* -------------------------------------------------------------------------- */

function freshnessOf(connection: RemoteConnectionView): Freshness {
  return {
    state: connection.state,
    marked: connection.stalePresentation,
    badge: connection.stalePresentation ? LAST_KNOWN_BADGE : null,
    line: connection.label,
  };
}

function primaryContextOf(load: ConversationLoad): string | null {
  if (load.kind === 'declared') return load.contextId;
  if (load.kind === 'unread') return load.contextId;
  return null;
}

/** The Agent's own primary conversation, whatever else is on screen. */
export function composerTargetFor(
  input: RemoteAgentInput
): ComposerTarget | null {
  const contextId = primaryContextOf(input.conversation);
  if (contextId === null) return null;
  return {
    contextId,
    agentName: input.agent.name,
    label: FRONT_DOOR_HEADING,
    isPrimaryConversation: true,
  };
}

function composerFor(
  input: RemoteAgentInput,
  target: ComposerTarget | null
): ComposerState {
  if (input.conversation.kind === 'absent') {
    return {
      kind: 'withheld',
      reason: 'no-primary-conversation',
      target: null,
      headline: NO_CONVERSATION_NOTE,
      detail: null,
      action: null,
    };
  }

  if (input.conversation.kind === 'loading' || target === null) {
    // Exawatt does not yet know which context is this Agent's Home. It says
    // only what it is doing about that, and never guesses one.
    const offline = input.connection.state === 'unavailable';
    return {
      kind: 'withheld',
      reason: offline ? 'connection-unavailable' : 'conversation-loading',
      target,
      headline: offline
        ? 'Exawatt is not connected to this source right now'
        : 'Opening the conversation',
      detail: offline ? 'Reconnect to send.' : null,
      action: offline && input.canReconnect ? RECONNECT_ACTION : null,
    };
  }

  if (input.authority !== 'granted') {
    const copy = WRITE_AUTHORITY_COPY[input.authority];
    const reason: ComposerWithheldReason =
      input.authority === 'not-requested'
        ? 'write-access-not-requested'
        : input.authority === 'approval-pending'
          ? 'write-access-awaiting-approval'
          : 'write-access-unobserved';
    let action: ComposerAction | null = null;
    if (input.authority === 'not-requested' && input.canRequestWriteAccess) {
      action = REQUEST_ACCESS_ACTION;
    } else if (input.authority === 'unobserved' && input.canReconnect) {
      action = RECONNECT_ACTION;
    }
    return {
      kind: 'withheld',
      reason,
      target,
      headline: copy.headline,
      detail: copy.detail,
      action,
    };
  }

  if (input.connection.state === 'unavailable') {
    return {
      kind: 'withheld',
      reason: 'connection-unavailable',
      target,
      headline: 'Exawatt is not connected to this source right now',
      detail: 'Reconnect to send.',
      action: input.canReconnect ? RECONNECT_ACTION : null,
    };
  }

  return {
    kind: 'ready',
    target,
    placeholder: `Message ${input.agent.name}`,
  };
}

function frontDoorFor(input: RemoteAgentInput): FrontDoor {
  const load = input.conversation;
  if (load.kind === 'absent') {
    return {
      kind: 'automations-lead',
      heading: AUTOMATIONS_HEADING,
      note: NO_CONVERSATION_NOTE,
    };
  }
  if (load.kind === 'loading') {
    return { kind: 'loading', heading: FRONT_DOOR_HEADING };
  }
  if (load.contextId === null) {
    return { kind: 'loading', heading: FRONT_DOOR_HEADING };
  }
  return {
    kind: 'conversation',
    heading: FRONT_DOOR_HEADING,
    contextId: load.contextId,
    turns: boundTurns(mergeTurns([], load.turns)),
    olderAvailable: load.olderAvailable,
  };
}

function toItems(
  entries: readonly { id: string; title: string; detail: string | null }[]
): readonly WorkSectionItem[] {
  return entries.map(entry => ({
    id: entry.id,
    title: entry.title,
    detail: entry.detail,
    subordinate: true,
  }));
}

function automationItems(
  automations: readonly RemoteAutomation[]
): readonly WorkSectionItem[] {
  return automations.map(automation => ({
    id: automation.id,
    title: automation.name,
    detail: [automation.schedule, automation.lastRun, automation.nextRun]
      .filter((part): part is string => Boolean(part))
      .join(' · '),
    subordinate: true,
  }));
}

function sectionsFor(input: RemoteAgentInput): readonly WorkSection[] {
  const work: WorkSection = {
    id: 'work',
    title: WORK_HEADING,
    items: toItems(input.work.current),
    collapsed: false,
    summary: null,
  };
  const automations: WorkSection = {
    id: 'automations',
    title: AUTOMATIONS_HEADING,
    items: automationItems(input.work.automations),
    collapsed: false,
    summary: null,
  };
  const historyCount = input.work.history.length;
  const history: WorkSection = {
    id: 'history',
    title: HISTORY_HEADING,
    items: toItems(input.work.history),
    collapsed: HISTORY_STARTS_COLLAPSED,
    summary: historyCount === 0 ? null : `${historyCount} records`,
  };

  // Automations lead only when the Agent has no conversation to open.
  const ordered =
    input.conversation.kind === 'absent'
      ? [automations, work, history]
      : [work, automations, history];
  // A section with nothing in it is not rendered. An empty Work heading would
  // be a claim about the Agent that Exawatt has no evidence for.
  return ordered.filter(section => section.items.length > 0);
}

/** The whole surface's state, decided once. */
export function describeRemoteAgent(
  input: RemoteAgentInput
): RemoteAgentPresentation {
  const target = composerTargetFor(input);
  return {
    frontDoor: frontDoorFor(input),
    composer: composerFor(input, target),
    freshness: freshnessOf(input.connection),
    sections: sectionsFor(input),
    subordinateOpen: Boolean(input.viewing),
  };
}
