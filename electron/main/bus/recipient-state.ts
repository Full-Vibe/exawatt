/**
 * What a recipient is doing, read from the existing turn truth (ENG-023 D4,
 * D7) — never a second guess at it.
 *
 * The bus asks one question of a Session: may I type into it now?
 * `starting` is a program that has not drawn its input yet; `running`
 * is its own turn generating; `blocked` is an operator gate open (a question,
 * a permission dialog), into which a typed message could become an answer, so
 * nothing is typed; `ready` is everything else; `ended` is a dead process.
 * Background children do not make a parent `running`: the parent's own turn
 * is what a typed message would interrupt.
 *
 * Changes are announced as they happen, so a held message is released by the
 * event that ended the turn, not by polling; a reported turn start is
 * announced too, which is how a queued message learns its turn began.
 */
import { EventEmitter } from 'events';
import { attentionNeedsOperator } from '@exawatt/core';
import type { PtyAttention } from '@exawatt/core/desktop-bridge';
import type { RecipientState } from './transports/types';

export interface RecipientFacts {
  exited: boolean;
  /** Its terminal program has not drawn its input yet. */
  starting: boolean;
  attention: PtyAttention | null;
  /** The harness's own report of its turn, when it reports one. */
  reportedOwnTurn: 'generating' | 'available' | 'unknown' | null;
  blockedOn: string | null;
  request?: 'blocking' | 'working';
  /** Byte inference: output inside the working window. */
  working: boolean;
}

export function recipientState(facts: RecipientFacts): RecipientState {
  if (facts.exited) return 'ended';
  if (facts.starting) return 'starting';
  const attention = facts.attention;
  if (
    attention &&
    attentionNeedsOperator(attention) &&
    attention.request !== 'working' &&
    attention.request !== 'unknown'
  )
    return 'blocked';
  if (facts.blockedOn && facts.request !== 'working') return 'blocked';
  if (facts.reportedOwnTurn === 'generating') return 'running';
  if (facts.reportedOwnTurn === 'available') return 'ready';
  return facts.working ? 'running' : 'ready';
}

export interface RecipientStateSource {
  state(ptyId: string): RecipientState;
  /** `state`: the state may have changed. `turn-start`: a turn began. */
  subscribe(
    listener: (ptyId: string, change: 'state' | 'turn-start') => void
  ): () => void;
}

/** The turn truth this reads, as two functions so the source stays pure:
 *  the facts for one Session now, and a subscription to anything that may
 *  change them (`reportedTurnStart` when a harness reported a new turn). */
interface TurnTruthMonitors {
  facts(ptyId: string): RecipientFacts;
  watch(
    listener: (ptyId: string, reportedTurnStart: boolean) => void
  ): () => void;
}

export function createRecipientStateSource(
  monitors: TurnTruthMonitors
): RecipientStateSource & { dispose(): void } {
  const changes = new EventEmitter();
  const state = (ptyId: string): RecipientState =>
    recipientState(monitors.facts(ptyId));
  // A byte-inferred turn start is a ready-to-running edge; a reported one
  // arrives flagged. Track the last state per Session for the edge.
  const last = new Map<string, RecipientState>();
  const unwatch = monitors.watch((ptyId, reportedTurnStart) => {
    const now = state(ptyId);
    const before = last.get(ptyId);
    if (now === 'ended') last.delete(ptyId);
    else last.set(ptyId, now);
    changes.emit('change', ptyId, 'state');
    if (
      reportedTurnStart ||
      (now === 'running' && before !== undefined && before !== 'running')
    )
      changes.emit('change', ptyId, 'turn-start');
  });
  return {
    state: ptyId => {
      const now = state(ptyId);
      if (!last.has(ptyId) && now !== 'ended') last.set(ptyId, now);
      return now;
    },
    subscribe(listener) {
      changes.on('change', listener);
      return () => changes.off('change', listener);
    },
    dispose() {
      unwatch();
      changes.removeAllListeners();
    },
  };
}
