import {
  selectSpatialDirectionalTarget,
  type SpatialBoardDelegationUnit,
  type SpatialBoardLayout,
  type SpatialBoardTarget,
  type SpatialSelectionDirection,
} from '@exawatt/ui-model';

export interface BoardArrowStep {
  /** Where the walk lands, or null when the board has nothing to walk. */
  target: SpatialBoardTarget | null;
  /** Agents an extending step adds to the working set, else null. */
  extend: string[] | null;
}

/**
 * One arrow press on the board (decision `0024`'s walk and its
 * extend-selection modifier), as pure policy.
 *
 * A plain arrow is navigation: it may cross into a neighbouring Project, and
 * the focused Project follows the Agent it lands on, visibly, with the camera.
 * Shift+arrow is selection: it adds the walk's Agents to the working set, and
 * selection never moves focus between Projects. Below Fleet altitude the
 * extending walk therefore stays inside the focused Project and holds at its
 * edge, so releasing the set leaves the operator in the Project they built it
 * in. A working set that spans Projects is built from Fleet altitude, where
 * no Project holds focus, or with a band or a Project toggle.
 */
export function boardArrowStep({
  layout,
  units,
  selectedTarget,
  direction,
  extend,
}: {
  layout: SpatialBoardLayout;
  units: readonly SpatialBoardDelegationUnit[];
  selectedTarget: SpatialBoardTarget | null;
  direction: SpatialSelectionDirection;
  extend: boolean;
}): BoardArrowStep {
  const withinProjectId =
    extend && layout.altitude !== 'fleet' ? layout.focusedProjectId : null;
  const target = selectSpatialDirectionalTarget(
    layout,
    units,
    selectedTarget,
    direction,
    { withinProjectId }
  );
  if (!extend) return { target, extend: null };
  // Where the walk stood and where it lands both join the working set. A
  // child stands for its parent, the unit Direct addresses (ENG-023 D2).
  const reached =
    target?.kind === 'agent'
      ? target.agentId
      : target?.kind === 'child'
        ? target.parentAgentId
        : null;
  if (!reached) return { target, extend: null };
  return {
    target,
    extend: layout.selectedAgentId
      ? [...new Set([layout.selectedAgentId, reached])]
      : [reached],
  };
}
