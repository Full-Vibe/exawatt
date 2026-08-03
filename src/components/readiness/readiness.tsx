/**
 * The app-wide readiness grammar (ENG-026 N0) — one shared component set for
 * the three readiness states the navigation manifest carries
 * (`src/components/nav/surfaces.ts`): `live`, `preview`, `announced`.
 *
 * The operator's principle is to show surfaces and affordances even when they
 * are not built, because the information architecture is how the product is
 * communicated ahead of demos. The hard constraint on that principle is that
 * NOTHING MAY MASQUERADE AS WORKING. So the grammar is one visual family,
 * deliberately dull rather than decorative:
 *
 *   - the neutral grey below — never a status color, never a data channel —
 *     so an unbuilt thing can never be mistaken for state or data;
 *   - a dashed stroke at every scale (marker pill, control chip, block
 *     outline) as the "drawing of a thing, not the thing" mark;
 *   - **Coming soon** as the single app-wide phrase (it superseded ENG-003's
 *     provisional `Coming later`; ENG-008 E4's `designed, not built` tag
 *     folded into it — this file is that treatment's descendant).
 *
 * Scales:
 *   - `ComingSoonMarker` / `SurfaceReadinessMarker` — the one persistent,
 *     unobtrusive marker in a `preview` surface's header. One per surface;
 *     no banners, no repeated disclaimers.
 *   - `AnnouncedChip` — a control-sized `announced` affordance: muted,
 *     `cursor: default`, tooltip naming what is coming. Reads as *not yet*,
 *     which is a different visual fact from disabled or broken.
 *   - `Unbuilt` / `UnbuiltLegend` (`./unbuilt`) — a block-scale region drawn
 *     inert, for a designed control surface inside a live page.
 *
 * Server-safe: pure markup over `hud/tokens`; no hooks, no client boundary.
 * Design kernel citations: chrome-micro/chrome-label rungs, sentence case
 * (no all-caps words), `rounded` chrome radius, constant footprint.
 */
import type { CSSProperties, ReactNode } from 'react';
import { withAlpha } from '@/components/hud/tokens';
import { surfaceById, type AppSurface } from '@/components/nav/surfaces';

/**
 * The readiness neutral. Deliberately the same value as consumption's
 * `FLUX.unknown` — the E4 ancestor this grammar generalizes — and deliberately
 * outside every status, attention, consumption, and identity channel
 * (design-system.md, channel-ownership rule).
 */
export const READINESS_NEUTRAL = '#77839A';

const STROKE = withAlpha(READINESS_NEUTRAL, 0.55);

/**
 * The app-wide token, as a pill. Place it once in a `preview` surface's
 * header. `owner` names what ships it, in the product's own vocabulary.
 */
export function ComingSoonMarker({
  owner,
  className = '',
}: {
  owner?: string;
  className?: string;
}) {
  return (
    <span
      data-readiness="preview"
      className={`inline-flex shrink-0 items-baseline gap-1.5 whitespace-nowrap rounded px-2 py-0.5 font-ui text-chrome-micro ${className}`}
      style={{
        border: `1px dashed ${STROKE}`,
        color: READINESS_NEUTRAL,
        background: withAlpha(READINESS_NEUTRAL, 0.06),
      }}
    >
      Coming soon
      {owner && (
        <span style={{ color: withAlpha(READINESS_NEUTRAL, 0.8) }}>
          · {owner}
        </span>
      )}
    </span>
  );
}

/**
 * Renders the marker a surface's manifest readiness calls for — nothing when
 * `live`. This is what makes shipping a one-line manifest flip: the page keeps
 * this component and the marker removes itself.
 */
export function SurfaceReadinessMarker({
  surfaceId,
  className,
}: {
  surfaceId: AppSurface['id'];
  className?: string;
}) {
  const surface = surfaceById(surfaceId);
  if (surface.readiness === 'live') return null;
  return <ComingSoonMarker className={className} />;
}

/**
 * An `announced` affordance at control scale: the map shows the control, the
 * control does nothing, and it says so. Contents render `inert` — not
 * focusable, not clickable, not tabbable — so it cannot be operated or read
 * as merely disabled-by-error.
 */
export function AnnouncedChip({
  children,
  /** What is coming, named for the tooltip: `Coming soon — {coming}`. */
  coming,
  /**
   * `control` is the default, control-sized chip. `micro` is the badge-tier
   * cut (design kernel: chip/badge `px-1.5 py-0.5`, chrome-micro) for dense
   * rows — Sessions-card headers — where a control-sized chip would outweigh
   * the real signals beside it.
   */
  size = 'control',
  className = '',
  style,
}: {
  children: ReactNode;
  coming: string;
  size?: 'control' | 'micro';
  className?: string;
  style?: CSSProperties;
}) {
  const sizing =
    size === 'micro'
      ? 'gap-1 px-1.5 py-0.5 text-chrome-micro'
      : 'gap-1.5 px-2 py-1 text-chrome-label';
  return (
    <span
      data-readiness="announced"
      title={`Coming soon — ${coming}`}
      aria-label={`${coming} — coming soon`}
      className={`inline-flex cursor-default select-none items-center rounded font-ui ${sizing} ${className}`}
      style={{
        border: `1px dashed ${STROKE}`,
        color: READINESS_NEUTRAL,
        ...style,
      }}
    >
      <span inert className="inline-flex items-center gap-1.5 opacity-80">
        {children}
      </span>
    </span>
  );
}
