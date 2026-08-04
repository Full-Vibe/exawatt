'use client';

import Link from 'next/link';
import { HUD } from '@/components/hud';
import { LauncherBench } from '@/components/workspace/launcher/launcher-bench';

/** ENG-016 D49 design bench for the New Agent launcher. */
export default function AgentLauncherBenchPage() {
  return (
    <main
      className="min-h-screen p-6"
      style={{ background: HUD.bg.void, color: HUD.text }}
    >
      <div className="mx-auto flex max-w-[1540px] flex-col gap-6">
        <header className="flex items-end justify-between gap-4">
          <div>
            <p className="font-mono text-chrome-micro tracking-[0.16em] text-hud-text-dim">
              HUD Gallery / interaction lab
            </p>
            <h1 className="mt-1 font-display text-2xl font-semibold">
              New Agent launcher
            </h1>
            <p className="mt-1 max-w-prose font-mono text-chrome-meta leading-4 text-hud-text-dim">
              ENG-016 D49. Every state comes from the real components and the
              real recommendation module, driven by a simulated launch history.
            </p>
          </div>
          <Link
            href="/hud-gallery"
            className="font-mono text-xs underline underline-offset-4"
            style={{ color: HUD.cyan }}
          >
            Gallery
          </Link>
        </header>
        <LauncherBench />
      </div>
    </main>
  );
}
