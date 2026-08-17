import type { Metadata } from 'next';

/**
 * `/eval` is the render-performance harness set: eleven R3F and DOM tasks that
 * exist so Playwright can measure draw calls, frame cost, and keyswitch
 * latency. They are instrumentation, not product, and several expose internal
 * renderer handles on `window`.
 *
 * Layout metadata covers every nested task, so a new harness inherits this
 * instead of having to remember it. Same posture as `/hud-gallery`: the gate is
 * discovery, not access. The routes stay reachable by URL because the eval
 * harness drives them directly, including against a preview deployment.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
