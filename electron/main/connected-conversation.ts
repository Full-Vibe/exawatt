import { createHash } from 'node:crypto';
import type {
  AgentSourceTopologySnapshot,
  SourceContextRecord,
} from '@exawatt/core';
import { MAX_ID_LENGTH, isRecord, validText } from './untrusted-input';

/**
 * One coworker's conversation, as data (ENG-033 H2).
 *
 * Everything here is pure: an untrusted `chat.history` payload in, bounded
 * turns out, plus the one rule that decides which of a source's contexts a
 * conversation even is. No session, no connection, no clock.
 *
 * Two things live here that used to live in three places each. The budgets a
 * conversation is bounded by are a single table rather than numbers spread
 * across the surfaces that spend them; and "which context is this Agent's
 * primary conversation" is one predicate, where the runtime asked it twice and
 * the Gateway session asked it a third time with the role string written out by
 * hand. That last one is load-bearing: H2 promises a message can only ever
 * reach a coworker's primary conversation, and a promise with three
 * implementations is three chances to address a cron run instead.
 */

/* ---- Budgets ------------------------------------------------------------- */

/** The most turns one read returns, however many the source retained. */
export const MAX_CONVERSATION_TURNS = 200;
/** What a caller gets when it names no page size. */
export const DEFAULT_CONVERSATION_TURNS = 50;
/** One turn's character budget. A longer turn is clipped and says so. */
export const MAX_TURN_CHARACTERS = 4_000;
/** The page's character budget, spent from the newest turn backward. */
export const MAX_CONVERSATION_CHARACTERS = 60_000;
/** The longest message Exawatt hands to a Gateway. */
export const MAX_MESSAGE_CHARACTERS = 32_000;
/** One streamed update's character budget. */
export const MAX_UPDATE_CHARACTERS = 2_000;
/** How many live updates one run forwards before the renderer re-reads. */
export const MAX_UPDATES_PER_RUN = 400;

/* ---- The primary conversation -------------------------------------------- */

/**
 * The one place a source's context is judged to be a coworker's conversation.
 *
 * The role comes off the adapted snapshot rather than off the Gateway's own
 * label for the session, because a live probe found a Gateway calling a cron
 * session `direct`. Only the adapter decides what a context is, and only this
 * decides which of them Exawatt will speak into.
 */
export function isPrimaryConversation(context: SourceContextRecord): boolean {
  return context.roles.includes('primary-conversation');
}

/**
 * That Agent's primary conversation on this snapshot, or null when the source
 * declares none. Null is an answer: one of the operator's own Agents is
 * automations only and has never been conversed with, and fabricating a Home
 * for it would render as silence from someone nobody has spoken to.
 */
export function findPrimaryConversation(
  snapshot: AgentSourceTopologySnapshot,
  nativeAgentId: string
): SourceContextRecord | null {
  return (
    snapshot.contexts.find(
      context =>
        context.nativeAgentId === nativeAgentId &&
        isPrimaryConversation(context)
    ) ?? null
  );
}

/* ---- Turns --------------------------------------------------------------- */

/**
 * Who said it. The product vocabulary, not the protocol's: Exawatt says
 * Conversation, and the two voices in one are the operator and the coworker.
 */
export type ConversationRole = 'operator' | 'agent';

export interface ConversationTurnView {
  /**
   * Stable identity, derived from the turn's own content and its position
   * among identical siblings rather than minted per read. An authoritative
   * resnapshot must produce the same id for the same turn, because that is
   * what lets a reconnect reconcile instead of duplicating.
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
  /** Turns to return, newest backward. Clamped to `MAX_CONVERSATION_TURNS`. */
  limit?: number;
  /** Page further back: the turns older than this one. */
  beforeTurnId?: string;
}

/**
 * One turn's stable id.
 *
 * A digest of the address, the voice, the moment, and the exact words, plus
 * which repeat it is among identical siblings. Deliberately derived rather
 * than minted: the same turn read twice, or read again after a reconnect,
 * must carry the same id so the renderer reconciles instead of duplicating.
 * It carries no hostname, no native session key in the clear, and it is safe
 * in a URL.
 */
function conversationTurnId(fingerprint: string, occurrence: number): string {
  const digest = createHash('sha256')
    .update(`${fingerprint}\0${occurrence}`)
    .digest('hex');
  return `turn-${digest.slice(0, 24)}`;
}

/**
 * Read one `chat.history` row. Fails closed per row, exactly as the projection
 * plan does: one malformed entry costs that entry, never the transcript.
 */
function readConversationTurn(
  value: unknown,
  contextId: string,
  seen: Map<string, number>
): ConversationTurnView | null {
  if (!isRecord(value)) return null;
  const role: ConversationRole | null =
    value.role === 'user'
      ? 'operator'
      : value.role === 'assistant'
        ? 'agent'
        : null;
  if (role === null) return null;
  if (typeof value.content !== 'string') return null;
  const content = value.content;
  const at =
    typeof value.timestamp === 'number' && Number.isFinite(value.timestamp)
      ? value.timestamp
      : 0;
  const fingerprint = [contextId, role, String(at), content].join('\0');
  const occurrence = (seen.get(fingerprint) ?? 0) + 1;
  seen.set(fingerprint, occurrence);
  return {
    id: conversationTurnId(fingerprint, occurrence),
    role,
    text: content.slice(0, MAX_TURN_CHARACTERS),
    at,
    runId: validText(value.runId, MAX_ID_LENGTH) ? value.runId : null,
    clipped: content.length > MAX_TURN_CHARACTERS,
  };
}

/**
 * The `chat.history` payload as turns, in the order the source retains them.
 *
 * Exawatt does not re-sort by timestamp. The source owns the order of its own
 * conversation, and a clock Exawatt does not own is the wrong authority to
 * rearrange someone's words by.
 */
export function readTranscript(
  payload: unknown,
  contextId: string
): ConversationTurnView[] {
  if (!isRecord(payload)) return [];
  const messages = payload.messages;
  if (!Array.isArray(messages)) return [];
  const seen = new Map<string, number>();
  const turns: ConversationTurnView[] = [];
  for (const row of messages.slice(0, MAX_CONVERSATION_TURNS + 1)) {
    const turn = readConversationTurn(row, contextId, seen);
    if (turn) turns.push(turn);
  }
  return turns;
}

/**
 * Page from the newest turn backward, and say when there is more.
 *
 * Two budgets apply at once, turns and characters, and whichever binds first
 * sets `hasMore`. Reading backward is what makes the bound honest: the turns
 * an operator most needs are the recent ones, so a clipped page loses the
 * oldest end and admits it rather than losing the newest end silently.
 */
export function boundConversation(
  all: readonly ConversationTurnView[],
  request: ConversationRequest = {}
): {
  turns: ConversationTurnView[];
  hasMore: boolean;
  characterCount: number;
} {
  const requested =
    typeof request.limit === 'number' && Number.isFinite(request.limit)
      ? Math.floor(request.limit)
      : DEFAULT_CONVERSATION_TURNS;
  const limit = Math.max(1, Math.min(MAX_CONVERSATION_TURNS, requested));

  let window = all;
  if (validText(request.beforeTurnId, MAX_ID_LENGTH)) {
    const index = all.findIndex(turn => turn.id === request.beforeTurnId);
    // A cursor this page no longer holds reads from the newest end rather
    // than answering nothing, so a stale cursor never looks like an empty
    // conversation.
    if (index >= 0) window = all.slice(0, index);
  }

  const newestFirst: ConversationTurnView[] = [];
  let characterCount = 0;
  for (let index = window.length - 1; index >= 0; index -= 1) {
    const turn = window[index];
    if (newestFirst.length >= limit) break;
    if (
      newestFirst.length > 0 &&
      characterCount + turn.text.length > MAX_CONVERSATION_CHARACTERS
    ) {
      break;
    }
    newestFirst.push(turn);
    characterCount += turn.text.length;
  }
  newestFirst.reverse();
  return {
    turns: newestFirst,
    hasMore: newestFirst.length < window.length,
    characterCount,
  };
}
