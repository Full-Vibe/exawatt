/**
 * "Coming soon" at block scale — a designed region drawn inert (ENG-026 N0).
 *
 * Migrated from `src/components/consumption/unbuilt.tsx` (ENG-008 E4), which
 * was the Consumption-local ancestor of the app-wide readiness grammar. One
 * treatment, used everywhere an unbuilt control surface appears inside a live
 * page:
 *
 *   - a dashed outline in the readiness neutral, never a status or data
 *     channel, so an unbuilt thing can never be mistaken for data;
 *   - a tag carrying the app-wide token plus what would build it, on every
 *     instance;
 *   - contents rendered `inert`: not focusable, not clickable, not tabbable,
 *     and announced to assistive technology as a preview.
 *
 * An unbuilt affordance should look like a drawing of a control, not like a
 * control. The convention is explained once, in `UnbuiltLegend`, wherever a
 * reader meets their first instance of it.
 */
import type { ReactNode } from 'react';
import { READINESS_NEUTRAL } from './readiness';

const READINESS_COLOR = `var(--exa-readiness-neutral, ${READINESS_NEUTRAL})`;
const OUTLINE = `color-mix(in srgb, ${READINESS_COLOR} 55%, transparent)`;

export function Unbuilt({
  children,
  /** What would build this, in the operator's own vocabulary. */
  owner,
  /** One line on what the reader is looking at. */
  note,
  className = '',
}: {
  children: ReactNode;
  owner: string;
  note?: string;
  className?: string;
}) {
  return (
    <div className={`relative ${className}`}>
      <div
        className="rounded-md px-5 pb-5 pt-7"
        style={{
          border: `1px dashed ${OUTLINE}`,
          background: 'var(--exa-readiness-surface)',
        }}
      >
        <span
          data-readiness="announced"
          className="absolute left-4 top-[-9px] inline-flex items-center gap-1.5 rounded px-2 py-0.5 font-ui text-chrome-micro"
          style={{
            background: 'var(--exa-foundation-overlay)',
            border: `1px dashed ${OUTLINE}`,
            color: READINESS_COLOR,
          }}
        >
          Coming soon
          <span
            style={{
              color:
                'color-mix(in srgb, var(--exa-hud-text-dim) 75%, transparent)',
            }}
          >
            · {owner}
          </span>
        </span>

        {/* `inert` is the whole promise: a preview cannot be operated, focused,
            or reached by keyboard, so it cannot be mistaken for a control. */}
        <div inert className="select-none" style={{ opacity: 0.62 }}>
          {children}
        </div>

        {note && (
          <p
            className="mt-4 text-chrome-title"
            style={{
              color:
                'color-mix(in srgb, var(--exa-hud-text-dim) 95%, transparent)',
            }}
          >
            {note}
          </p>
        )}
      </div>
    </div>
  );
}

/** The one place the convention is stated. Put it where the first one appears. */
export function UnbuiltLegend({ className = '' }: { className?: string }) {
  return (
    <p
      className={`flex flex-wrap items-center gap-2 text-chrome-title ${className}`}
      style={{ color: 'var(--exa-hud-text-dim)' }}
    >
      <span
        aria-hidden
        className="inline-block h-3 w-8 shrink-0 rounded-[2px]"
        style={{ border: `1px dashed ${OUTLINE}` }}
      />
      <span>
        A dashed outline marks a control that is{' '}
        <strong style={{ color: 'var(--exa-hud-text)', fontWeight: 600 }}>
          designed, not built
        </strong>
        . It does not respond to clicks, focus, or the keyboard.
      </span>
    </p>
  );
}
