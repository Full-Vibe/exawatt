import type { BusDeliveryState } from '@exawatt/core';

/** Compact age for a list row: `now`, `4m`, `3h`, `2d`. */
export function chatterAge(at: number, now: number): string {
  const age = Math.max(0, now - at);
  if (age < 60_000) return 'now';
  if (age < 3_600_000) return `${Math.floor(age / 60_000)}m`;
  if (age < 86_400_000) return `${Math.floor(age / 3_600_000)}h`;
  return `${Math.floor(age / 86_400_000)}d`;
}

/** The stamp's clock time: `14:05` today, `Oct 14, 14:05` before. */
export function chatterStamp(at: number, now: number): string {
  const date = new Date(at);
  const time = date.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });
  const today = new Date(now);
  if (date.toDateString() === today.toDateString()) return time;
  const day = date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
  return `${day}, ${time}`;
}

/** What a delivery result says, in the operator's words. */
export const DELIVERY_LABEL: Record<BusDeliveryState, string> = {
  delivered: 'Delivered',
  queued: 'Queued for its next turn',
  held: 'Held by the recipient',
  terminal: 'Typed into its terminal',
  undeliverable: 'Not delivered',
  expired: 'Expired while held',
  unknown: 'Sent, not confirmed',
};
