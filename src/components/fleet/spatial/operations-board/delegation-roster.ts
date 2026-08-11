import {
  SPATIAL_DELEGATION_UNIT_CEILING,
  type SpatialBoardDelegationUnit,
  type SpatialBoardPiece,
} from '@exawatt/ui-model';

/**
 * Lifecycle policy for delegated child units (ENG-004 V3.4 / ENG-023 D3c).
 *
 * The R3F layer owns material and transforms only; everything that can be
 * reasoned about without a GPU lives here, so the roster diff and the motion
 * curve are unit-testable and the frame loop stays allocation-free.
 */
export const DELEGATION_MOTION = {
  /** Critically damped settle, no bounce (D3c brief: 450–650ms). */
  spawnSeconds: 0.55,
  /** The exit finishes faster than the entrance (240–320ms). */
  stopSeconds: 0.28,
  /** Cohort spawns stagger, with a total cap so a wide fan-out still feels
   *  like one event rather than a queue draining. */
  staggerSeconds: 0.055,
  maxStaggerSeconds: 0.33,
  /** A unit begins this fraction of its final size at the parent's edge. */
  spawnScaleFloor: 0.18,
  /** Peak of the single arrival overshoot, as a fraction of the travel. Small
   *  enough to read as momentum rather than a bounce. */
  arrivalOvershoot: 0.06,
  /**
   * Instance-buffer size. Derived from the model's own ceiling rather than
   * guessed: drei silently no-ops writes past `limit`, so a hardcoded number
   * that drifts below the board's piece budget loses units with no error.
   * Exits can briefly coexist with arrivals, hence the doubling.
   */
  instanceLimit: SPATIAL_DELEGATION_UNIT_CEILING * 2,
} as const;

/** Grace beyond the exit duration before a departed unit is dropped. */
export const DELEGATION_EXIT_SWEEP_MS =
  DELEGATION_MOTION.stopSeconds * 1000 + 60;

/**
 * When the nth unit of a cohort has finished travelling and may take its status
 * light. The light is drawn by the shared D40 layer at the unit's RESTING slot,
 * so granting it early would park a light at the destination while the unit is
 * still in flight. Per-unit rather than per-cohort, so lights come up as each
 * worker lands instead of all at once after the slowest one.
 */
export function delegationSettleMs(index: number): number {
  return (
    (DELEGATION_MOTION.spawnSeconds + delegationSpawnDelaySeconds(index)) * 1000
  );
}

export interface DelegationRosterEntry {
  unit: SpatialBoardDelegationUnit;
  exiting: boolean;
}

export function easeOutCubic(value: number): number {
  return 1 - Math.pow(1 - value, 3);
}

/**
 * Arrival curve for a spawning child (operator, 2026-08-10: "gravitational
 * physics keeping them close together" — delivered at lifecycle time rather
 * than as ambient drift).
 *
 * A single soft overshoot past the slot, then settle: the unit reads as pulled
 * into orbit instead of sliding to a stop. This amends D3c's "no bounce/elastic
 * overshoot" clause, which was written to forbid decorative springiness; the
 * overshoot here is one small excursion, not an oscillation, and it is the
 * physical read the operator asked for.
 */
export function delegationArrivalEase(value: number): number {
  const clamped = Math.min(1, Math.max(0, value));
  const eased = easeOutCubic(clamped);
  // Fades in from nothing and back to nothing, so the curve still starts at 0
  // and ends exactly at 1 — a unit never rests off its slot.
  return eased + DELEGATION_MOTION.arrivalOvershoot * Math.sin(Math.PI * clamped);
}

/** Stagger for the nth unit arriving under one parent, capped in total. */
export function delegationSpawnDelaySeconds(index: number): number {
  return Math.min(
    Math.max(0, index) * DELEGATION_MOTION.staggerSeconds,
    DELEGATION_MOTION.maxStaggerSeconds
  );
}

/** Body scale for an eased 0→1 progress: emerges small, settles at full size. */
export function delegationBodyScale(size: number, eased: number): number {
  return (
    size *
    (DELEGATION_MOTION.spawnScaleFloor +
      (1 - DELEGATION_MOTION.spawnScaleFloor) * eased)
  );
}

/**
 * The exiting set after a roster change. A unit that stops being reported is
 * retained just long enough to retract along its tether; one that reappears
 * before the sweep is reclaimed rather than animated twice.
 *
 * Reduced motion keeps identical topology and census with no travel, so a
 * departure is simply gone on the next frame.
 */
export function nextDelegationExits(
  currentExits: readonly SpatialBoardDelegationUnit[],
  previousUnits: readonly SpatialBoardDelegationUnit[],
  nextUnits: readonly SpatialBoardDelegationUnit[],
  reduced: boolean
): {
  exits: SpatialBoardDelegationUnit[];
  departed: SpatialBoardDelegationUnit[];
  changed: boolean;
} {
  if (reduced) {
    return {
      exits: [],
      departed: [],
      changed: currentExits.length > 0,
    };
  }
  const liveIds = new Set(nextUnits.map(unit => unit.id));
  const departed = previousUnits.filter(unit => !liveIds.has(unit.id));
  const kept = currentExits.filter(unit => !liveIds.has(unit.id));
  const known = new Set(kept.map(unit => unit.id));
  const added = departed.filter(unit => !known.has(unit.id));
  const changed = added.length > 0 || kept.length !== currentExits.length;
  // Only the changed branch allocates: an unchanged roster hands back the same
  // array so React state and the render memo both stay put.
  return {
    exits: changed ? [...kept, ...added] : (currentExits as SpatialBoardDelegationUnit[]),
    departed,
    changed,
  };
}

/** Everything the layer draws this frame: live units first, then exits. */
export function delegationRoster(
  units: readonly SpatialBoardDelegationUnit[],
  exits: readonly SpatialBoardDelegationUnit[]
): DelegationRosterEntry[] {
  const roster: DelegationRosterEntry[] = [];
  for (const unit of units) roster.push({ unit, exiting: false });
  for (const unit of exits) roster.push({ unit, exiting: true });
  return roster;
}

/**
 * A settled child rendered as a board piece, so the D40 status layer draws its
 * Active light through exactly the same instanced draws as a parent's. This is
 * what makes a delegated child read as a unit rather than a silhouette, and
 * routing it through the existing layer — instead of a parallel one — is what
 * keeps it the SAME light rather than a lookalike, at no extra draw call.
 *
 * A live child is working by definition: that is what the source reporting it
 * means, and D3b already forces `working` for delegated children. Overflow
 * lobes are excluded — a single light cannot honestly speak for several Agents,
 * so the lobe carries its count instead.
 */
export function delegationStatusPieces(
  units: readonly SpatialBoardDelegationUnit[]
): SpatialBoardPiece[] {
  const pieces: SpatialBoardPiece[] = [];
  for (const unit of units) {
    if (unit.kind !== 'child') continue;
    pieces.push({
      id: unit.id,
      slotIndex: 0,
      kind: 'agent',
      projectId: unit.projectId,
      agentId: null,
      label: unit.description ?? unit.agentType ?? 'Delegated Agent',
      summary: unit.agentType ?? 'Delegated Agent',
      status: 'working',
      count: 1,
      x: unit.x,
      y: unit.y,
      size: unit.size,
      visible: true,
      selected: false,
      needsAttention: false,
      labelVisibility: 'hidden',
      burnIntensity: null,
    });
  }
  return pieces;
}
