/**
 * Who a message went to, and what each recipient's door did with it. One
 * recipient keeps the row's single delivery mark at its end; a message to
 * several marks each recipient beside its name, because each door answers
 * on its own (BUG-329: one message, one delivery to each named recipient).
 */
import { busDeliveryTo, type MessageRecord } from '@exawatt/core';
import {
  ChatterEndpoint,
  endpointLabel,
  type ChatterParticipants,
} from './chatter-endpoint';
import { DeliveryGlyph, deliveryDescription } from './delivery-glyph';

/** `claude-4: Delivered; codex-4: Queued for its next turn`, for a label. */
export function recipientsDescription(
  message: MessageRecord,
  participants: ChatterParticipants
): string {
  return message.to
    .map(endpoint => {
      const entry = busDeliveryTo(message, endpoint.sessionId);
      const label = endpointLabel(endpoint, participants);
      return entry ? `${label}: ${deliveryDescription(entry.delivery)}` : label;
    })
    .join('; ');
}

/** The recipients of a row or thread message's first line. */
export function ChatterRecipients({
  message,
  participants,
}: {
  message: MessageRecord;
  participants: ChatterParticipants;
}) {
  const several = message.to.length > 1;
  return (
    <span
      data-chatter-recipients={message.to.length}
      className={`flex min-w-0 items-center overflow-hidden ${several ? 'gap-2' : 'gap-1'}`}
    >
      {message.to.map(endpoint => {
        const entry = busDeliveryTo(message, endpoint.sessionId);
        return (
          <span
            key={endpoint.sessionId}
            data-chatter-recipient-delivery={entry?.delivery.state}
            className="flex min-w-0 items-center gap-1"
          >
            <ChatterEndpoint endpoint={endpoint} participants={participants} />
            {several && entry && (
              <DeliveryGlyph delivery={entry.delivery} size={10} />
            )}
          </span>
        );
      })}
    </span>
  );
}

/** The sender of a row or thread message: it keeps its name readable
 *  beside several recipients, up to a share of the line. */
export function ChatterSender({
  message,
  participants,
  strong = false,
}: {
  message: MessageRecord;
  participants: ChatterParticipants;
  strong?: boolean;
}) {
  return (
    <span className="flex min-w-0 max-w-[40%] shrink-0">
      <ChatterEndpoint
        endpoint={message.from}
        participants={participants}
        strong={strong}
      />
    </span>
  );
}

/** The single recipient's mark, for the end of a row; null for several. */
export function SoleDeliveryGlyph({ message }: { message: MessageRecord }) {
  if (message.to.length !== 1) return null;
  const entry = busDeliveryTo(message, message.to[0].sessionId);
  return entry ? <DeliveryGlyph delivery={entry.delivery} size={11} /> : null;
}
