import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import { cn } from '@/lib/utils';
import type { BandHeadingRole, HomepageBand } from './manifest';

/**
 * Shared band layout (ENG-031 W1).
 *
 * These components hold the measured constraints so no individual band has to
 * remember them:
 *
 * - ONE IDEA PER SCREEN. `BandSection` takes its minimum height from the
 *   band's declared `screens` (1.0 to 1.4 viewport heights), so the rhythm is
 *   data, not a per-band guess.
 * - FULL WIDTH. Every band spans the viewport; the content column is set
 *   inside it by `BandContent`, never by the section.
 * - SMALL SECTION HEADINGS, LOUD CLOSE. `BandHeading` sizes itself from the
 *   band's `headingRole`, which is the only place the page's type hierarchy is
 *   decided.
 *
 * Bands ship their own ground and their own interior. What they may not do is
 * re-decide height, width, or heading size.
 */

/**
 * Type roles for the page, in one place (design system, marketing rung,
 * amended 2026-08-16 for the closing rung).
 *
 * `headline` is the fold h1 as shipped. `section` is the 18px section rung.
 * `closing` is 72px, four times the section heading, inside the measured 3x to
 * 7x window and the largest type on the page.
 */
const HEADING_CLASS: Record<Exclude<BandHeadingRole, 'none'>, string> = {
  headline: 'text-4xl font-bold tracking-tight sm:text-6xl',
  section: 'text-lg font-semibold',
  closing: 'text-5xl font-bold tracking-tight sm:text-7xl',
};

export function BandSection({
  band,
  children,
  className,
  style,
  ...rest
}: {
  band: HomepageBand;
  children: ReactNode;
} & ComponentPropsWithoutRef<'section'>) {
  return (
    <section
      className={cn('relative flex w-full flex-col', className)}
      data-band={band.id}
      data-band-altitude={band.altitudeAnchor ?? 'none'}
      data-band-medium={band.medium}
      data-band-screens={band.screens}
      id={band.id}
      style={{ minHeight: `${band.screens * 100}vh`, ...style }}
      {...rest}
    >
      {children}
    </section>
  );
}

/**
 * The band's heading, sized by role. Renders nothing for a band that carries
 * no heading, so a band component can call it unconditionally.
 */
export function BandHeading({
  band,
  children,
  className,
  ...rest
}: {
  band: HomepageBand;
  children?: ReactNode;
} & ComponentPropsWithoutRef<'h2'>) {
  if (band.headingRole === 'none') return null;

  const content = children ?? band.heading;
  if (content === null || content === undefined) return null;

  const Tag = band.headingRole === 'headline' ? 'h1' : 'h2';

  return (
    <Tag className={cn(HEADING_CLASS[band.headingRole], className)} {...rest}>
      {content}
    </Tag>
  );
}

/** The centered content column inside a band. */
export function BandContent({
  children,
  className,
  ...rest
}: ComponentPropsWithoutRef<'div'>) {
  return (
    <div
      className={cn(
        'relative z-10 flex flex-col items-center gap-8 px-4 text-center',
        className
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

/**
 * A band's reading copy. The shared default is the MEASURE only.
 *
 * Size and leading deliberately stay with the caller and travel together:
 * tailwind-merge treats a caller's `text-*` as conflicting with a base
 * `leading-*` (Tailwind's size utilities carry their own line height), so a
 * default leading here would be silently dropped by any band that sets its own
 * size. Found by measuring the fold at 18px/29.25px before and 18px/28px after.
 */
export function BandCopy({
  children,
  className,
  ...rest
}: ComponentPropsWithoutRef<'p'>) {
  return (
    <p className={cn('w-full max-w-3xl', className)} {...rest}>
      {children}
    </p>
  );
}
