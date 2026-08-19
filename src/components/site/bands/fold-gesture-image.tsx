import Image from 'next/image';
import { spatialColorWithAlpha } from '@/components/fleet/spatial/spatial-theme';
import { cn } from '@/lib/utils';
import { SITE_GROUND } from './site-ground';

/**
 * The fold's opening frame: a human commanding by gesture (ENG-031 W11).
 *
 * The asset and its use on the production homepage are a recorded, dated,
 * ACCEPTED operator decision (`docs/product/marketing.md`, 2026-08-17, and the
 * roadmap's amendment chain: "I don't care, we're tiny, if there's an issue
 * later we'll deal with it. Don't take it down."). It is not re-litigated
 * here; this file only decides how it is COMPOSED.
 *
 * WHY IT IS NOT A `bg-black` SCRIM. The layer under this one is the board, and
 * the board paints one specific ground. Every gradient here is mixed from that
 * same ground rather than from black, so the dissolve is one picture becoming
 * another picture on an unchanging floor, with no colour step at either end.
 *
 * TWO GRADIENTS, EACH DOING ONE JOB.
 *
 * - A vertical wash that keeps the site header and the requirement line
 *   legible and settles the bottom edge into the board's ground. Light on
 *   purpose: `/` needed `black/70` through the middle because its type was
 *   CENTRED over the figure, and this fold's type is not.
 * - A reading-column wash on the left, desktop only, because the fold's type
 *   lives in the left 40% of the frame and the figure's raised hand reaches
 *   into it. This is the same repair W6b made for the board itself: give the
 *   type its own space in the LAYOUT instead of dimming the whole picture to
 *   carry it. Below `md` there is no column beside the image, so there is no
 *   wash either.
 *
 * A PHONE LETTERBOXES RATHER THAN CROPS (ENG-031 W13, operator: "at least
 * just constrain it, it's fine, mobile users are used to watching landscape
 * videos in portrait anyway"). The asset is 3:2 and the fold's frame on a
 * phone is portrait, so `cover` either trims the raised hands off the sides or
 * the head off the top depending on which way the box leans. `contain` against
 * the page's own ground keeps the whole composition, and because the ground
 * behind it is the same colour the board paints, the bars are not bars: the
 * picture simply ends. It is held to the TOP of its band so the type the fold
 * prints over it lands on the picture's lower edge rather than on empty
 * ground. Above `md` the fold is a landscape frame with the type beside the
 * board, so `cover` is right there and stays.
 *
 * SIZES. Rendered full-bleed in its box at every viewport, so `100vw` is the
 * honest hint and the optimizer serves one derivative per real breakpoint.
 * `next/image` negotiates AVIF then WebP and falls back to the PNG, which is
 * why no second copy of a likeness-bearing asset is checked into the tree.
 */
export function FoldGestureImage({
  priority = false,
  className,
  ...rest
}: {
  /** Only the layer that is actually painted at scroll zero preloads. */
  priority?: boolean;
  className?: string;
} & Record<`data-${string}`, string | undefined>) {
  return (
    <div
      className={cn('absolute inset-0 overflow-hidden', className)}
      // The layer ON TOP, so it leaves last and the frame never dips through a
      // luminance trough mid-dissolve. Opacity is written by the sequence's
      // scroll pass as a custom property, never by React at frame rate.
      style={{ opacity: 'var(--fold-image-opacity, 1)' }}
      {...rest}
    >
      <Image
        src="/images/hero-bg.png"
        alt=""
        fill
        sizes="100vw"
        priority={priority}
        loading={priority ? undefined : 'lazy'}
        className="object-contain object-top md:object-cover md:object-[center_32%]"
        data-fold-gesture-image
      />
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          background: `linear-gradient(to bottom, ${spatialColorWithAlpha(
            SITE_GROUND,
            0.62
          )} 0%, ${spatialColorWithAlpha(
            SITE_GROUND,
            0.18
          )} 34%, ${spatialColorWithAlpha(
            SITE_GROUND,
            0.4
          )} 74%, ${spatialColorWithAlpha(SITE_GROUND, 0.88)} 100%)`,
        }}
      />
      {/* THE PORTRAIT WASH (W13). The desktop fold gives its type a column and
          washes the picture left to right behind it; a phone has no column, so
          the same idea turns ninety degrees and the wash comes UP from the
          bottom under the words. It starts at the picture's own lower edge and
          is opaque by the time it reaches the button, so the headline sits on
          the image with nothing dimmed above it. Phone only, for the same
          reason the left wash is desktop only: each answers a layout the other
          does not have. */}
      <div
        aria-hidden
        className="absolute inset-0 md:hidden"
        style={{
          background: `linear-gradient(to top, ${spatialColorWithAlpha(
            SITE_GROUND,
            0.97
          )} 0%, ${spatialColorWithAlpha(
            SITE_GROUND,
            0.9
          )} 34%, ${spatialColorWithAlpha(
            SITE_GROUND,
            0.45
          )} 56%, ${spatialColorWithAlpha(SITE_GROUND, 0)} 74%)`,
        }}
      />
      <div
        aria-hidden
        className="absolute inset-0 hidden md:block"
        style={{
          background: `linear-gradient(to right, ${spatialColorWithAlpha(
            SITE_GROUND,
            0.94
          )} 0%, ${spatialColorWithAlpha(
            SITE_GROUND,
            0.86
          )} 26%, ${spatialColorWithAlpha(
            SITE_GROUND,
            0.42
          )} 46%, ${spatialColorWithAlpha(SITE_GROUND, 0)} 66%)`,
        }}
      />
    </div>
  );
}
