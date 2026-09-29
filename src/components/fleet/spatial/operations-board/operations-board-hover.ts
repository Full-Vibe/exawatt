/**
 * Pointer candidate state: which zone, Agent, or delegated child the cursor
 * is over or pressing.
 *
 * **Why this is a store and not canvas state.** Hover used to be four
 * `useState`s at the canvas root, so every pointer enter/leave of any piece
 * re-rendered every layer under the canvas and rebuilt their full instance
 * lists -- the same class of mid-flight React task the label tier was moved
 * out of root state to evict (see `operations-board-label-tier.ts`). Here the
 * DOM controls and mesh handlers write, and each layer subscribes to exactly
 * the slice it draws: an Agent hover re-renders the Agent layer, a zone hover
 * the zone layer, and nothing else.
 */

import { useSyncExternalStore } from 'react';

interface BoardHoverState {
  zoneId: string | null;
  agentId: string | null;
  pressedAgentId: string | null;
  delegationId: string | null;
}

const AT_REST: BoardHoverState = {
  zoneId: null,
  agentId: null,
  pressedAgentId: null,
  delegationId: null,
};

export interface BoardHoverStore {
  /** Current state; a new object only when a field actually changed. */
  get(): BoardHoverState;
  subscribe(listener: () => void): () => void;
  setZone(zoneId: string | null): void;
  setAgent(agentId: string | null): void;
  setPressed(agentId: string | null): void;
  setDelegation(unitId: string | null): void;
}

export function createBoardHoverStore(): BoardHoverStore {
  let state = AT_REST;
  const listeners = new Set<() => void>();
  const set = (patch: Partial<BoardHoverState>) => {
    const key = Object.keys(patch)[0] as keyof BoardHoverState;
    if (state[key] === patch[key]) return;
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  };
  return {
    get: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setZone: zoneId => set({ zoneId }),
    setAgent: agentId => set({ agentId }),
    setPressed: pressedAgentId => set({ pressedAgentId }),
    setDelegation: delegationId => set({ delegationId }),
  };
}

/** Subscribe to one slice; the component re-renders only when it changes. */
export function useBoardHoverSlice<T>(
  store: BoardHoverStore,
  selector: (state: BoardHoverState) => T
): T {
  return useSyncExternalStore(
    store.subscribe,
    () => selector(store.get()),
    () => selector(AT_REST)
  );
}
