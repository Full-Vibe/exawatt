// No 'use client': only imported by the client workspace surface.

/**
 * Normal-case status pill for the roadmap lens. Deliberately NOT the HUD
 * `StatusPill` atom — that one is all-caps, which the operator style rules
 * prohibit. Display vocabulary: active / next / later / backlog / shipped / parked,
 * with `blocked` as an orthogonal badge rendered by the caller.
 */
import {
  WORKSPACE_HUD as HUD,
  withThemeAlpha as withAlpha,
} from '@/components/workspace/workspace-theme';
import type { RoadmapDisplayStatus } from '@exawatt/ui-model';

// Status discipline (S7): color belongs to the states that matter — active
// (the project color family) and shipped (green). Everything queued is
// neutral; blocked/amber comes from the badge, never from the pill.
export const ROADMAP_STATUS_COLOR: Record<RoadmapDisplayStatus, string> = {
  active: HUD.cyan2,
  next: HUD.idle,
  later: HUD.idle,
  backlog: HUD.idle,
  shipped: HUD.green,
  parked: HUD.idle,
};

// The accent still carries state in the border/fill. At micro-text size the
// label uses only HUD roles that are explicitly contrast-gated as readable.
export const ROADMAP_STATUS_TEXT_COLOR: Record<RoadmapDisplayStatus, string> = {
  active: HUD.text,
  next: HUD.textDim,
  later: HUD.textDim,
  backlog: HUD.textDim,
  shipped: HUD.green,
  parked: HUD.textDim,
};

const STATUS_WORD: Record<RoadmapDisplayStatus, string> = {
  active: 'Active',
  next: 'Next',
  later: 'Later',
  backlog: 'Backlog',
  shipped: 'Shipped',
  parked: 'Parked',
};

export function RoadmapStatusPill({
  status,
}: {
  status: RoadmapDisplayStatus;
}) {
  const accent = ROADMAP_STATUS_COLOR[status];
  return (
    <span
      className="inline-flex shrink-0 items-center rounded-sm border px-1.5 py-px font-ui text-chrome-micro font-medium leading-4"
      style={{
        color: ROADMAP_STATUS_TEXT_COLOR[status],
        borderColor: withAlpha(accent, 0.4),
        background: withAlpha(accent, 0.08),
      }}
    >
      {STATUS_WORD[status]}
    </span>
  );
}

export function RoadmapBlockedBadge() {
  return (
    <span
      className="inline-flex shrink-0 items-center rounded-sm border px-1.5 py-px font-ui text-chrome-micro font-medium leading-4"
      style={{
        color: HUD.red,
        borderColor: withAlpha(HUD.red, 0.4),
        background: withAlpha(HUD.red, 0.08),
      }}
    >
      Blocked
    </span>
  );
}
