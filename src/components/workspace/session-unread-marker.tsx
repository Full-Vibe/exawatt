import type { SessionAttentionSignal } from './session-status';

export type SessionUnreadTreatment = 'corner-dot' | 'outer-mark';

/** Gallery candidate inside the established 16px status slot. Inspection is
 * neutral chrome; the underlying D40 glyph, color and geometry remain intact.
 * Accessibility belongs to the combined status/read explanation on its owner. */
export function SessionUnreadMarker({
  attention,
  treatment,
}: {
  attention?: SessionAttentionSignal | null;
  treatment: SessionUnreadTreatment;
}) {
  const unread = attention?.records
    ? attention.records.some(record => record.unread !== false)
    : attention && attention.unread !== false;
  if (!unread) return null;
  if (treatment === 'corner-dot') {
    return (
      <span
        aria-hidden
        data-unread-treatment={treatment}
        className="pointer-events-none absolute right-0 top-0 h-1 w-1 rounded-full bg-hud-text-dim"
      />
    );
  }
  return (
    <svg
      aria-hidden
      data-unread-treatment={treatment}
      className="pointer-events-none absolute inset-0 h-4 w-4 text-hud-text-dim"
      viewBox="0 0 16 16"
      fill="none"
    >
      <path
        d="M0.5 8a7.5 7.5 0 0 1 15 0"
        stroke="currentColor"
        strokeWidth="1"
      />
    </svg>
  );
}
