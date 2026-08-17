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
 *   inline CTA would spend attention without adding a destination. The slot
 *   stays open for W6, which owns the nav.
 * - FLAT DOM. The 3D key switch comes off the site (operator); no premium hero
 *   in the 16-site set makes its primary conversion action a mesh. This is a
 *   real anchor: hit-testable, keyboard-focusable, and legible to a crawler.
 * - WHITE ON THE AUTHORED DARK GROUND. The marketing site runs one fixed
 *   register and does not inherit the app's `--primary`, which moves with the
 *   theme contract. Highest contrast available, and stable across every theme
 *   the app ships.
 * - THE REQUIREMENT SITS AT THE BUTTON, in mono, never in a footnote.
 */
export function DownloadCta({
  className,
  size = 'fold',
}: {
  className?: string;
  /** The close repeats the fold's button; only the leading rhythm differs. */
  size?: 'fold' | 'close';
}) {
  return (
    <div
      className={cn('flex flex-col items-center gap-3', className)}
      {...{ [BAND_AFFORDANCE_ATTR]: 'download' }}
    >
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
      <p
        className="font-mono text-chrome-label text-white/55"
        data-band-download-requirement
      >
        {DOWNLOAD_REQUIREMENT}
      </p>
    </div>
  );
}
