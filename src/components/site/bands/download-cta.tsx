import Link from 'next/link';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  BAND_AFFORDANCE_ATTR,
  DOWNLOAD_HREF,
  DOWNLOAD_LABEL,
  DOWNLOAD_REQUIREMENT,
} from './download';

/**
 * The one conversion control on the page (ENG-031 W3).
 *
 * Rendered identically by the fold and by the close, because the measured
 * constraint for the closing band is "repeats the fold's buttons". One
 * component, so they cannot drift.
 *
 * Decisions carried here:
 * - ONE primary CTA, not two. The measured ceiling is two with one primary,
 *   and persistent conversion already lives in the sticky header, so a second
 *   inline CTA would spend attention without adding a destination.
 * - NOTHING SITS BESIDE THE BUTTON. W12 added a `trailing` slot and the fold
 *   put its scroll chevron in it; the operator read the pair as a split
 *   button with a menu half ("the down arrow looks too much like a dropdown
 *   button and combobox"), which is what a labelled pill plus a same-height
 *   chevron square IS on every platform. The slot is deleted rather than left
 *   empty, per burn-bridges: an available slot beside a primary CTA is an
 *   invitation to rebuild the same defect. The way down is a labelled cue at
 *   the bottom of the fold's frame; see `sequence-scroll-cue.tsx`.
 * - FLAT DOM. The 3D key switch comes off the site (operator); no premium hero
 *   in the 16-site set makes its primary conversion action a mesh. This is a
 *   real anchor: hit-testable, keyboard-focusable, and legible to a crawler.
 * - WHITE ON THE AUTHORED DARK GROUND. The marketing site runs one fixed
 *   register and does not inherit the app's `--primary`, which moves with the
 *   theme contract. Highest contrast available, and stable across every theme
 *   the app ships.
 * - THE REQUIREMENT SITS AT THE BUTTON, never in a footnote. It is set in the
 *   reading face rather than in mono (operator, 2026-08-17: mono is spent ONCE
 *   on this page, on the board's own fleet chip). A tracked uppercase mono
 *   line under a conversion button reads as machine output, and the sentence
 *   it carries is written for a person.
 */
export function DownloadCta({
  className,
  size = 'fold',
  align = 'center',
}: {
  className?: string;
  /** The close repeats the fold's button; only the leading rhythm differs. */
  size?: 'fold' | 'close';
  /** The fold is a left column now; the close is still centred type. */
  align?: 'center' | 'start';
}) {
  return (
    <div
      className={cn(
        'flex flex-col gap-3',
        align === 'start' ? 'items-start' : 'items-center',
        className
      )}
      {...{ [BAND_AFFORDANCE_ATTR]: 'download' }}
    >
      <div className="flex items-center">
        <Button
          asChild
          className={cn(
            'h-11 rounded-md bg-white px-7 text-base font-semibold text-black shadow-lg hover:bg-white/90',
            size === 'close' && 'h-12 px-8 text-lg'
          )}
          data-band-download
        >
          <Link href={DOWNLOAD_HREF}>{DOWNLOAD_LABEL}</Link>
        </Button>
      </div>
      <p
        className="text-[13px] leading-snug text-white/50"
        data-band-download-requirement
      >
        {DOWNLOAD_REQUIREMENT}
      </p>
    </div>
  );
}
