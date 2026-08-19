import Link from 'next/link';
import type { ReactNode } from 'react';
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
 * - A `trailing` SLOT, filled only by the fold (ENG-031 W12, operator: "put a
 *   second CTA next to download like an arrow button to indicate
 *   scrollability"). It sits in the button's own row rather than under it, so
 *   the requirement line still reads as belonging to the download and the two
 *   controls read as one row. The close leaves it empty: there is nothing
 *   below the close to point at.
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
  trailing,
}: {
  className?: string;
  /** The close repeats the fold's button; only the leading rhythm differs. */
  size?: 'fold' | 'close';
  /** The fold is a left column now; the close is still centred type. */
  align?: 'center' | 'start';
  /** A quiet second control beside the button. The fold's way down. */
  trailing?: ReactNode;
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
      <div className="flex items-center gap-3">
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
        {trailing}
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
