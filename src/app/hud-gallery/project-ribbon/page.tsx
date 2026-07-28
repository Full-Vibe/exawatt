'use client';

import Link from 'next/link';
import { HUD } from '@/components/hud';
import { ProjectRibbonStudy } from '@/components/hud/project-ribbon-study';

/** Focused viewport for motion review and automated frame sampling. */
export default function ProjectRibbonLabPage() {
  return (
    <main
      className="min-h-screen p-6"
      style={{ background: HUD.bg.void, color: HUD.text }}
    >
      <div className="mx-auto flex max-w-[1480px] flex-col gap-6">
        <header className="flex items-end justify-between gap-4">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              HUD Gallery / interaction lab
            </p>
            <h1 className="mt-1 font-display text-2xl font-semibold">
              Elastic Project ribbon
            </h1>
          </div>
          <Link
            href="/hud-gallery#elastic-project-ribbon"
            className="font-mono text-xs underline underline-offset-4"
            style={{ color: HUD.cyan }}
          >
            Back to gallery
          </Link>
        </header>
        <ProjectRibbonStudy />
      </div>
    </main>
  );
}
