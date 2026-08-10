export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0m';
  const totalMinutes = Math.round(ms / 60_000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days) return `${days}d ${hours}h`;
  if (hours) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export function formatAgentHours(ms: number): string {
  const hours = ms / 3_600_000;
  if (hours >= 1000) return `${(hours / 1000).toFixed(1)}k h`;
  if (hours >= 10) return `${Math.round(hours)} h`;
  return `${hours.toFixed(1)} h`;
}

/**
 * Agent hours carrying their own unit, for places with no column header or
 * label to supply it — share text, page descriptions, compact run rows.
 */
export function formatAgentHoursLong(ms: number): string {
  const hours = ms / 3_600_000;
  const value =
    hours >= 1000
      ? `${(hours / 1000).toFixed(1)}k`
      : hours >= 10
        ? String(Math.round(hours))
        : hours.toFixed(1);
  return `${value} agent hours`;
}

/**
 * The publish panel's last-synced stamp: time of day while it is today,
 * date + time once it is not, so "synced 2:14 PM" can never silently mean
 * yesterday.
 */
export function formatSyncedAt(at: number, now: number = Date.now()): string {
  const then = new Date(at);
  const sameDay = new Date(now).toDateString() === then.toDateString();
  return new Intl.DateTimeFormat('en', {
    ...(sameDay ? {} : { month: 'short', day: 'numeric' }),
    hour: 'numeric',
    minute: '2-digit',
  }).format(then);
}

export function formatTokens(tokens: number): string {
  return new Intl.NumberFormat('en', {
    notation: tokens >= 10_000 ? 'compact' : 'standard',
    maximumFractionDigits: 1,
  }).format(tokens);
}
