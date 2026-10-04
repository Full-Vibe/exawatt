'use client';
import { useFleet, useFleetConnection } from '@/lib/fleet/fleet-provider';
import {
  STATUS_LIGHT_META,
  StatusLight,
  type StatusLightState,
} from '@/components/status-light';
import { SESSION_STOPPED_OUTLINE } from '@exawatt/ui-model';
import { fleetStatusCounts } from './fleet-status-counts';

const STATUS_ORDER: StatusLightState[] = [
  'active',
  'needs-you',
  'fault',
  'result',
  'off',
];

export function FleetMetricsBar({
  embedded = false,
  selectedStates = [],
  onToggleState,
}: {
  embedded?: boolean;
  selectedStates?: readonly StatusLightState[];
  onToggleState?: (state: StatusLightState) => void;
}) {
  const { agents, metrics } = useFleet();
  const { status } = useFleetConnection();
  const isStale = status === 'disconnected' || status === 'error';
  const { readings: counts, delegated } = fleetStatusCounts(agents);
  const delegatedNote = `${delegated} delegated ${delegated === 1 ? 'agent' : 'agents'}`;
  // Working includes the delegated team, so its accessible name says how the
  // figure splits instead of calling it a share of the top-level Agents.
  const countLabel = (state: StatusLightState) =>
    state === 'active' && delegated > 0
      ? `${counts.active} (${counts.active - delegated} of ${agents.length} Agents and ${delegatedNote})`
      : `${counts[state]} of ${agents.length} Agents`;
  const description = (state: StatusLightState) =>
    state === 'active' && delegated > 0
      ? `${STATUS_LIGHT_META.active.description} Includes ${delegatedNote}.`
      : STATUS_LIGHT_META[state].description;

  const formatCost = (v: number) => `$${v.toFixed(2)}`;
  const formatRate = (v: number) => `$${v.toFixed(2)}/hr`;

  return (
    <div
      aria-label="Fleet Agent statuses"
      title={onToggleState ? 'Fleet-wide totals · select to filter' : undefined}
      className={`flex items-center gap-3 text-xs font-mono ${
        embedded
          ? 'min-w-0'
          : 'border-b border-zinc-800 bg-zinc-950 px-4 py-1.5'
      }`}
    >
      {STATUS_ORDER.map(state => {
        const content = (
          <>
            <StatusLight decorative size="compact" state={state} />
            <span>{STATUS_LIGHT_META[state].label}</span>
            <span className="tabular-nums text-foreground">
              {counts[state]}
            </span>
          </>
        );
        return onToggleState ? (
          <button
            key={state}
            type="button"
            aria-pressed={selectedStates.includes(state)}
            aria-label={`${STATUS_LIGHT_META[state].label}: ${countLabel(state)}. Filter by this status.`}
            onClick={() => onToggleState(state)}
            className={`inline-flex min-h-8 items-center gap-1 whitespace-nowrap rounded px-1.5 text-muted-foreground outline-none transition-[background-color,color] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring [@media(pointer:coarse)]:min-h-11 ${
              selectedStates.includes(state)
                ? 'bg-secondary text-foreground'
                : ''
            }`}
            title={description(state)}
          >
            {content}
          </button>
        ) : (
          <span
            key={state}
            className="inline-flex items-center gap-1 whitespace-nowrap text-muted-foreground"
            title={description(state)}
          >
            {content}
          </span>
        );
      })}
      {/* Not a filter: the status filter selects reported states, and there
          is no reported state to select here. It is a readout, and it appears
          only when it is true of somebody. */}
      {counts.unreported > 0 && (
        <span
          className="inline-flex items-center gap-1 whitespace-nowrap text-muted-foreground"
          title={STATUS_LIGHT_META.unreported.description}
        >
          <StatusLight decorative size="compact" state="unreported" />
          <span>{STATUS_LIGHT_META.unreported.label}</span>
          <span className="tabular-nums text-foreground">
            {counts.unreported}
          </span>
        </span>
      )}
      {agents.some(agent => agent.sessionState === 'stopped') && (
        <span
          className="inline-flex items-center gap-1 whitespace-nowrap text-muted-foreground"
          role="img"
          title={SESSION_STOPPED_OUTLINE.description}
          aria-label={SESSION_STOPPED_OUTLINE.description}
        >
          <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16">
            <circle
              cx="8"
              cy="8"
              r="6"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeDasharray="1 3"
              strokeLinecap="round"
            />
          </svg>
          <span>{SESSION_STOPPED_OUTLINE.label}</span>
        </span>
      )}
      <span className="flex-1" />
      {/* Spend renders only when a source actually reports cost. The local
          and Demo transports deliberately report none (dollars derived from
          list price are a confident lie) — showing "$0.00 today" there is a
          claim of zero spend the corpus contradicts. Absence, not zero. */}
      {metrics.totalCost > 0 && (
        <span className="text-muted-foreground">
          {formatCost(metrics.totalCost)} today
        </span>
      )}
      {metrics.totalCostRate > 0 && (
        <span className="text-primary">
          {formatRate(metrics.totalCostRate)}
        </span>
      )}
      {isStale && (
        <span className="text-muted-foreground text-xs">(stale)</span>
      )}
    </div>
  );
}
