// No 'use client': only imported by the client workspace surface.

/**
 * Landing state on a roadmap item (ENG-017 S16): where the ticket that names
 * this item sits in the Project repository's delivery queue. The mark reuses
 * the session chip's idiom, a D40 status light beside mono micro text, so a
 * landing reads as the same feature as the agent chips around it: the light
 * is active while the landing moves, result once it reached master, fault
 * when it failed. Color beyond the light stays on the lens's own two states,
 * shipped green and blocked red.
 */
import { WORKSPACE_HUD as HUD } from '@/components/workspace/workspace-theme';
import { StatusLight } from '@/components/status-light/status-light';
import type {
  RoadmapItemLanding,
  RoadmapLandingState,
  RoadmapLensLandings,
} from '@exawatt/ui-model';
import { ordinal, relativeTime } from './roadmap-format';

function landingLight(
  state: RoadmapLandingState
): 'active' | 'result' | 'fault' {
  return state === 'landed'
    ? 'result'
    : state === 'failed'
      ? 'fault'
      : 'active';
}

/** The short form on a row: "queued · 2nd", "checking", "landed fe255b1". */
export function landingLabel(landing: RoadmapItemLanding): string {
  switch (landing.state) {
    case 'queued':
      return landing.position === null
        ? 'queued'
        : `queued · ${ordinal(landing.position)}`;
    case 'checking':
      return 'checking';
    case 'integrating':
      return 'integrating';
    case 'landed':
      return landing.shortSha ? `landed ${landing.shortSha}` : 'landed';
    case 'failed':
      return 'failed';
  }
}

/** The whole story on hover: ticket, branch, state, when, and why it failed. */
export function landingTooltip(
  landing: RoadmapItemLanding,
  now: number
): string {
  const parts = [
    landing.ticketNumber === null
      ? 'Landing · checks before admission'
      : `Ticket ${landing.ticketNumber}`,
    landing.branch,
    landingLabel(landing),
    relativeTime(landing.at, now),
  ].filter((part): part is string => Boolean(part));
  const line = parts.join(' · ');
  return landing.reason ? `${line}\n${landing.reason}` : line;
}

/** The rail header's one line about the queue. */
export function landingsHeaderLine(
  landings: RoadmapLensLandings,
  now: number
): string {
  const parts: string[] = [];
  if (landings.inQueue > 0) {
    parts.push(`${landings.inQueue} in queue`);
    if (landings.head) {
      parts.push(
        `head ${landings.head.declaredId ?? `#${landings.head.ticketNumber}`}`
      );
    }
    if (landings.checking > 0) parts.push(`${landings.checking} checking`);
  } else if (landings.checking > 0) {
    parts.push(
      landings.checking === 1
        ? '1 landing checking'
        : `${landings.checking} landings checking`
    );
  } else {
    parts.push('queue clear');
    if (landings.lastLanded) {
      parts.push(
        `landed ${landings.lastLanded.shortSha} ${relativeTime(landings.lastLanded.at, now)}`
      );
    }
  }
  if (landings.unreadableTickets > 0) {
    parts.push(
      landings.unreadableTickets === 1
        ? '1 ticket unreadable'
        : `${landings.unreadableTickets} tickets unreadable`
    );
  }
  return parts.join(' · ');
}

export function RoadmapLandingMark({
  landing,
  now,
  dim = false,
}: {
  landing: RoadmapItemLanding;
  now: number;
  /** compact rows render their metadata quieter */
  dim?: boolean;
}) {
  const color =
    landing.state === 'landed'
      ? HUD.green
      : landing.state === 'failed'
        ? HUD.red
        : dim
          ? HUD.textDim
          : HUD.text;
  return (
    <span
      data-roadmap-landing={landing.state}
      title={landingTooltip(landing, now)}
      className="inline-flex shrink-0 items-center gap-1 font-mono text-chrome-micro"
      style={{ color }}
    >
      <StatusLight
        decorative
        size="compact"
        state={landingLight(landing.state)}
      />
      {landingLabel(landing)}
    </span>
  );
}
