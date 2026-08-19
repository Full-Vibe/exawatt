import type { AgentStatus, AgentWorkState } from '@exawatt/core';
import { STATUS_LIGHT_META } from '@/components/status-light/protocol';
import { chamferPolygon, hudStatusColor, withAlpha } from './tokens';

const LABEL: Record<AgentStatus, string> = {
  working: 'Working',
  reviewing: 'Reviewing',
  blocked: 'Blocked',
  error: 'Error',
  complete: 'Complete',
  idle: 'Idle',
};

/** The design system owns this word; the pill does not keep a second copy. */
const UNREPORTED_LABEL = STATUS_LIGHT_META.unreported.label;

function pillLabel(status: AgentWorkState): string {
  return status === null ? UNREPORTED_LABEL : LABEL[status];
}

/** Agent status chip — chamfered, semantic color, glowing dot. */
export function StatusPill({
  status,
  className,
}: {
  status: AgentWorkState;
  className?: string;
}) {
  const color = hudStatusColor(status);
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
        {pillLabel(status)}
      </span>
    </span>
  );
}
