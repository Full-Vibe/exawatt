'use client';
import { useFleet, useFleetConnection } from '@/lib/fleet/fleet-provider';
import {
  STATUS_LIGHT_META,
  StatusLight,
  workStateReading,
  type StatusLightReading,
  type StatusLightState,
} from '@/components/status-light';

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
  // Counted by READING. An Agent whose source reported no work state used to
  // land on `off` and be announced as one more idle Agent; it now has its own
  // tally, so the Idle figure only counts Agents somebody reported as idle.
  const counts = agents.reduce<Record<StatusLightReading, number>>(
    (result, agent) => {
      result[workStateReading(agent.status)] += 1;
      return result;
    },
    { active: 0, 'needs-you': 0, fault: 0, result: 0, off: 0, unreported: 0 }
  );

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
            aria-label={`${STATUS_LIGHT_META[state].label}: ${counts[state]} of ${agents.length} Agents. Filter by this status.`}
            onClick={() => onToggleState(state)}
            className={`inline-flex min-h-8 items-center gap-1 whitespace-nowrap rounded px-1.5 text-muted-foreground outline-none transition-[background-color,color] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring [@media(pointer:coarse)]:min-h-11 ${
              selectedStates.includes(state)
                ? 'bg-secondary text-foreground'
                : ''
            }`}
            title={STATUS_LIGHT_META[state].description}
          >
            {content}
          </button>
        ) : (
          <span
            key={state}
            className="inline-flex items-center gap-1 whitespace-nowrap text-muted-foreground"
            title={STATUS_LIGHT_META[state].description}
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
