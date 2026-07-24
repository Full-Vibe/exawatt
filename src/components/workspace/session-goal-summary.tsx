import { cn } from '@/lib/utils';

/**
 * The durable Session context cue shared by Terminal chrome and comparison
 * surfaces. It answers why the Session exists without competing with the
 * surrounding identity or state signals.
 */
export function SessionGoalSummary({
  summary,
  color,
  className,
}: {
  summary: string;
  color: string;
  className?: string;
}) {
  return (
    <span
      data-subtitle
      data-session-goal-summary
      className={cn(
        'line-clamp-2 text-left font-sans text-chrome-label font-normal',
        className
      )}
      style={{ color: `${color}B0` }}
    >
      {summary}
    </span>
  );
}
