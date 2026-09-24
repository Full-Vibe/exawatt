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

const RELATIVE = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

/**
 * How long ago an instant was, at the coarsest unit that is still honest:
 * "just now", "12 minutes ago", "5 hours ago", "9 days ago". Staleness is
 * read at a glance, so it never renders a date the reader has to subtract.
 */
export function formatElapsedSince(at: number, now: number = Date.now()) {
  const minutes = Math.max(0, Math.floor((now - at) / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return RELATIVE.format(-minutes, 'minute');
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return RELATIVE.format(-hours, 'hour');
  return RELATIVE.format(-Math.floor(hours / 24), 'day');
}

export function formatTokens(tokens: number): string {
  return new Intl.NumberFormat('en', {
    notation: tokens >= 10_000 ? 'compact' : 'standard',
    maximumFractionDigits: 1,
  }).format(tokens);
}
