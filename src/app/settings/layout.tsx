import type { Metadata } from 'next';

// segment title only (ENG-016 D9) — the root layout's template appends the
// app name; the page itself stays a client component
//
// noindex: `/settings` is app chrome, not a public page. It is outside the auth
// gate on purpose (the Electron renderer has to reach it with the network down,
// ENG-016 D18), which also makes it crawlable, so indexability is refused here
// rather than by routing. Same posture as `/hud-gallery` and `/usage`: the gate
// is discovery, not access.
export const metadata: Metadata = {
  title: 'Settings',
  robots: { index: false, follow: false },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
