import { cn } from '@/lib/utils';
import { WORKSPACE_HUD as HUD } from './workspace-theme';

/**
 * The durable Session context cue shared by Terminal chrome and comparison
 * surfaces. It answers why the Session exists without competing with the
 * surrounding identity or state signals.
 */
export function SessionGoalSummary({
  summary,
  size = 'chrome',
  className,
}: {
  summary: string;
  size?: 'chrome' | 'comparison';
  className?: string;
}) {
  return (
    <span
      data-subtitle
      data-session-goal-summary
      className={cn(
        'line-clamp-2 text-left font-sans font-normal',
        size === 'comparison' ? 'text-base leading-6' : 'text-chrome-label',
        className
      )}
      style={{ color: HUD.text }}
    >
      {summary}
    </span>
  );
}
