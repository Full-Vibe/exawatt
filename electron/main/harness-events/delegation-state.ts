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
  startedAt: number;
}

export interface SessionDelegation {
  /**
   * The Session's OWN turn. `generating` between a submitted prompt and the
   * provider finishing its reply; `available` otherwise — including while its
   * children are still working, which is the whole point.
   */
  ownTurn: 'generating' | 'available';
  /** live children, oldest first */
  children: DelegatedChild[];
}

export type HarnessEvent =
  | { kind: 'turn-start' }
  | { kind: 'turn-end' }
  | {
      kind: 'child-start';
      childId: string;
      agentType: string | null;
      at: number;
    }
  | { kind: 'child-end'; childId: string };

export const EMPTY_DELEGATION: SessionDelegation = {
  ownTurn: 'available',
  children: [],
};

/** The Session has outstanding delegated work — "the team is working". */
export function delegationBusy(
  delegation: SessionDelegation | null | undefined
): boolean {
  return !!delegation && delegation.children.length > 0;
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
  state: SessionDelegation,
  event: HarnessEvent
): SessionDelegation {
  switch (event.kind) {
    case 'turn-start':
      if (state.ownTurn === 'generating') return state;
      return { ...state, ownTurn: 'generating' };

    case 'turn-end':
      if (state.ownTurn === 'available') return state;
      return { ...state, ownTurn: 'available' };

    case 'child-start': {
      // A repeated start for a known child keeps the ORIGINAL startedAt: the
      // elapsed time an operator reads must not reset because a hook retried.
      if (state.children.some(child => child.id === event.childId))
        return state;
      return {
        ...state,
        children: [
          ...state.children,
          {
            id: event.childId,
            agentType: event.agentType,
            startedAt: event.at,
          },
        ],
      };
    }

    case 'child-end': {
      const remaining = state.children.filter(
        child => child.id !== event.childId
      );
      // Unknown child: Exawatt may have attached mid-flight, or missed the
      // start. Ignoring it is right — inventing a child to remove is not.
      if (remaining.length === state.children.length) return state;
      return { ...state, children: remaining };
    }
  }
}
