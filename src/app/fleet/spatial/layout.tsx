import type { Metadata } from 'next';

// segment title only (ENG-016 D9) — the root layout's template appends the
// app name; the page itself stays a client component
//
// noindex for the same reason as `/settings` and `/workspace`: app chrome that
// sits outside the auth gate so the offline Electron renderer can reach it, not
// a page anyone should find in a search result.
export const metadata: Metadata = {
  title: 'Fleet',
  robots: { index: false, follow: false },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
