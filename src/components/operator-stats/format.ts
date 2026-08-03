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

export function formatTokens(tokens: number): string {
  return new Intl.NumberFormat('en', {
    notation: tokens >= 10_000 ? 'compact' : 'standard',
    maximumFractionDigits: 1,
  }).format(tokens);
}
