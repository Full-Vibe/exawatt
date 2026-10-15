/**
 * Pure reads over a Project's messages. Nothing here summarizes, scores,
 * flags or counts rounds (decision `0052`); the only number derived is
 * unread, which is the operator's own reading position.
 */
import { BUS_OPERATOR } from './operator';
import type { BusMessage } from './types';

/** Ledger order (oldest first), with a later record for an id replacing it:
 *  how a `queued` message becomes `delivered` without a second row. */
export function upsertMessage(
  messages: readonly BusMessage[],
  message: BusMessage
): BusMessage[] {
  const index = messages.findIndex(existing => existing.id === message.id);
  if (index >= 0) {
    const next = messages.slice();
    next[index] = message;
    return next;
  }
  const next = [...messages, message];
  // a push can arrive before the read it belongs after; keep ledger order
  if (messages.length > 0 && message.at < messages[messages.length - 1].at) {
    next.sort((a, b) => a.at - b.at);
  }
  return next;
}

export function newestFirst(messages: readonly BusMessage[]): BusMessage[] {
  return messages.slice().sort((a, b) => b.at - a.at);
}

/**
 * The conversation between two Sessions, oldest first: what each said to the
 * other, plus anything the operator said to either of them, so a reply sent
 * from the thread stays in the thread.
 */
export function threadOf(
  messages: readonly BusMessage[],
  a: string,
  b: string
): BusMessage[] {
  const pair = new Set([a, b]);
  return messages.filter(message => {
    const from = message.from.sessionId;
    const to = message.to.sessionId;
    if (pair.has(from) && pair.has(to) && from !== to) return true;
    return (
      message.kind === 'operator' &&
      from === BUS_OPERATOR.sessionId &&
      pair.has(to)
    );
  });
}

export function firstLine(text: string): string {
  const line = text.split('\n').find(candidate => candidate.trim() !== '');
  return (line ?? '').trim();
}

/** A message counts as unread when it arrived after the operator's reading
 *  position. The operator's own messages are never unread. */
function isUnread(message: BusMessage, seenThrough: number): boolean {
  return message.kind !== 'operator' && message.at > seenThrough;
}

export function unreadCount(
  messages: readonly BusMessage[],
  seenThrough: number
): number {
  let count = 0;
  for (const message of messages) {
    if (isUnread(message, seenThrough)) count += 1;
  }
  return count;
}

/** Unread messages one Agent sent or received: the count Fleet's selection
 *  panel shows on a selected Agent (ENG-004 V4.2). */
export function agentUnreadCount(
  messages: readonly BusMessage[],
  seenThrough: number,
  sessionId: string
): number {
  let count = 0;
  for (const message of messages) {
    if (
      isUnread(message, seenThrough) &&
      (message.from.sessionId === sessionId ||
        message.to.sessionId === sessionId)
    ) {
      count += 1;
    }
  }
  return count;
}

/** The newest stamp in a list, the position "I have read all of this" marks. */
export function latestAt(messages: readonly BusMessage[]): number {
  let latest = 0;
  for (const message of messages) latest = Math.max(latest, message.at);
  return latest;
}
