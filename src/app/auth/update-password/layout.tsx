import type { Metadata } from 'next';

// segment title only (ENG-016 D9) — the root layout's template appends the
// app name; the page itself stays a client component
export const metadata: Metadata = { title: 'New password' };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
