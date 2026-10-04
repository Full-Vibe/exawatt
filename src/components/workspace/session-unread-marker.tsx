import { attentionIsUnread, type SessionAttentionSignal } from '@exawatt/core';
import { UNREAD_CORNER_MARK } from '@/components/status-light/inspection';

/** Neutral inspection detail inside the existing status slot. The owner
 * supplies one combined accessible explanation for work and read state. */
export function SessionUnreadMarker({
  attention,
}: {
  attention?: SessionAttentionSignal | null;
}) {
  if (!attentionIsUnread(attention)) return null;
  return (
    <span
      aria-hidden
      data-session-unread
      className="pointer-events-none absolute rounded-full bg-hud-text-dim"
      style={{
        width: UNREAD_CORNER_MARK.diameter,
        height: UNREAD_CORNER_MARK.diameter,
        top: UNREAD_CORNER_MARK.inset,
        right: UNREAD_CORNER_MARK.inset,
      }}
    />
  );
}
