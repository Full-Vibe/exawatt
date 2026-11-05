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
 * A message to several recipients names the others to each (BUG-329): who
 * else was addressed is delivery metadata, not a coordination pattern, so
 * decision `0052` (no productized debate, no policing) is unchanged.
 *
 * An operator message is the user's own turn and is typed as written: no
 * stamp, one line naming the other recipients when there are any, and a
 * leading `/` is the operator's command, typed exactly.
 */
import type {
  BusEndpoint,
  BusSendResult,
  MessageEnvelope,
  MessageRecord,
  RecipientDelivery,
} from './types';

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
  /** The send tool the recipient's own tool list carries (ENG-029 B2), when
   *  its harness takes the MCP door; offered first because it works where a
   *  shell sandbox refuses the `exawatt` command's network request. */
  replyTool?: string | null;
  /** The recipient's own sandbox refuses the `exawatt` command's network
   *  request (Codex's workspace-write, B2). Said plainly when it has no
   *  send tool, so a refused reply is not a mystery. */
  replyCommandSandboxed?: boolean;
}

/** The other recipients of a message, as the one reading it sees them. */
function coRecipients(
  envelope: MessageEnvelope,
  recipientSessionId: string
): BusEndpoint[] {
  return envelope.to.filter(
    endpoint => endpoint.sessionId !== recipientSessionId
  );
}

/** `@a`, `@a and @b`, `@a, @b and @c`. */
function handleList(handles: readonly string[]): string {
  const named = handles.map(handle => `@${handle}`);
  return named.length <= 1
    ? (named[0] ?? '')
    : `${named.slice(0, -1).join(', ')} and ${named[named.length - 1]}`;
}

/** How the recipient reaches `to` (one handle, or several joined by
 *  commas, which `exawatt send` and the send tool both take). */
function reachWith(
  to: string,
  labels: BusStampLabels,
  purpose: 'reply' | 'reach'
): string {
  const verb = purpose === 'reply' ? 'Reply' : 'Reach them';
  const command = `exawatt send ${to} "<your ${purpose === 'reply' ? 'reply' : 'message'}>"`;
  return labels.replyTool
    ? `${verb} with your ${labels.replyTool} tool (to: ${to}) or run: ${command}`
    : labels.replyCommandSandboxed
      ? `${verb} with: ${command} (your sandbox may block it from reaching Exawatt; if it does, ask to run it outside the sandbox)`
      : `${verb} with: ${command}`;
}

/** The first line a recipient Agent reads: who sent it, who else received
 *  it, and how to answer. Never starts with `/`. */
export function busStampLine(
  envelope: MessageEnvelope,
  labels: BusStampLabels,
  recipientSessionId: string
): string {
  const handle = busHandle(envelope.from.name);
  const others = coRecipients(envelope, recipientSessionId).map(endpoint =>
    busHandle(endpoint.name)
  );
  return (
    `[Exawatt] Message from @${handle} (${labels.senderHarness}) ` +
    (others.length ? `to you and ${handleList(others)} ` : '') +
    `in Project ${labels.projectName}. ` +
    reachWith(`@${handle}`, labels, 'reply')
  );
}

/** The whole text one recipient's harness receives for a message.
 *
 *  An operator message to one Agent is the operator's turn, typed exactly as
 *  written. Sent to several, it opens with one line naming the others, so
 *  each knows who else was asked and how to reach them, unless it is a
 *  command (a leading `/`), which stays the operator's command. */
export function busDeliveredText(
  envelope: MessageEnvelope,
  labels: BusStampLabels,
  recipientSessionId: string
): string {
  if (envelope.from.kind !== 'operator')
    return `${busStampLine(envelope, labels, recipientSessionId)}\n\n${envelope.text}`;
  const others = coRecipients(envelope, recipientSessionId).map(endpoint =>
    busHandle(endpoint.name)
  );
  if (!others.length || envelope.text.startsWith('/')) return envelope.text;
  const reach = others.map(other => `@${other}`).join(',');
  return (
    `[Exawatt] The operator sent this to you and ${handleList(others)}. ` +
    `${reachWith(reach, labels, 'reach')}\n\n${envelope.text}`
  );
}

/** The recipients one `to` names: Session ids or `@handles`, separated by
 *  commas or spaces, each once, in the order named. */
export function busRecipientList(to: string): string[] {
  return [
    ...new Set(
      to
        .split(/[\s,]+/)
        .map(part => part.trim())
        .filter(Boolean)
    ),
  ];
}

/** One recipient's delivery, when the message was sent to it. */
export function busDeliveryTo(
  record: MessageRecord,
  sessionId: string
): RecipientDelivery | undefined {
  return record.deliveries.find(entry => entry.sessionId === sessionId);
}

/** Whether a message was sent to this address. */
export function busIsRecipient(
  envelope: Pick<MessageEnvelope, 'to'>,
  sessionId: string
): boolean {
  return envelope.to.some(endpoint => endpoint.sessionId === sessionId);
}

/** Why the Demo never sends: its Agents are authored, so a delivery to them
 *  would be invented. Direct shows it before Send; every Demo send answers it. */
export const DEMO_BUS_SEND_REASON = 'Demo cannot send';

/** The one answer every Demo send gets. */
export function demoBusSendResult(): BusSendResult {
  return { ok: false, reason: DEMO_BUS_SEND_REASON };
}

/** Every message between two addresses, either direction, oldest first:
 *  one sent by either with the other among its recipients. */
export function busThread(
  records: readonly MessageRecord[],
  a: string,
  b: string
): MessageRecord[] {
  return records
    .filter(
      record =>
        (record.from.sessionId === a && busIsRecipient(record, b)) ||
        (record.from.sessionId === b && busIsRecipient(record, a))
    )
    .sort((x, y) => x.at - y.at);
}
