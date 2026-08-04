'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { isMarketingRoute, usesDarkPublicChrome } from './surfaces';

/**
 * Marketing footer. Renders only on the public website routes (navigation
 * manifest); app surfaces are fixed, full-viewport, and never scroll to a
 * footer.
 */
export function SiteFooter() {
  const pathname = usePathname() ?? '';
  if (!isMarketingRoute(pathname)) return null;

  return (
    <footer
      id="site-footer"
      data-public-dark-chrome={
        usesDarkPublicChrome(pathname) ? 'true' : undefined
      }
      className="border-t py-6 text-center text-xs text-muted-foreground"
    >
      <div className="flex items-center justify-center gap-4">
        <Link href="/privacy" className="hover:text-foreground transition-colors">
          Privacy Policy
        </Link>
        <Link href="/terms" className="hover:text-foreground transition-colors">
          Terms of Service
        </Link>
      </div>
    </footer>
  );
}
