import { BandContent, BandHeading, BandSection } from './band-section';
import { DownloadCta } from './download-cta';
import { SITE_GROUND } from './site-ground';
import {
  DEFAULT_FOLD_CLOSE_VARIANT,
  foldCloseVariant,
  type FoldCloseVariantId,
} from './fold-copy';
import type { HomepageBand } from './manifest';

/**
 * The closing band (ENG-031 W3).
 *
 * Loudness is spent at the END of the page, never the beginning. This is the
 * first render of the `site-closing` rung W1 declared: 72px, four times the
 * 18px section heading, inside the measured 3x to 7x window, and the largest
 * type anywhere on the page. `BandHeadingRole` allows exactly one closing band
 * and a unit test enforces it, so the rung cannot leak into general marketing
 * use.
 *
 * Ten words or fewer, and it repeats the fold's button rather than inventing a
 * new one. Type only: no board, no product shot, nothing to look at but the
 * sentence and the way out.
 *
 * BOTTOM WEIGHTED (W6b). Centring the content in a full screen left about four
 * hundred pixels of empty ground between the requirement line and the footer
 * rule, which reads as the page having run out rather than as a pause. The
 * space above the sentence is the pause; the space below it was a gap. The
 * band still occupies its screen.
 */
export function CloseBand({
  band,
  variant = DEFAULT_FOLD_CLOSE_VARIANT,
}: {
  band: HomepageBand;
  variant?: FoldCloseVariantId;
}) {
  const copy = foldCloseVariant(variant);

  return (
    <BandSection
      band={band}
      className="items-center justify-end border-t border-white/10 text-white"
      style={{ backgroundColor: SITE_GROUND }}
      data-close-variant={copy.id}
      data-public-exhibition-surface="true"
    >
      <BandContent className="gap-10 pb-44 sm:pb-56 lg:pb-64" data-close-content>
        <BandHeading
          band={band}
          className="max-w-5xl text-balance text-white"
          data-close-line
        >
          {copy.close}
        </BandHeading>
        <DownloadCta size="close" />
      </BandContent>
    </BandSection>
  );
}
