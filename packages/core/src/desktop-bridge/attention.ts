import type { PtyAttention } from './pty';

/** Disk and renderer input share one bounded reader for durable attention. */
export function readPtyAttention(value: unknown): PtyAttention | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  if (
    (row.kind !== 'bell' &&
      row.kind !== 'blocked' &&
      row.kind !== 'turn-end') ||
    typeof row.since !== 'number' ||
    !Number.isFinite(row.since) ||
    row.since < 0
  )
    return null;
  return {
    kind: row.kind,
    since: row.since,
    ...(typeof row.requestId === 'string' &&
    row.requestId.length > 0 &&
    row.requestId.length <= 512
      ? { requestId: row.requestId }
      : {}),
    ...(typeof row.unread === 'boolean' ? { unread: row.unread } : {}),
    ...(row.request === 'blocking' ||
    row.request === 'working' ||
    row.request === 'unknown'
      ? { request: row.request }
      : {}),
  };
}
