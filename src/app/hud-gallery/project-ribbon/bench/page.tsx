'use client';

import Link from 'next/link';
import { HUD } from '@/components/hud';
import { RibbonDogfoodBench } from '@/components/hud/ribbon-dogfood-bench';

/** Reproduction rig for the 2026-08-02 ribbon dogfood round. */
export default function ProjectRibbonBenchPage() {
  return (
    <main
      className="min-h-screen p-6"
      style={{ background: HUD.bg.void, color: HUD.text }}
    >
      <div className="mx-auto flex max-w-[1540px] flex-col gap-6">
        <header className="flex items-end justify-between gap-4">
          <div>
            <p className="font-mono text-[10px] tracking-[0.16em] text-muted-foreground">
              HUD Gallery / interaction lab
            </p>
            <h1 className="mt-1 font-display text-2xl font-semibold">
              Ribbon dogfood bench
            </h1>
          </div>
          <Link
            href="/hud-gallery/project-ribbon"
            className="font-mono text-xs underline underline-offset-4"
            style={{ color: HUD.cyan }}
          >
            Motion lab
          </Link>
        </header>
        <RibbonDogfoodBench />
      </div>
    </main>
  );
}
