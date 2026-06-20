import type { AgentStatus } from '@exawatt/core';
import { chamferPolygon, HUD_STATUS_COLOR, withAlpha } from './tokens';

const LABEL: Record<AgentStatus, string> = {
  working: 'Working',
  reviewing: 'Reviewing',
  blocked: 'Blocked',
  error: 'Error',
  complete: 'Complete',
  idle: 'Idle',
};

/** Agent status chip — chamfered, semantic color, glowing dot. */
export function StatusPill({
  status,
  className,
}: {
  status: AgentStatus;
  className?: string;
}) {
  const color = HUD_STATUS_COLOR[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 ${className ?? ''}`}
      style={{
        clipPath: chamferPolygon(['tr', 'bl'], 6),
        background: withAlpha(color, 0.12),
        border: `1px solid ${withAlpha(color, 0.45)}`,
        color,
      }}
    >
      <span
        aria-hidden
        className="h-1.5 w-1.5 rounded-full"
        style={{ background: color, boxShadow: `0 0 6px ${color}` }}
      />
      <span className="font-ui text-[10px] font-semibold uppercase tracking-[0.12em]">
        {LABEL[status]}
      </span>
    </span>
  );
}
