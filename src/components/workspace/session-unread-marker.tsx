import {
  attentionReadLabel,
  type SessionAttentionSignal,
} from './session-status';

/** Review candidate: operator inspection uses neutral chrome, independent of
 * D40 execution/attention color. The fixed slot keeps purpose text stationary
 * when the dot disappears. Production callers opt in only after review. */
export function SessionUnreadMarker({
  attention,
}: {
  attention?: SessionAttentionSignal;
}) {
  const unread = attention && attention.unread !== false;
  const label = unread ? attentionReadLabel(attention) : null;
  return (
    <span className="inline-flex h-3 w-3 shrink-0 items-center justify-center">
      {label && (
        <span
          role="img"
          aria-label={label}
          title={label}
          className="h-1.5 w-1.5 rounded-full bg-hud-text-dim"
        />
      )}
    </span>
  );
}
