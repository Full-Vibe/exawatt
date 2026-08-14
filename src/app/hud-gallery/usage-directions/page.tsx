import { Suspense } from 'react';
import Link from 'next/link';
import { CONSUMPTION_CHROME as CHROME } from '@/components/consumption/flux';
import { UsageDirectionsStudy } from './study';

/**
 * ENG-008 E12 — the usage-multiplexer design pass.
 *
 * A deterministic review rig (the roadmap-lab precedent): three directions
 * over ONE captured real snapshot of the operator's own machine, each
 * rendering six states, deep-linked as `?d=<direction>&s=<state>`.
 */
export default function UsageDirectionsPage() {
  return (
    <main
      className="min-h-screen bg-background px-4 py-6 font-ui text-foreground sm:px-6 sm:py-8 lg:px-8"
      style={{ background: CHROME.canvas, color: CHROME.text }}
    >
      <div className="mx-auto flex max-w-[1540px] flex-col gap-6">
        <header className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-end sm:gap-6">
          <div>
            <p
              className="font-mono text-chrome-micro uppercase tracking-[0.16em]"
              style={{ color: CHROME.textDim }}
            >
              HUD Gallery / Usage
            </p>
            <h1 className="mt-1 text-surface-title font-semibold">
              Usage as the vendor multiplexer
            </h1>
          </div>
          <Link
            href="/hud-gallery"
            className="inline-flex min-h-11 items-center font-mono text-chrome-label underline underline-offset-4"
            style={{ color: 'var(--exa-hud-cyan)' }}
          >
            HUD gallery
          </Link>
        </header>
        <Suspense fallback={null}>
          <UsageDirectionsStudy />
        </Suspense>
      </div>
    </main>
  );
}
