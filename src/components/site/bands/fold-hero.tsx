import { cn } from '@/lib/utils';
import { BandContent, BandCopy, BandHeading } from './band-section';
import { DownloadCta } from './download-cta';
import { FoldBackground } from './fold-background';
import {
  DEFAULT_FOLD_CLOSE_VARIANT,
  foldCloseVariant,
  type FoldCloseVariantId,
} from './fold-copy';
import { bandById } from './manifest';

const FOLD = bandById('fold');

/**
 * The fold, as it ships (ENG-031 W3).
 *
 * The band owns height, width and heading role; this owns what is inside it.
 * Everything a reader sees above the fold is here: kicker, headline, subhead,
 * one primary button, and the requirement line at that button. Under 26 words
 * of reading copy, enforced in `fold-copy.test.ts` rather than intended.
 *
 * TWO-TONE HEADLINE. Where the headline runs to two lines, the last line is
 * full strength and the setup before it is set back. That is the same
 * treatment the brief specifies for the thesis band, and it puts the weight on
 * the half that is the payoff: "Tomorrow you will run 10,000.", not "Today you
 * run 10 agents." Both halves stay at 60px on purpose, because the honesty of
 * the big number comes from the pair, not from the number.
 *
 * The short-viewport rules (`globals.css`, `max-height: 520px`) are reused by
 * class name rather than re-authored, so a laptop at 1280x800 with browser
 * chrome open still lands the button above the fold edge.
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
      className="relative flex flex-1 items-center justify-center bg-black pt-12"
      data-fold-hero
      data-fold-variant={copy.id}
      data-public-exhibition-surface="true"
    >
      <FoldBackground />
      <div className="absolute inset-0 bg-gradient-to-b from-black/70 via-black/50 to-black/80" />

      <BandContent className="home-hero-content gap-6" data-fold-content>
        {/* The kicker is a SENTENCE, so it is set in the reading face. The
            design system reserves mono for tracked micro-labels at 11px and
            below; a demoted line in 12px mono read as a code comment and made
            the demotion look worse than it is. It sits tight above the
            headline rather than as a separate block. */}
        <div className="flex flex-col items-center gap-2 sm:gap-3">
          {copy.kicker ? (
            <p
              className="text-sm text-white/60 drop-shadow-md sm:text-base"
              data-fold-kicker
            >
              {copy.kicker}
            </p>
          ) : null}

          <BandHeading
            band={FOLD}
            className="home-hero-title max-w-4xl text-balance text-white drop-shadow-lg"
            data-fold-headline
          >
            {copy.headline.map((line, index) => (
              <span
                className={cn(
                  'block',
                  index < lastHeadlineLine && 'text-white/55'
                )}
                key={line}
              >
                {line}
              </span>
            ))}
          </BandHeading>
        </div>

        <BandCopy
          className="home-hero-copy max-w-2xl text-base leading-relaxed text-white/75 drop-shadow-md sm:text-xl sm:leading-relaxed"
          data-fold-subhead
        >
          {copy.subhead.map(line => (
            <span className="block" key={line}>
              {line}
            </span>
          ))}
        </BandCopy>

        <DownloadCta className="pt-2" />
      </BandContent>
    </div>
  );
}
