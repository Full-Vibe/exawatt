import { attentionRecordKey, attentionRecords } from '@exawatt/core';
import { agentSourceDeclaration } from './pty/generated-agent-source-declarations';
import type {
  PtyAttention,
  PtyAttentionRecord,
  PtySessionRecord,
} from '@exawatt/core/desktop-bridge';

export function shouldDeliverNativeNotification(
  enabled: boolean,
  windowFocused: boolean,
  attention: PtyAttention | null
): boolean {
  return (
    enabled &&
    !windowFocused &&
    attention !== null &&
    attention.unread !== false
  );
}

/** Recheck the exact source fact after the asynchronous permission status read. */
export function isCurrentAttentionAlert(
  current: PtyAttention | null,
  alert: PtyAttentionRecord
): boolean {
  if (!current) return false;
  return attentionRecords(current).some(
    record =>
      attentionRecordKey(record) === attentionRecordKey(alert) &&
      record.since === alert.since &&
      record.unread !== false
  );
}

export function nativeNotificationCopy(session: PtySessionRecord): {
  title: string;
  body: string;
} {
  const harness =
    session.harness === 'shell'
      ? 'Session'
      : agentSourceDeclaration(session.harness).label;
  return {
    title: session.title || harness,
    body: `${harness} needs your attention in ${session.projectName}.`,
  };
}
