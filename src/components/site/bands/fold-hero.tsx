import { cn } from '@/lib/utils';
import { BandCopy, BandHeading } from './band-section';
import { DownloadCta } from './download-cta';
import {
  DEFAULT_FOLD_CLOSE_VARIANT,
  foldCloseVariant,
  type FoldCloseVariantId,
} from './fold-copy';
import { bandById } from './manifest';

const FOLD = bandById('fold');

/**
 * The fold's INTERIOR (ENG-031 W3, restructured W6b).
 *
 * WHAT CHANGED AND WHY. The fold used to centre the type over the board and
 * take the board down to about five percent behind a radial well so the type
 * could survive. Two things were wrong with that, and both were visible on
 * production: the board was reduced to a texture, which throws away the one
 * asset in the category nobody else ships; and the well is a scrim rather than
 * a layout, so the board's own anchored Project labels printed straight
 * through the headline. "Cloud Platform" ran across the h1.
 *
 * The repair is a LAYOUT, not a stronger scrim. Type on the left in clean
 * space, board on the right at full strength, cropped by the frame edge. That
 * is the Granola and Cursor treatment: a real product surface bleeding off the
 * edge reads as a window onto something larger, and nothing is printed over
 * the object. Nothing overlaps, so nothing needs to be dimmed.
 *
 * This component no longer owns a ground, a scrim, or a board. It is the
 * FIRST PANEL of the pinned sequence, which owns all three, because the page
 * mounts exactly one board and the fold is its opening frame.
 *
 * TWO-TONE HEADLINE. Where the headline runs to two lines, the last line is
 * full strength and the setup before it is set back. It puts the weight on the
 * half that is the payoff: "Tomorrow you will run 10,000.", not "Today you run
 * 10 agents." Both halves stay at one size on purpose, because the honesty of
 * the big number comes from the pair, not from the number.
 *
 * Under 26 words of reading copy, enforced in `fold-copy.test.ts` rather than
 * intended. The short-viewport rules (`globals.css`, `max-height: 520px`) are
 * reused by class name rather than re-authored.
 */
export function FoldHero({
  variant = DEFAULT_FOLD_CLOSE_VARIANT,
}: {
  variant?: FoldCloseVariantId;
}) {
  const copy = foldCloseVariant(variant);
  const lastHeadlineLine = copy.headline.length - 1;

  return (
    <div
      className="home-hero-content flex flex-col items-start gap-5 text-left sm:gap-6"
      data-fold-hero
      data-fold-content
      data-fold-variant={copy.id}
    >
      {copy.kicker ? (
        <p className="text-base text-white/55" data-fold-kicker>
          {copy.kicker}
        </p>
      ) : null}

      <BandHeading
        band={FOLD}
        className="home-hero-title text-balance text-white"
        data-fold-headline
      >
        {copy.headline.map((line, index) => (
          <span
            className={cn('block', index < lastHeadlineLine && 'text-white/50')}
            key={line}
          >
            {line}
          </span>
        ))}
      </BandHeading>

      <BandCopy
        className="home-hero-copy max-w-[26rem] text-[17px] leading-relaxed text-white/70 sm:text-lg sm:leading-relaxed"
        data-fold-subhead
      >
        {copy.subhead.map(line => (
          <span className="block" key={line}>
            {line}
          </span>
        ))}
      </BandCopy>

      {/* The one thing on the panel layer a pointer may reach. Everything else
          in the reading column is `pointer-events-none` so the board keeps its
          own hover targets. */}
      <DownloadCta align="start" className="pointer-events-auto pt-1" />
    </div>
  );
}
