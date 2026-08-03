/**
 * Altitude handoff (ENG-004 V3.0, decision 0023): Team → Fleet arrival.
 *
 * When the operator ascends from the Team altitude (the Sessions overview)
 * to the Fleet altitude (the Spatial Operations Board), the board's ENTRY
 * POSE places each Project zone at the screen position its card occupied,
 * the cards crossfade into zones in place, and only then does the camera
 * pull back to the resting fit. Identity and position carry across the
 * DOM→WebGL boundary; content never does.
 *
 * Ownership: the D11 transition owner (CommandNavigationProvider) owns the
 * handoff lifecycle — capture, ghost crossfade, deadline, and the fallback
 * decision. The board camera rig is an executor: it claims the snapshot,
 * solves the entry pose, and reports back over the two events below. The
 * fast directional transition remains the guaranteed fallback and firing it
 * is a NORMAL outcome, not an error: reduced motion, low power, a missed
 * frame budget, missing/stale card positions, an unsolvable pose, or any
 * renderer failure all cut to it. Transitions never block input.
 */

export interface HandoffRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface HandoffCard {
  /** Normalized identity key (label, lowercased + trimmed). */
  key: string;
  label: string;
  color: string;
  rect: HandoffRect;
}

export interface HandoffSnapshot {
  cards: HandoffCard[];
  viewport: { width: number; height: number };
  capturedAt: number;
}

export interface HandoffPoseTarget {
  key: string;
  label: string;
  color: string;
  from: HandoffRect;
  /** Zone rect projected under the entry pose, in viewport coordinates. */
  to: HandoffRect;
}

export interface HandoffPoseDetail {
  targets: HandoffPoseTarget[];
  crossfadeMs: number;
}

/** Frame budget from capture to a claimed, solved entry pose. A cold route
 *  or renderer that cannot produce the pose inside this window hard-cuts. */
export const ALTITUDE_HANDOFF_BUDGET_MS = 900;
/** Card → zone ghost crossfade duration. */
export const ALTITUDE_HANDOFF_CROSSFADE_MS = 380;
/** How long the camera holds the entry pose before pulling back to fit.
 *  Slightly longer than the crossfade so nothing moves during the swap. */
export const ALTITUDE_HANDOFF_HOLD_MS = 560;
/** Window after a claim during which the board must not restore a stored
 *  viewport over the entry pose. */
const CLAIM_ACTIVE_MS = 2_500;

/** Board (rig) → transition owner: entry pose applied, targets attached. */
export const ALTITUDE_HANDOFF_POSE_EVENT = 'exawatt:altitude-handoff-pose';
/** Board (rig) → transition owner: pose declined; cut now. */
export const ALTITUDE_HANDOFF_FALLBACK_EVENT =
  'exawatt:altitude-handoff-fallback';

/** Same gate the board canvas uses for its low-power mode. */
export function lowPowerLikely(): boolean {
  if (typeof navigator === 'undefined') return false;
  return (navigator.hardwareConcurrency || 8) <= 4;
}

export function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/** The handoff is attempted only when motion is welcome; everything else is
 *  the fallback cut by construction. */
export function altitudeHandoffAllowed(): boolean {
  return !prefersReducedMotion() && !lowPowerLikely();
}

export function normalizeHandoffKey(label: string): string {
  return label.trim().toLowerCase();
}

/**
 * Reads every `[data-handoff-card]` element currently intersecting the
 * viewport. Returns null when there is nothing to carry — the caller then
 * takes the ordinary directional transition.
 */
export function captureAltitudeCards(
  doc: Document | null = typeof document === 'undefined' ? null : document
): HandoffSnapshot | null {
  if (!doc || typeof window === 'undefined') return null;
  const elements = doc.querySelectorAll<HTMLElement>('[data-handoff-card]');
  if (elements.length === 0) return null;
  const viewport = { width: window.innerWidth, height: window.innerHeight };
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  const cards: HandoffCard[] = [];
  for (const element of elements) {
    const label = element.dataset.handoffLabel ?? '';
    const key = normalizeHandoffKey(label);
    if (!key) continue;
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;
    // Only cards the operator can actually see participate in the carry.
    if (
      rect.bottom <= 0 ||
      rect.right <= 0 ||
      rect.top >= viewport.height ||
      rect.left >= viewport.width
    ) {
      continue;
    }
    if (seen.has(key)) {
      duplicates.add(key);
      continue;
    }
    seen.add(key);
    cards.push({
      key,
      label,
      color: element.dataset.handoffColor ?? '#4fd8c4',
      rect: {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
      },
    });
  }
  // An ambiguous identity cannot carry position honestly — drop it.
  const unique = cards.filter(card => !duplicates.has(card.key));
  if (unique.length === 0) return null;
  return { cards: unique, viewport, capturedAt: performance.now() };
}

// ── Single-use snapshot store (module scope survives the route change) ──

let pending: HandoffSnapshot | null = null;
let claimedAt = 0;

export function publishAltitudeHandoff(snapshot: HandoffSnapshot): void {
  pending = snapshot;
}

/**
 * Single-use claim. Declines (returns null and discards) when the snapshot
 * is older than the frame budget or the viewport no longer matches — a
 * stale carry is a fallback, never an approximation.
 */
export function claimAltitudeHandoff(
  now = typeof performance === 'undefined' ? 0 : performance.now()
): HandoffSnapshot | null {
  const snapshot = pending;
  pending = null;
  if (!snapshot) return null;
  if (now - snapshot.capturedAt > ALTITUDE_HANDOFF_BUDGET_MS) return null;
  if (
    typeof window !== 'undefined' &&
    (Math.abs(window.innerWidth - snapshot.viewport.width) > 2 ||
      Math.abs(window.innerHeight - snapshot.viewport.height) > 2)
  ) {
    return null;
  }
  claimedAt = now;
  return snapshot;
}

/** True while a fresh snapshot awaits a claim or a claim just happened —
 *  the board must not restore a stored viewport over the entry pose. */
export function altitudeHandoffActive(
  now = typeof performance === 'undefined' ? 0 : performance.now()
): boolean {
  if (pending && now - pending.capturedAt <= ALTITUDE_HANDOFF_BUDGET_MS) {
    return true;
  }
  return claimedAt > 0 && now - claimedAt <= CLAIM_ACTIVE_MS;
}

/** Test-only: forget any pending snapshot or recent claim. */
export function resetAltitudeHandoffForTests(): void {
  pending = null;
  claimedAt = 0;
}

// ── Entry-pose solver ──────────────────────────────────────────────────

interface SolverZone {
  id: string;
  label: string;
  /** Board-space rect (x/y down-right, matching `SpatialBoardRect`). */
  rect: { x: number; y: number; width: number; height: number };
  visible: boolean;
  isAggregate: boolean;
}

export interface EntryPoseSolution {
  /** Camera pose in rig coordinates (world y = -board y). */
  pose: { x: number; y: number; zoom: number };
  targets: HandoffPoseTarget[];
  /** RMS screen residual normalized by the viewport diagonal. */
  residual: number;
}

/** Matched pairs below this count cannot pin scale + translation. */
const MIN_MATCHES = 2;
/** Fewer matched cards than this fraction reads as a different world —
 *  ghosting a minority while most cards vanish looks broken; cut instead. */
const MIN_MATCH_FRACTION = 0.6;
/** Sanity ceiling on the normalized RMS residual: above this the geometry
 *  is pathological and the cut is more honest than any pose. */
const MAX_RESIDUAL = 0.8;
/** Correlation below this means card order and zone order disagree — the
 *  least-squares zoom degenerates toward zero, so the pose falls back to
 *  scale + centroid and the ghost flights carry the per-card positions. */
const MIN_LSQ_CORRELATION = 0.55;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]!
    : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

/**
 * Entry-pose fit (uniform zoom + translation, no rotation — the
 * orthographic top-down camera has exactly these degrees of freedom) from
 * board coordinates to canvas screen coordinates. Board y and screen y both
 * increase downward, so the mapping is
 *   s = (b - center) * zoom + canvasCenter.
 *
 * When the card order correlates with the zone grid, the least-squares zoom
 * places each zone as close as one camera can get to "the screen position
 * its card occupied". When the orders disagree (the normal case for an
 * operator-ordered Team overview against the board's stable addresses), the
 * least-squares scale collapses toward zero, so the pose instead matches
 * SCALE (zones arrive at roughly card size) and CENTROID, and the per-card
 * ghost flights carry exact positions.
 */
export function solveEntryPose(
  snapshot: HandoffSnapshot,
  zones: readonly SolverZone[],
  canvas: { width: number; height: number; left: number; top: number },
  zoomBounds?: { min: number; max: number }
): EntryPoseSolution | null {
  if (canvas.width <= 0 || canvas.height <= 0) return null;
  const zoneByKey = new Map<string, SolverZone>();
  for (const zone of zones) {
    if (!zone.visible || zone.isAggregate) continue;
    const key = normalizeHandoffKey(zone.label);
    if (!key || zoneByKey.has(key)) continue;
    zoneByKey.set(key, zone);
  }
  const matches: Array<{ card: HandoffCard; zone: SolverZone }> = [];
  for (const card of snapshot.cards) {
    const zone = zoneByKey.get(card.key);
    if (zone) matches.push({ card, zone });
  }
  if (
    matches.length < MIN_MATCHES ||
    matches.length < snapshot.cards.length * MIN_MATCH_FRACTION
  ) {
    return null;
  }

  // Centers: board space (y down) and canvas-local screen space (y down).
  const boardX: number[] = [];
  const boardY: number[] = [];
  const screenX: number[] = [];
  const screenY: number[] = [];
  const sizeRatios: number[] = [];
  for (const { card, zone } of matches) {
    boardX.push(zone.rect.x + zone.rect.width / 2);
    boardY.push(zone.rect.y + zone.rect.height / 2);
    screenX.push(card.rect.left + card.rect.width / 2 - canvas.left);
    screenY.push(card.rect.top + card.rect.height / 2 - canvas.top);
    const zoneArea = zone.rect.width * zone.rect.height;
    if (zoneArea > 0) {
      sizeRatios.push(
        Math.sqrt((card.rect.width * card.rect.height) / zoneArea)
      );
    }
  }
  if (sizeRatios.length === 0) return null;
  const mean = (values: number[]) =>
    values.reduce((sum, value) => sum + value, 0) / values.length;
  const meanBoardX = mean(boardX);
  const meanBoardY = mean(boardY);
  const meanScreenX = mean(screenX);
  const meanScreenY = mean(screenY);
  let dot = 0;
  let norm = 0;
  let normScreen = 0;
  for (let index = 0; index < matches.length; index++) {
    const bx = boardX[index]! - meanBoardX;
    const by = boardY[index]! - meanBoardY;
    const sx = screenX[index]! - meanScreenX;
    const sy = screenY[index]! - meanScreenY;
    dot += bx * sx + by * sy;
    norm += bx * bx + by * by;
    normScreen += sx * sx + sy * sy;
  }
  if (norm <= 0) return null;
  const scaleZoom = median(sizeRatios);
  const correlation =
    normScreen > 0 ? dot / Math.sqrt(norm * normScreen) : 0;
  const lsqZoom = dot / norm;
  let zoom =
    correlation >= MIN_LSQ_CORRELATION &&
    lsqZoom >= scaleZoom * 0.4 &&
    lsqZoom <= scaleZoom * 2.5
      ? lsqZoom
      : scaleZoom;
  if (zoomBounds) {
    zoom = Math.min(Math.max(zoom, zoomBounds.min), zoomBounds.max);
  }
  if (!Number.isFinite(zoom) || zoom < 0.05 || zoom > 400) return null;
  const centerX = meanBoardX - (meanScreenX - canvas.width / 2) / zoom;
  const centerY = meanBoardY - (meanScreenY - canvas.height / 2) / zoom;
  if (!Number.isFinite(centerX) || !Number.isFinite(centerY)) return null;

  const project = (bx: number, by: number) => ({
    x: (bx - centerX) * zoom + canvas.width / 2 + canvas.left,
    y: (by - centerY) * zoom + canvas.height / 2 + canvas.top,
  });
  let squared = 0;
  const targets: HandoffPoseTarget[] = [];
  for (let index = 0; index < matches.length; index++) {
    const { card, zone } = matches[index]!;
    const topLeft = project(zone.rect.x, zone.rect.y);
    const target: HandoffPoseTarget = {
      key: card.key,
      label: card.label,
      color: card.color,
      from: card.rect,
      to: {
        left: topLeft.x,
        top: topLeft.y,
        width: zone.rect.width * zoom,
        height: zone.rect.height * zoom,
      },
    };
    targets.push(target);
    const center = project(boardX[index]!, boardY[index]!);
    const dx = center.x - canvas.left - screenX[index]!;
    const dy = center.y - canvas.top - screenY[index]!;
    squared += dx * dx + dy * dy;
  }
  const diagonal = Math.hypot(snapshot.viewport.width, snapshot.viewport.height);
  const residual = Math.sqrt(squared / matches.length) / Math.max(diagonal, 1);
  if (residual > MAX_RESIDUAL) return null;

  return {
    pose: { x: centerX, y: -centerY, zoom },
    targets,
    residual,
  };
}
