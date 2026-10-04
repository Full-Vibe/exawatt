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

function priority(record: SessionAttentionSignal): number {
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

export interface SessionAttentionSignal {
  kind?: PtyAttentionSignal['kind'];
  since: number;
  /** Missing on legacy producers, which remain unread until acknowledged. */
  unread?: boolean;
  request?: 'blocking' | 'working' | 'unknown';
  requestId?: string;
  /** Independent source facts; when present these own read metadata. */
  records?: PtyAttentionRecord[];
}

/** Turn completion is a ready result, not an operator gate. Presence-only
 *  legacy signals remain conservative needs-you state. Every consumer that
 *  exposes or navigates attention must use this same predicate. */
export function attentionNeedsOperator(
  attention?: Pick<SessionAttentionSignal, 'kind'> | null
): boolean {
  return Boolean(
    attention &&
    (attention.kind === undefined ||
      ['bell', 'blocked', 'roadmap-blocked'].includes(attention.kind))
  );
}

/** A result stays a result: unread makes it worth visiting, not blocked. */
function attentionIsJumpTarget(
  signal?: SessionAttentionSignal | null
): boolean {
  return Boolean(
    signal && (attentionNeedsOperator(signal) || signal.unread !== false)
  );
}

/** Hard blockers, working questions, unread results; oldest within each class.
 * Identity breaks timestamp ties independently of producer insertion order. */
export function orderedAttentionTargets(
  attention: Readonly<Record<string, SessionAttentionSignal>>,
  activeSessionId: string | null
): string[] {
  return Object.entries(attention)
    .flatMap(([sessionId, signal]) => {
      if (sessionId === activeSessionId) return [];
      // A read result can share its facade with a newer unread reminder.
      // Queue age belongs to eligible work, never to an ineligible older fact
      // merely retained for presentation/history.
      const eligible = (signal.records ?? [signal])
        .filter(attentionIsJumpTarget)
        .sort((a, b) => priority(a) - priority(b) || a.since - b.since);
      return eligible[0] ? [[sessionId, eligible[0]] as const] : [];
    })
    .sort(
      (a, b) =>
        priority(a[1]) - priority(b[1]) ||
        a[1].since - b[1].since ||
        a[0].localeCompare(b[0])
    )
    .map(([sessionId]) => sessionId);
}

/** One pass visits every eligible Session once, even when reading cannot
 * resolve its request. New arrivals join the remaining priority order; an
 * exhausted pass starts again. Current focus counts as visited, including a
 * manual selection. The caller retains this state across source updates. */
export function nextAttentionTarget(
  orderedTargets: readonly string[],
  activeSessionId: string | null,
  previouslyVisited: ReadonlyMap<string, string>,
  signals: Readonly<Record<string, SessionAttentionSignal>> = {}
): { target: string | null; visited: ReadonlyMap<string, string> } {
  const identity = (id: string) => {
    const signal = signals[id];
    // Reading changes no source identity. A fresh request on an already
    // visited Session is new work and may preempt the remaining pass.
    if (!signal) return '';
    const records = signal.records ?? [signal];
    return JSON.stringify(
      records
        .map(record =>
          JSON.stringify([
            'source' in record ? record.source : 'harness',
            record.kind,
            record.request ?? '',
            record.requestId ?? record.since,
          ])
        )
        .sort()
    );
  };
  const eligible = new Set(orderedTargets);
  const visited = new Map(
    [...previouslyVisited].filter(
      ([id, value]) => eligible.has(id) && identity(id) === value
    )
  );
  if (activeSessionId) visited.set(activeSessionId, identity(activeSessionId));
  let target = orderedTargets.find(id => !visited.has(id));
  if (!target) {
    visited.clear();
    if (activeSessionId)
      visited.set(activeSessionId, identity(activeSessionId));
    target = orderedTargets.find(id => !visited.has(id));
  }
  if (target) visited.set(target, identity(target));
  return { target: target ?? null, visited };
}

/** The inspection commands shared by local and authored Demo Session sources. */
export interface SessionAttentionCommands {
  focus(id: string | null): void | Promise<void>;
  markUnread(id: string): void | Promise<void>;
}
