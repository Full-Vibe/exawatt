import Link from 'next/link';
import { Button } from '@/components/ui/button';
import {
  DOWNLOAD_HREF,
  DOWNLOAD_LABEL,
} from '@/components/site/bands/download';

/**
 * Persistent conversion, in the sticky header (ENG-031 W6).
 *
 * The measured cohort spends between three and six CTAs on a whole page and
 * keeps the always-available one in the header rather than repeating it
 * inline. This is that one, and it is the ONLY button in the proposed nav.
 *
 * IT LIVES UNDER `components/site/`, not `components/nav/`, and the reason is
 * a contract rather than taste. The marketing site runs ONE FIXED REGISTER and
 * deliberately does not inherit the app's `--primary`, which moves with the
 * theme; white on the authored dark ground is the highest contrast available
 * and is stable across every theme the app ships. `components/nav/` is
 * theme-owned chrome and `theme-surface-contract.test.ts` correctly refuses a
 * palette utility there, so the fixed-register control belongs on the site
 * side of that line, beside the `DownloadCta` it matches.
 */
export function SiteNavDownload() {
  return (
    <Button
      asChild
      size="sm"
      className="ml-1 h-8 rounded-md bg-white px-3.5 font-semibold text-black shadow-sm hover:bg-white/90"
      data-site-nav-download
    >
      <Link href={DOWNLOAD_HREF}>{DOWNLOAD_LABEL}</Link>
    </Button>
  );
}
