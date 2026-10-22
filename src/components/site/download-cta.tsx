import Link from 'next/link';
import { Button } from '@/components/ui/button';
import {
  DOWNLOAD_HREF,
  DOWNLOAD_LABEL,
  DOWNLOAD_REQUIREMENT,
} from './download';

/**
 * The homepage's download button (ENG-031 W3, cut to the homepage's own use
 * in W31 when the band stack it was drawn for was deleted).
 *
 * Decisions carried here:
 * - ONE primary CTA, not two. The measured ceiling is two with one primary,
 *   and persistent conversion already lives in the sticky header, so a second
 *   inline CTA would spend attention without adding a destination.
 * - NOTHING SITS BESIDE THE BUTTON. W12 added a `trailing` slot and put a
 *   scroll chevron in it; the operator read the pair as a split button with a
 *   menu half ("the down arrow looks too much like a dropdown button and
 *   combobox"), which is what a labelled pill plus a same-height chevron
 *   square IS on every platform. The slot is deleted rather than left empty,
 *   per burn-bridges: an available slot beside a primary CTA is an invitation
 *   to rebuild the same defect. A second choice of its own is not that
 *   defect: the homepage story's close sets the source on GitHub beside this
 *   button as a labelled, outlined secondary (ENG-031 W15p, operator
 *   2026-10-14: "Put the two CTA buttons side-by-side"), from outside this
 *   component, which still has no slot.
 * - FLAT DOM. The 3D key switch comes off the site (operator); no premium hero
 *   in the 16-site set makes its primary conversion action a mesh. This is a
 *   real anchor: hit-testable, keyboard-focusable, and legible to a crawler.
 * - WHITE ON THE AUTHORED DARK GROUND. The marketing site runs one fixed
 *   register and does not inherit the app's `--primary`, which moves with the
 *   theme contract. Highest contrast available, and stable across every theme
 *   the app ships.
 * - THE REQUIREMENT SITS AT THE BUTTON, never in a footnote. It is set in the
 *   reading face rather than in mono (operator, 2026-08-17). A tracked
 *   uppercase mono line under a conversion button reads as machine output,
 *   and the sentence it carries is written for a person.
 */
export function DownloadCta({
  requirement = true,
  label = DOWNLOAD_LABEL,
}: {
  /** The machine it needs, under the button. The homepage leaves it to the
   *  download page (operator 2026-10-14: "we can remove the macOS 12 or
   *  later Apple Silicon disclaimer. That can just be on the download
   *  page"). */
  requirement?: boolean;
  /** The homepage may publish its own action label; other uses keep canon. */
  label?: string;
}) {
  return (
    <div className="flex flex-col items-center gap-3">
      <div className="flex items-center">
        <Button
          asChild
          // a keyboard's focus rings it in white, clear of the button: the
          // shared ring is one pixel of the app's theme colour
          className="h-11 rounded-md bg-white px-7 text-base font-semibold text-black shadow-lg hover:bg-white/90 focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black"
        >
          <Link href={DOWNLOAD_HREF}>{label}</Link>
        </Button>
      </div>
      {requirement ? (
        <p className="text-[13px] leading-snug text-white/50">
          {DOWNLOAD_REQUIREMENT}
        </p>
      ) : null}
    </div>
  );
}
