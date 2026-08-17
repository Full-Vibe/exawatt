'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  isMarketingRoute,
  usesDarkPublicChrome,
  usesProposedSiteChrome,
} from './surfaces';
import { SITE_FOOTER_COLUMNS } from '@/components/site/site-links';

/**
 * Marketing footer. Renders only on the public website routes (navigation
 * manifest); app surfaces are fixed, full-viewport, and never scroll to a
 * footer.
 *
 * TWO SHAPES, ONE COMPONENT (ENG-031 W6). Every marketing route keeps the
 * quiet legal row it has always had. The surfaces that carry the proposed site
 * chrome get the full footer, whose reason for existing is the OPEN SOURCE
 * COLUMN: the AGPL app and the Apache-2.0 compatibility spec, stated once, in
 * plain language, where the research says the claim belongs. It also takes
 * `Architecture` and `Leaderboard`, which W6 drops out of the nav because no
 * site in the reference corpus carries a project artifact there.
 *
 * The split is a predicate, not a route list, so promoting the homepage
 * promotes its footer in the same edit.
 */
export function SiteFooter() {
  const pathname = usePathname() ?? '';
  if (!isMarketingRoute(pathname)) return null;

  const dark = usesDarkPublicChrome(pathname);
  const full = usesProposedSiteChrome(pathname);

  if (!full) {
    return (
      <footer
        id="site-footer"
        data-public-dark-chrome={dark ? 'true' : undefined}
        className="border-t py-6 text-center text-xs text-muted-foreground"
      >
        <div className="flex items-center justify-center gap-4">
          <Link
            href="/privacy"
            className="hover:text-foreground transition-colors"
          >
            Privacy Policy
          </Link>
          <Link
            href="/terms"
            className="hover:text-foreground transition-colors"
          >
            Terms of Service
          </Link>
        </div>
      </footer>
    );
  }

  return (
    <footer
      id="site-footer"
      data-public-dark-chrome={dark ? 'true' : undefined}
      data-site-footer="full"
      className="border-t px-6 py-14 text-sm text-muted-foreground sm:px-10"
    >
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-10">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-3">
          {SITE_FOOTER_COLUMNS.map(column => (
            <div
              className="flex flex-col gap-3"
              key={column.heading}
              data-footer-column={column.heading}
            >
              <p className="text-chrome-label font-semibold">
                {column.heading}
              </p>
              <ul className="flex flex-col gap-2">
                {column.links.map(link => (
                  <li key={link.label}>
                    <Link
                      href={link.href}
                      className="hover:text-foreground transition-colors"
                      {...(link.external
                        ? { target: '_blank', rel: 'noreferrer' }
                        : {})}
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
              {column.note ? (
                <p className="max-w-sm text-xs leading-relaxed">
                  {column.note}
                </p>
              ) : null}
            </div>
          ))}
        </div>
        <p className="text-xs">Exawatt</p>
      </div>
    </footer>
  );
}
