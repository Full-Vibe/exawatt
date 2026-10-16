/**
 * Exawatt's stamp on a message (ENG-029 C4, decision `0052` §4).
 *
 * The receiving model must know it is reading another Agent, not its user,
 * who that Agent is, and how to answer. Claude Code labels every outside post
 * "Another Claude session sent a message" from "an unidentified session"
 * (B0, 2026-10-15), so the stamp's FIRST line names the real sender, its
 * harness and the Project. The stamp also comes first so a pasted message can
 * never begin with `/`, which Antigravity would execute as a command.
 *
 * An operator message is the user's own turn and is typed exactly as written:
 * no stamp, and a leading `/` is the operator's command.
 */
import type { BusSendResult, MessageEnvelope, MessageRecord } from './types';

/** The `@handle` a sender types for a name: an Agent name as it is (names
 *  are addressed without case), anything else folded to letters, digits,
 *  `_` and `-`. */
export function busHandle(name: string): string {
  const handle = name
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_-]+/gu, '-')
    .replace(/^-+|-+$/g, '');
  return handle || 'agent';
}

export interface BusStampLabels {
  /** The sender's harness as the operator reads it (`Codex`, `Gemini`). */
  senderHarness: string;
  /** The Project's display name. */
  projectName: string;
}

/** The first line a recipient Agent reads. Never starts with `/`. */
export function busStampLine(
  envelope: MessageEnvelope,
  labels: BusStampLabels
): string {
  const handle = busHandle(envelope.from.name);
  return (
    `[Exawatt] Message from @${handle} (${labels.senderHarness}) in Project ` +
    `${labels.projectName}. Reply with: exawatt send @${handle} "<your reply>"`
  );
}

/** The whole text a recipient harness receives for one message. */
export function busDeliveredText(
  envelope: MessageEnvelope,
  labels: BusStampLabels
): string {
  if (envelope.from.kind === 'operator') return envelope.text;
  return `${busStampLine(envelope, labels)}\n\n${envelope.text}`;
}

/** Why the Demo never sends: its Agents are authored, so a delivery to them
 *  would be invented. Direct shows it before Send; every Demo send answers it. */
export const DEMO_BUS_SEND_REASON = 'Demo cannot send';

/** The one answer every Demo send gets. */
export function demoBusSendResult(): BusSendResult {
  return {
    delivery: {
      state: 'undeliverable',
      reason: DEMO_BUS_SEND_REASON,
      adapter: 'demo',
    },
    record: null,
  };
}

/** Every message between two addresses, either direction, oldest first. */
export function busThread(
  records: readonly MessageRecord[],
  a: string,
  b: string
): MessageRecord[] {
  return records
    .filter(
      record =>
        (record.from.sessionId === a && record.to.sessionId === b) ||
        (record.from.sessionId === b && record.to.sessionId === a)
    )
    .sort((x, y) => x.at - y.at);
}
