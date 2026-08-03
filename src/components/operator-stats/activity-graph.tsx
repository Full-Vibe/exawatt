import { activityGraphLevel } from '@exawatt/core';
import type { PublicOperatorDay } from '@/lib/operator-stats/public';
import { formatAgentHours } from './format';
import styles from './operator-stats.module.css';

const DAYS = 371;

function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function ActivityGraph({ days }: { days: PublicOperatorDay[] }) {
  const byDate = new Map(days.map(day => [day.localDate, day]));
  const end = new Date();
  end.setUTCHours(0, 0, 0, 0);
  const cells = Array.from({ length: DAYS }, (_, index) => {
    const date = new Date(end);
    date.setUTCDate(end.getUTCDate() - (DAYS - index - 1));
    const key = dateKey(date);
    const day = byDate.get(key);
    const agentMs = day?.agentMs ?? 0;
    const level = activityGraphLevel(agentMs);
    return { key, agentMs, level };
  });

  return (
    <div
      className={styles.graphScroll}
      aria-label="Operator activity over the last year"
    >
      <div
        className={styles.graph}
        role="grid"
        aria-label="Autonomous agent-hours by day"
      >
        {cells.map(cell => (
          <button
            key={cell.key}
            type="button"
            role="gridcell"
            className={`${styles.graphCell} ${styles[`level${cell.level}`] ?? ''}`}
            aria-label={`${cell.key}: ${formatAgentHours(cell.agentMs)}`}
            title={`${cell.key} · ${formatAgentHours(cell.agentMs)}`}
          />
        ))}
      </div>
    </div>
  );
}
