import type { Metadata } from 'next';

/**
 * The investor deck carries market sizing, business model, and the raise.
 *
 * It is ALREADY protected: `/deck` is absent from `PUBLIC_PREFIXES` in
 * `src/proxy.ts`, so an unauthenticated request is redirected to `/sign-in`
 * and never reaches this route. The `noindex` here is defence in depth for the
 * day someone makes `/deck` public without thinking about crawlers — cheap,
 * and wrong only if we ever want it indexed.
 *
 * `page.tsx` is a client component and cannot export metadata, so the
 * directive and the segment title live here.
 */
export const metadata: Metadata = {
  title: 'Deck',
  robots: { index: false, follow: false },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
