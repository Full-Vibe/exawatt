import type { Metadata } from 'next';

/**
 * Hackathon toy (temporary): `page.tsx` is a client component and cannot
 * export metadata, so the title and noindex directive live here. Noindexed
 * because it is throwaway, not because it needs auth — see `/proxy.ts`,
 * which keeps it public on purpose.
 */
export const metadata: Metadata = {
  title: 'World',
  robots: { index: false, follow: false },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
