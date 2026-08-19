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
        className="object-cover"
        // Cover crops the vertical on a wide frame. Held above centre so the
        // figure's head and raised hands stay inside the frame rather than
        // being trimmed by the top edge.
        style={{ objectPosition: 'center 32%' }}
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
