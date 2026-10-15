/**
 * A message's delivery result as one mark: shape, color and a spoken label
 * (the Carbon rule the status iconography follows), the reason on hover.
 */
import {
  Ban,
  Check,
  CircleHelp,
  Clock3,
  Hand,
  SquareTerminal,
  TimerOff,
  type LucideIcon,
} from 'lucide-react';
import { WORKSPACE_HUD as HUD } from '@/components/workspace/workspace-theme';
import type { MessageRecord, BusDeliveryState } from '@exawatt/core';
import { DELIVERY_LABEL } from './chatter-format';

const MARK: Record<BusDeliveryState, { Icon: LucideIcon; color: string }> = {
  delivered: { Icon: Check, color: HUD.textDim },
  queued: { Icon: Clock3, color: HUD.cyan2 },
  held: { Icon: Hand, color: HUD.amber },
  terminal: { Icon: SquareTerminal, color: HUD.textDim },
  undeliverable: { Icon: Ban, color: HUD.amber },
  expired: { Icon: TimerOff, color: HUD.amber },
  unknown: { Icon: CircleHelp, color: HUD.idle },
};

export function deliveryDescription(
  delivery: MessageRecord['delivery']
): string {
  const label = DELIVERY_LABEL[delivery.state];
  return delivery.reason ? `${label}. ${delivery.reason}` : label;
}

export function DeliveryGlyph({
  delivery,
  size = 12,
  withLabel = false,
}: {
  delivery: MessageRecord['delivery'];
  size?: number;
  /** print the label beside the mark (the thread's stamp line) */
  withLabel?: boolean;
}) {
  const { Icon, color } = MARK[delivery.state];
  const description = deliveryDescription(delivery);
  return (
    <span
      data-delivery-glyph={delivery.state}
      role="img"
      aria-label={description}
      title={description}
      className="inline-flex shrink-0 items-center gap-1"
      style={{ color }}
    >
      <Icon size={size} strokeWidth={2} aria-hidden />
      {withLabel && (
        <span className="font-ui text-chrome-meta">
          {DELIVERY_LABEL[delivery.state]}
        </span>
      )}
    </span>
  );
}
