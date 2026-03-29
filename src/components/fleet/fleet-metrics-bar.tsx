'use client';
import { useFleet } from '@/lib/fleet/fleet-provider';

export function FleetMetricsBar() {
  const { metrics } = useFleet();

  const formatCost = (v: number) => `$${v.toFixed(2)}`;
  const formatRate = (v: number) => `$${v.toFixed(2)}/hr`;

  return (
    <div className="flex items-center gap-4 px-4 py-1.5 bg-zinc-950 border-b border-zinc-800 text-xs font-mono">
      <span className="text-teal-400">● {metrics.activeCount} ACTIVE</span>
      <span className="text-red-400">▲ {metrics.blockedCount} BLOCKED</span>
      <span className="text-zinc-500">○ {metrics.idleCount} IDLE</span>
      <span className="flex-1" />
      <span className="text-zinc-500">
        {formatCost(metrics.totalCost)} today
      </span>
      {metrics.totalCostRate > 0 && (
        <span className="text-teal-600">
          {formatRate(metrics.totalCostRate)}
        </span>
      )}
    </div>
  );
}
