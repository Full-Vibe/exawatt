import {
  attentionNeedsOperator,
  type SessionAttentionSignal,
} from '@exawatt/core';

/** Read state is operator inspection, not request resolution or turn truth. */
export function attentionReadLabel(
  signal?: SessionAttentionSignal
): string | null {
  if (!signal) return null;
  const records = signal.records ?? [signal];
  const requests = records.filter(
    record => record.kind !== 'reminder' && attentionNeedsOperator(record)
  );
  const results = records.filter(record => record.kind === 'turn-end');
  const reminders = records.filter(record => record.kind === 'reminder');
  const requestUnread = requests.some(record => record.unread !== false);
  const resultUnread = results.some(record => record.unread !== false);
  const reminderUnread = reminders.some(record => record.unread !== false);
  let sourceLabel: string | null = null;
  if (requests.length && results.length) {
    sourceLabel = `${requestUnread ? 'Unread' : 'Read'} request · ${resultUnread ? 'unread' : 'read'} result`;
  } else if (requests.length) {
    sourceLabel = requestUnread ? 'Unread request' : 'Read · still needs you';
  } else if (results.length) {
    sourceLabel = resultUnread ? 'Unread result' : 'Read result';
  }
  if (reminderUnread)
    return sourceLabel ? `${sourceLabel} · marked unread` : 'Marked unread';
  return sourceLabel ?? (reminders.length ? 'Read' : null);
}
