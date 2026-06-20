'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * Marketing footer. Hidden on app/dashboard routes, which render as fixed,
 * full-viewport surfaces (no page scroll, so no footer at the bottom).
 */
const APP_PREFIXES = [
  '/fleet',
  '/dashboard',
  '/board',
  '/projects',
  '/settings',
  '/deck',
  '/thrml',
  '/hud-gallery',
];

export function SiteFooter() {
  const pathname = usePathname() ?? '';
  const isAppRoute = APP_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`)
  );
  if (isAppRoute) return null;

  return (
    <footer
      id="site-footer"
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
