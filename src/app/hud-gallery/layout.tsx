import type { Metadata } from 'next';

/**
 * The HUD gallery is an internal design workbench: unreleased directions,
 * in-progress surfaces, and prototypes that are deliberately not the product.
 * None of it should be discoverable while Exawatt is pre-launch.
 *
 * Layout metadata covers every nested lab, so a new workbench route inherits
 * this instead of having to remember it.
 *
 * This is OBSCURITY, not access control — the routes stay reachable by URL so
 * they can be opened in a demo or shared directly. The operator has accepted
 * that tradeoff for now (2026-08-02). The intended end state is a real
 * admin-only auth gate on `/hud-gallery` using `src/lib/auth/admin.ts`, at
 * which point this metadata stays and the gate is added in front of it.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
