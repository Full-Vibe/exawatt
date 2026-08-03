'use client';
import { useFleet, useFleetConnection } from '@/lib/fleet/fleet-provider';

export function FleetMetricsBar({ embedded = false }: { embedded?: boolean }) {
  const { metrics } = useFleet();
  const { status } = useFleetConnection();
  const isStale = status === 'disconnected' || status === 'error';

  const formatCost = (v: number) => `$${v.toFixed(2)}`;
  const formatRate = (v: number) => `$${v.toFixed(2)}/hr`;

  return (
    <div
      className={`flex items-center gap-4 text-xs font-mono ${
        embedded
          ? 'min-w-0'
          : 'border-b border-zinc-800 bg-zinc-950 px-4 py-1.5'
      }`}
    >
      <span className="text-teal-400">● {metrics.activeCount} ACTIVE</span>
      <span className="text-red-400">▲ {metrics.blockedCount} BLOCKED</span>
      <span className="text-zinc-500">○ {metrics.idleCount} IDLE</span>
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
