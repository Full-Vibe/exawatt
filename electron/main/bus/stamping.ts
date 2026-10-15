/**
 * What Exawatt does to a message before any door sees it (ENG-029 C4,
 * decision `0052` §3–4): clean the text so it is only text, and stamp it.
 *
 * A message carries no authority. It is never allowed to carry a control
 * character either: a C0 or C1 control could press Ctrl-C, end a bracketed
 * paste early, submit a half-written prompt or answer a dialog through the
 * keystroke door. Line breaks and tabs are text and stay.
 */
import { randomUUID } from 'crypto';
import {
  busDeliveredText,
  type BusSender,
  type BusEndpoint,
  type MessageEnvelope,
} from '@exawatt/core';

/** A message longer than this is refused at the sender: a peer note is not
 *  a file transfer, and every door (socket line, CLI argument, paste) takes
 *  this much comfortably. */
export const BUS_MAX_TEXT_CHARS = 16_000;

export function cleanBusText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, '')
    .replace(/[ \t]+$/gm, '')
    .trim();
}

export function stampEnvelope(input: {
  projectId: string;
  from: BusSender;
  to: BusEndpoint;
  text: string;
  at: number;
  id?: string;
}): MessageEnvelope {
  return {
    id: input.id ?? `msg-${randomUUID()}`,
    projectId: input.projectId,
    from: { ...input.from },
    to: { ...input.to },
    at: input.at,
    text: input.text,
  };
}

/** The exact text the recipient receives. */
export function deliveredText(
  envelope: MessageEnvelope,
  senderHarness: string,
  projectName: string
): string {
  return busDeliveredText(envelope, { senderHarness, projectName });
}
