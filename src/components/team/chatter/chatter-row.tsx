/**
 * One message in the Chatter list (ENG-029 C1 live). The row shape is the
 * part the operator said "we'll iterate" on, so it is one small component
 * with one input (a message) that the list renders and the gallery shows:
 * sender → recipient with harness marks, the first line, the age, and the
 * delivery mark. The operator's own messages read "You".
 */
import { WORKSPACE_HUD as HUD } from '@/components/workspace/workspace-theme';
import { firstLine } from '@/lib/bus/selectors';
import type { MessageRecord } from '@exawatt/core';
import { chatterAge } from './chatter-format';
import {
  ChatterEndpoint,
  endpointLabel,
  type ChatterParticipants,
} from './chatter-endpoint';
import { DeliveryGlyph, deliveryDescription } from './delivery-glyph';

export function ChatterRow({
  message,
  participants,
  now,
  unread,
  selected,
  onOpen,
  onHover,
}: {
  message: MessageRecord;
  participants: ChatterParticipants;
  now: number;
  unread: boolean;
  selected: boolean;
  onOpen: () => void;
  onHover: () => void;
}) {
  const summary = `${endpointLabel(message.from, participants)} to ${endpointLabel(
    message.to,
    participants
  )}: ${firstLine(message.text)}. ${deliveryDescription(message.delivery)}${
    unread ? '. New' : ''
  }`;
  return (
    <button
      type="button"
      tabIndex={-1}
      data-chatter-row={message.id}
      data-chatter-kind={message.from.kind}
      data-delivery={message.delivery.state}
      data-unread={unread || undefined}
      data-selected={selected || undefined}
      aria-label={summary}
      onClick={onOpen}
      onMouseEnter={onHover}
      className="relative flex w-full flex-col gap-0.5 py-1.5 pl-5 pr-3 text-left outline-none"
      style={{ background: selected ? HUD.fillHi : 'transparent' }}
    >
      {unread && (
        <span
          aria-hidden
          className="absolute left-2 top-[11px] h-1.5 w-1.5 rounded-full"
          style={{ background: HUD.cyan }}
        />
      )}
      <span className="flex w-full min-w-0 items-center gap-1 font-ui text-chrome-label">
        <ChatterEndpoint endpoint={message.from} participants={participants} />
        <span aria-hidden className="shrink-0" style={{ color: HUD.textDim }}>
          →
        </span>
        <ChatterEndpoint endpoint={message.to} participants={participants} />
        <span
          className="ml-auto shrink-0 pl-1.5 font-mono text-chrome-micro tabular-nums"
          style={{ color: HUD.textDim }}
        >
          {chatterAge(message.at, now)}
        </span>
        <DeliveryGlyph delivery={message.delivery} size={11} />
      </span>
      <span
        className="block w-full truncate font-ui text-chrome-meta"
        style={{ color: unread ? HUD.text : HUD.textDim }}
      >
        {firstLine(message.text)}
      </span>
    </button>
  );
}
