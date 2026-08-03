/**
 * Delegation state (ENG-023 D1) — the two-fact model.
 *
 * A Session that delegated work is not one Agent, and "the parent is busy" is
 * NOT the same fact as "the team is busy". Measured on a real Session: a parent
 * finished its own turn and sat available for 74 seconds while its child kept
 * working. Collapsing those into one status is why a delegating tab currently
 * reports "result ready — turn finished" while four children are mid-flight.
 *
 * So the two facts stay independent here and are composed only at the surface,
 * exactly as `docs/product/reference/agent-state.md` requires. Pure reducer, no
 * Electron and no IO: the harness adapter normalizes provider events into
 * `HarnessEvent` and this module owns what they mean.
 */

/** One live delegated child. Deliberately richer than D1's dots need: D2's
 *  per-child rail enriches these rows rather than rebuilding the model. */
export interface DelegatedChild {
  /** harness-assigned child id — opaque, never shown to the operator */
  id: string;
  /** the source's own agent kind ("Explore", "general-purpose", …) */
  agentType: string | null;
  /**
   * The operator-legible spawn label from `PreToolUse[Agent|Task]` (ENG-023
   * D3a), adopted by correlation at child-start. `null` when the label was
   * never observed or correlation failed — a missing label renders as absent,
   * never invented. Labels only: results never enter this record.
   */
  description: string | null;
  startedAt: number;
}

/**
 * A spawn label observed before its child's `SubagentStart` (ENG-023 D3a).
 * `SubagentStart` does not carry the spawning `tool_use_id`, so labels stage
 * here until a child-start adopts one by agent-type match, oldest first.
 */
export interface PendingChildLabel {
  /** dedupe key — hook delivery is at-least-once */
  toolUseId: string;
  agentType: string | null;
  description: string;
  at: number;
}

/** Bounds the staging list. A fan-out beyond this loses the NEWEST labels
 *  (see the cap rule at the `child-label` case): later children go unlabeled
 *  rather than the whole cohort shifting onto its neighbors' labels. */
const PENDING_LABEL_CAP = 16;

/** Bounds the two tombstone lists. Both exist to absorb at-least-once
 *  delivery and HTTP reordering; 64 comfortably covers a turn's cohort. */
const TOMBSTONE_CAP = 64;

function remember(list: readonly string[], id: string): string[] {
  const next = [...list, id];
  return next.length > TOMBSTONE_CAP
    ? next.slice(next.length - TOMBSTONE_CAP)
    : next;
}

/**
 * Why the Agent stopped and handed control back to the operator (ENG-023 D4).
 * Kept as a reason rather than a boolean because Terminal and Sessions want to
 * say WHICH gate is open, and because the reasons unblock differently.
 */
export type SessionBlockedReason = 'question' | 'permission' | 'elicitation';

export interface SessionDelegation {
  /**
   * The Session's OWN turn. `generating` between a submitted prompt and the
   * provider finishing its reply; `available` otherwise — including while its
   * children are still working, which is the whole point.
   */
  ownTurn: 'generating' | 'available';
  /**
   * The operator gate the Agent is sitting behind, or `null` when it is not
   * waiting on a human (ENG-023 D4).
   *
   * INDEPENDENT of `ownTurn` on purpose. An Agent blocked on `AskUserQuestion`
   * is still `generating` — the turn has not ended and `Stop` has not fired —
   * so collapsing the two would force a choice between "working" and "needs
   * you" when the truth is both. `reference/agent-state.md` calls this the
   * `Asked`/`Blocked` Event and requires attention and turn state to stay
   * separate channels; this is that separation in the reported model.
   */
  blockedOn: SessionBlockedReason | null;
  /** live children, oldest first */
  children: DelegatedChild[];
}

/**
 * The reducer's full state: the published record plus internal bookkeeping.
 * Nothing below `children` leaves the main process — the monitor projects it
 * away before anything is broadcast, so surfaces cannot come to depend on it.
 */
export interface DelegationLedger extends SessionDelegation {
  pending: PendingChildLabel[];
  /**
   * `tool_use_id`s whose labels were already adopted by a child this turn.
   * Hook delivery is at-least-once: without this, a REDELIVERED spawn label
   * re-stages after adoption and the next same-type sibling adopts a label
   * that belongs to someone else — an invented label, the one thing the
   * correlation must never produce.
   */
  adoptedLabelIds: string[];
  /**
   * Child ids that already ended. `SubagentStart` and `SubagentStop` travel
   * as separate HTTP POSTs, so a stop can arrive BEFORE its start (or a start
   * can be redelivered after the stop). Without this tombstone the late start
   * resurrects a child nothing will ever remove, and the Session reads "team
   * working" until its process exits. Cleared at turn-start: a genuinely
   * resumed child in a LATER turn re-admits; within the same cohort a
   * reappearing id is treated as the duplicate it almost certainly is.
   */
  endedChildIds: string[];
}

export type HarnessEvent =
  | { kind: 'turn-start' }
  | { kind: 'turn-end' }
  | { kind: 'blocked'; reason: SessionBlockedReason }
  /** Releases only a gate of this reason; omit to release whatever is open. */
  | { kind: 'unblocked'; reason?: SessionBlockedReason }
  /** A spawn label from the parent, ahead of its child's start (D3a). */
  | {
      kind: 'child-label';
      toolUseId: string;
      agentType: string | null;
      description: string;
      at: number;
    }
  | {
      kind: 'child-start';
      childId: string;
      agentType: string | null;
      at: number;
    }
  | { kind: 'child-end'; childId: string };

export const EMPTY_DELEGATION: SessionDelegation = {
  ownTurn: 'available',
  blockedOn: null,
  children: [],
};

export const EMPTY_LEDGER: DelegationLedger = {
  ...EMPTY_DELEGATION,
  pending: [],
  adoptedLabelIds: [],
  endedChildIds: [],
};

/**
 * Is there anything reported worth publishing?
 *
 * The rule lives HERE and nowhere else. It briefly existed in both the main
 * process and the renderer, and they drifted: main retained settled records
 * forever while the renderer dropped them, so after a turn ended the ⌘K
 * switcher read "result ready" from the reported fact while the tab strip read
 * "working" from inference. One fact, two answers. A non-live record is
 * published as `null`, which hands the question back to inference on every
 * surface at the same instant.
 */
export function delegationIsLive(
  delegation: SessionDelegation | null | undefined
): boolean {
  return (
    !!delegation &&
    (delegation.children.length > 0 ||
      delegation.ownTurn === 'generating' ||
      !!delegation.blockedOn)
  );
}

/** The Session has outstanding delegated work — "the team is working". */
export function delegationBusy(
  delegation: SessionDelegation | null | undefined
): boolean {
  return !!delegation && delegation.children.length > 0;
}

/** The Agent reported that it is waiting on the operator (ENG-023 D4). */
export function delegationBlocked(
  delegation: SessionDelegation | null | undefined
): boolean {
  return !!delegation?.blockedOn;
}

/**
 * Apply one normalized harness event.
 *
 * Returns the SAME reference when nothing changed, so callers can skip an IPC
 * broadcast on a no-op without diffing. Every transition is idempotent: hook
 * delivery is at-least-once in principle, a provider may repeat a lifecycle
 * event, and a child that ends twice must not drive the count negative.
 */
export function applyHarnessEvent(
  state: DelegationLedger,
  event: HarnessEvent
): DelegationLedger {
  switch (event.kind) {
    // A turn boundary in EITHER direction also closes any open operator gate.
    // A new prompt means the last question was answered; a finished turn means
    // the Agent is no longer sitting behind one. Without this, a gate whose own
    // release event went missing would latch "needs you" forever — the exact
    // failure mode that makes a status indicator untrustworthy.
    //
    // Both boundaries also clear label bookkeeping: a label whose child never
    // started within the turn that spawned it has no future adopter, and
    // letting it survive would mislabel the NEXT turn's first child. The
    // ended-child tombstones clear only at turn-START — children routinely
    // outlive the parent's turn-end (the measured 74s case), so their
    // duplicate-absorbing memory must too.
    case 'turn-start':
      if (
        state.ownTurn === 'generating' &&
        !state.blockedOn &&
        state.pending.length === 0 &&
        state.adoptedLabelIds.length === 0 &&
        state.endedChildIds.length === 0
      )
        return state;
      return {
        ...state,
        ownTurn: 'generating',
        blockedOn: null,
        pending: [],
        adoptedLabelIds: [],
        endedChildIds: [],
      };

    case 'turn-end':
      if (
        state.ownTurn === 'available' &&
        !state.blockedOn &&
        state.pending.length === 0 &&
        state.adoptedLabelIds.length === 0
      )
        return state;
      return {
        ...state,
        ownTurn: 'available',
        blockedOn: null,
        pending: [],
        adoptedLabelIds: [],
      };

    // FIRST report of a gate wins until something releases it. Measured on a
    // real Claude Code 2.1.220 session: one `AskUserQuestion` reports twice —
    // `PreToolUse[AskUserQuestion]`, then `Notification[permission_prompt]`
    // six seconds later. Letting the second overwrite the reason would strand
    // the gate, because the release that eventually arrives
    // (`PostToolUse[AskUserQuestion]`) is scoped to the reason the FIRST
    // report set. One wait is one gate, however many times it is announced.
    case 'blocked':
      if (state.blockedOn) return state;
      return { ...state, blockedOn: event.reason };

    // Releases are reason-SCOPED so a release that belongs to one gate can
    // never close a different one. The permission backstop (`PostToolBatch`)
    // is the reason this matters: it is the only release whose ordering
    // against an open question gate is not guaranteed by the harness, and
    // scoping makes that ordering irrelevant instead of load-bearing.
    case 'unblocked':
      if (!state.blockedOn) return state;
      if (event.reason && state.blockedOn !== event.reason) return state;
      return { ...state, blockedOn: null };

    // Stage a spawn label until its child starts (D3a). Deduped by
    // tool_use_id against BOTH the staging list and the already-adopted set:
    // delivery is at-least-once, and a duplicate arriving after adoption
    // must vanish, not re-stage onto the next sibling. At the cap the
    // INCOMING label is the one dropped — correlation is positional, so
    // evicting the oldest would shift every later child onto its neighbor's
    // label, while dropping the newest merely leaves the overflow unlabeled.
    case 'child-label': {
      if (
        state.pending.some(label => label.toolUseId === event.toolUseId) ||
        state.adoptedLabelIds.includes(event.toolUseId)
      )
        return state;
      if (state.pending.length >= PENDING_LABEL_CAP) return state;
      return {
        ...state,
        pending: [
          ...state.pending,
          {
            toolUseId: event.toolUseId,
            agentType: event.agentType,
            description: event.description,
            at: event.at,
          },
        ],
      };
    }

    case 'child-start': {
      // A repeated start for a known child keeps the ORIGINAL startedAt: the
      // elapsed time an operator reads must not reset because a hook retried.
      if (state.children.some(child => child.id === event.childId))
        return state;
      // A start for a child that already ENDED is a duplicate or a reordered
      // POST — admitting it would create a child nothing ever removes.
      if (state.endedChildIds.includes(event.childId)) return state;
      // Adopt the oldest staged label whose agent type matches; with unknown
      // types on either side, the oldest label at all. No match means no
      // description — absent, never a guess from the wrong spawn.
      const matched = state.pending.findIndex(
        label =>
          !!label.agentType &&
          !!event.agentType &&
          label.agentType === event.agentType
      );
      const adoptedIndex =
        matched !== -1
          ? matched
          : state.pending.findIndex(
              label => !label.agentType || !event.agentType
            );
      const adopted = adoptedIndex === -1 ? null : state.pending[adoptedIndex];
      return {
        ...state,
        pending: adopted
          ? state.pending.filter((_, index) => index !== adoptedIndex)
          : state.pending,
        adoptedLabelIds: adopted
          ? remember(state.adoptedLabelIds, adopted.toolUseId)
          : state.adoptedLabelIds,
        children: [
          ...state.children,
          {
            id: event.childId,
            agentType: event.agentType,
            description: adopted?.description ?? null,
            startedAt: event.at,
          },
        ],
      };
    }

    case 'child-end': {
      // Tombstone FIRST, known child or not: a stop can outrun its start on
      // the wire, and the memory is what keeps the late start from
      // resurrecting the child. The `children` array reference is preserved
      // when only the tombstone changes, so nothing is broadcast for it.
      const alreadyEnded = state.endedChildIds.includes(event.childId);
      const remaining = state.children.filter(
        child => child.id !== event.childId
      );
      if (remaining.length === state.children.length) {
        return alreadyEnded
          ? state
          : {
              ...state,
              endedChildIds: remember(state.endedChildIds, event.childId),
            };
      }
      return {
        ...state,
        children: remaining,
        endedChildIds: alreadyEnded
          ? state.endedChildIds
          : remember(state.endedChildIds, event.childId),
      };
    }
  }
}
