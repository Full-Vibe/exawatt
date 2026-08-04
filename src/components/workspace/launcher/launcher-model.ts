/**
 * View model for the New Agent launcher (ENG-016 D49).
 *
 * Presentation-only and deliberately free of Electron, persistence, and the
 * `@exawatt/core` pool shape. The composer adapts runtime truth into this
 * model; the gallery bench builds it from fixtures. Both then render the
 * identical components, so a design iteration in the bench IS an iteration of
 * the shipped surface.
 */

import type { PtyHarness } from '@/types/electron';

/**
 * What kind of worker this is, as opposed to which engine runs it. Only
 * Coding exists today (ENG-028 owns the real Type mechanism); the axis is
 * modelled now so the chip does not have to be re-laid-out when it arrives.
 */
export type LauncherRole = 'coding';

export const LAUNCHER_ROLE_LABEL: Record<LauncherRole, string> = {
  coding: 'Coding',
};

/** Why this setup is in the row. Rendered as provenance, never invented. */
export type LauncherReason = 'pinned' | 'frecent' | 'default';

export interface LauncherEngine {
  harness: PtyHarness;
  label: string;
  /** Brand identity, not readable text paint. Used on the glyph only. */
  color: string;
}

export interface LauncherSetup {
  id: string;
  role: LauncherRole;
  /** Operator preset name, when they have named this setup. */
  name: string | null;
  engine: LauncherEngine;
  /** Null while the engine has not reported a model yet. */
  model: string | null;
  /** Secondary model fact, e.g. "1M context". Never the whole identity. */
  modelNote: string | null;
  /** Reasoning effort label, e.g. "High". Null when the engine has none. */
  thinking: string | null;
  reason: LauncherReason;
  /** Successful launches of this setup in this Project. */
  launchCount: number;
  pinned: boolean;
  available: boolean;
  /** Exact missing fact. Required whenever `available` is false. */
  unavailableReason?: string;
}

/**
 * The row's readiness. `settling` renders non-interactive placeholders at the
 * final geometry so nothing pops in under a moving pointer (D49 finding 4).
 */
export type LauncherRowState = 'settling' | 'ready';

/**
 * How many setups fit at this composer width.
 *
 * The row never truncates to make room for one more chip: an unreadable chip
 * is worth less than no chip, and the tail is one keystroke away behind ＋.
 * Measured against the real chip content — `Extra high thinking` under
 * `GPT-5.3 Codex` is the widest realistic pair.
 */
export function rowCapacityForWidth(width: number): number {
  if (width < 560) return 2;
  if (width < 900) return 3;
  return 4;
}

/** One line of provenance under the chip's identity. */
export function reasonLabel(setup: LauncherSetup): string {
  if (setup.pinned) return 'Pinned';
  if (setup.reason === 'frecent') {
    return setup.launchCount === 1 ? 'Used once' : `Used ${setup.launchCount}×`;
  }
  return 'Suggested';
}

/** Full spoken identity. Never derived from truncated visible copy. */
export function setupAccessibleLabel(setup: LauncherSetup): string {
  const identity = [
    setup.name,
    LAUNCHER_ROLE_LABEL[setup.role],
    setup.engine.label,
    setup.model,
    setup.modelNote,
    setup.thinking ? `${setup.thinking} thinking` : null,
  ]
    .filter(Boolean)
    .join(', ');
  const state = [
    setup.pinned ? 'pinned' : null,
    setup.available
      ? null
      : `unavailable${setup.unavailableReason ? `: ${setup.unavailableReason}` : ''}`,
  ].filter(Boolean);
  return state.length > 0 ? `${identity}, ${state.join(', ')}` : identity;
}
