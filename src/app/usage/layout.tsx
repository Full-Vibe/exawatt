import type { Metadata } from 'next';
import { CONSUMPTION_SURFACE_NAME } from '@exawatt/core';

// segment title only (ENG-016 D9) — the root layout's template appends the
// app name; the page itself stays a client component. The display name is
// the shared surface-name constant so a rename is one change.
//
// noindex while the product is pre-launch: this surface explains the whole
// product thesis, and the operator's position is deliberate stealth for the
// next few iterations. It stays reachable by URL so it can be demoed and
// shared directly — the gate is discovery, not access, exactly as on
// `/download`. Remove this when the product goes public.
export const metadata: Metadata = {
  title: CONSUMPTION_SURFACE_NAME,
  robots: { index: false, follow: false },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
