import type {
  PtyAttention,
  PtyAttentionRecord,
  PtyAttentionSignal,
} from './desktop-bridge/pty';

/** Stable source dimension, separate from the changing source request identity. */
export function attentionRecordKey(record: PtyAttentionRecord): string {
  return `${record.source}:${record.kind === 'turn-end' ? 'result' : record.kind === 'reminder' ? 'reminder' : `request:${record.requestId ?? 'unreported'}`}`;
}

export function attentionRecords(snapshot: PtyAttention): PtyAttentionRecord[] {
  return (
    snapshot.records ?? [
      {
        ...snapshot,
        source:
          snapshot.kind === 'roadmap-blocked'
            ? 'roadmap'
            : snapshot.kind === 'reminder'
              ? 'operator'
              : 'harness',
      },
    ]
  );
}

function priority(record: PtyAttentionSignal): number {
  if (record.kind === 'turn-end' || record.kind === 'reminder') return 2;
  return record.request === 'working' || record.request === 'unknown' ? 1 : 0;
}

/** One derived facade serves legacy surfaces and IPC. The record list owns
 * truth; deserialization never trusts a conflicting projected scalar. */
export function projectSessionAttention(
  records: readonly PtyAttentionRecord[]
): PtyAttention | null {
  if (records.length === 0) return null;
  const ordered = [...records].sort(
    (a, b) =>
      priority(a) - priority(b) ||
      a.since - b.since ||
      attentionRecordKey(a).localeCompare(attentionRecordKey(b))
  );
  const { source: _source, ...signal } = ordered[0];
  const unread = ordered.some(record => record.unread !== false);
  return {
    ...signal,
    ...(signal.unread !== undefined || ordered.length > 1 ? { unread } : {}),
    ...(ordered.length > 1 || ordered[0].source !== 'harness'
      ? { records: ordered }
      : {}),
  };
}

/** Operator inspection affects every currently presented fact, not execution. */
export function withAttentionRead(
  snapshot: PtyAttention,
  unread: boolean
): PtyAttention {
  return projectSessionAttention(
    attentionRecords(snapshot).map(record => ({ ...record, unread }))
  )!;
}

/** Marking a working Session unread is operator intent, not fabricated work
 * or a source request. The reminder shares custody but never emits an alert. */
export function markAttentionUnread(
  snapshot: PtyAttention | null,
  now: number
): PtyAttention {
  if (
    snapshot &&
    attentionRecords(snapshot).some(record => record.kind !== 'reminder')
  )
    return withAttentionRead(snapshot, true);
  return projectSessionAttention([
    { source: 'operator', kind: 'reminder', since: now, unread: true },
  ])!;
}

function readSignal(value: unknown): PtyAttentionSignal | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const { kind, since, unread, request, requestId } = record;
  if (
    !['bell', 'turn-end', 'blocked', 'roadmap-blocked', 'reminder'].includes(
      kind as string
    ) ||
    typeof since !== 'number' ||
    !Number.isFinite(since) ||
    since < 0
  )
    return null;
  if (unread !== undefined && typeof unread !== 'boolean') return null;
  if (
    request !== undefined &&
    !['blocking', 'working', 'unknown'].includes(request as string)
  )
    return null;
  if (
    requestId !== undefined &&
    (typeof requestId !== 'string' ||
      requestId.length === 0 ||
      requestId.length > 32768)
  )
    return null;
  return {
    kind,
    since,
    ...(unread !== undefined ? { unread } : {}),
    ...(request !== undefined ? { request } : {}),
    ...(requestId !== undefined ? { requestId } : {}),
  } as PtyAttentionSignal;
}

/** Disk and IPC share bounded normalization. Invalid independent records are
 * discarded individually; a corrupt facade cannot override sound source facts. */
export function readPtyAttention(value: unknown): PtyAttention | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const records = (value as { records?: unknown }).records;
  if (records === undefined) return readSignal(value);
  if (!Array.isArray(records) || records.length > 512) return null;
  const unique = new Map<string, PtyAttentionRecord>();
  for (const candidate of records) {
    const signal = readSignal(candidate);
    const source =
      candidate && typeof candidate === 'object' ? candidate.source : null;
    if (
      !signal ||
      (source !== 'harness' && source !== 'roadmap' && source !== 'operator')
    )
      continue;
    const record = { ...signal, source } as PtyAttentionRecord;
    const key = attentionRecordKey(record);
    if (!unique.has(key)) unique.set(key, record);
  }
  return projectSessionAttention([...unique.values()]);
}
