'use client';
import { useFleet, useFleetConnection } from '@/lib/fleet/fleet-provider';
import {
  STATUS_LIGHT_META,
  StatusLight,
  statusLightStateForAgentStatus,
  type StatusLightState,
} from '@/components/status-light';

const STATUS_ORDER: StatusLightState[] = [
  'active',
  'needs-you',
  'fault',
  'result',
  'off',
];

export function FleetMetricsBar({ embedded = false }: { embedded?: boolean }) {
  const { agents, metrics } = useFleet();
  const { status } = useFleetConnection();
  const isStale = status === 'disconnected' || status === 'error';
  const counts = agents.reduce<Record<StatusLightState, number>>(
    (result, agent) => {
      result[statusLightStateForAgentStatus(agent.status)] += 1;
      return result;
    },
    { active: 0, 'needs-you': 0, fault: 0, result: 0, off: 0 }
  );

  const formatCost = (v: number) => `$${v.toFixed(2)}`;
  const formatRate = (v: number) => `$${v.toFixed(2)}/hr`;

  return (
    <div
      aria-label="Fleet Agent statuses"
      className={`flex items-center gap-3 text-xs font-mono ${
        embedded
          ? 'min-w-0'
          : 'border-b border-zinc-800 bg-zinc-950 px-4 py-1.5'
      }`}
    >
      {STATUS_ORDER.map(state => (
        <span
          key={state}
          className="inline-flex items-center gap-1 whitespace-nowrap text-muted-foreground"
          title={STATUS_LIGHT_META[state].description}
        >
          <StatusLight decorative size="compact" state={state} />
          <span>{STATUS_LIGHT_META[state].label}</span>
          <span className="tabular-nums text-foreground">{counts[state]}</span>
        </span>
      ))}
      <span className="flex-1" />
      {/* Spend renders only when a source actually reports cost. The local
          and Demo transports deliberately report none (dollars derived from
          list price are a confident lie) — showing "$0.00 today" there is a
          claim of zero spend the corpus contradicts. Absence, not zero. */}
      {metrics.totalCost > 0 && (
        <span className="text-zinc-500">
          {formatCost(metrics.totalCost)} today
        </span>
      )}
      {metrics.totalCostRate > 0 && (
        <span className="text-teal-600">
          {formatRate(metrics.totalCostRate)}
        </span>
      )}
      {isStale && <span className="text-yellow-500 text-xs">(stale)</span>}
    </div>
  );
}
