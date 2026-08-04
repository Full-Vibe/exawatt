import Link from 'next/link';
import { GoalVisualLayoutStudy } from '@/components/hud/goal-visual-layout-study';
import { WORKSPACE_HUD as HUD } from '@/components/workspace/workspace-theme';

export default function GoalVisualBenchPage() {
  return (
    <main
      className="min-h-screen bg-background px-8 py-8 font-ui text-foreground"
      style={{
        background: `radial-gradient(110% 80% at 70% -10%, ${HUD.bg.hazeIndigo}, transparent 58%), ${HUD.bg.void}`,
        color: HUD.text,
      }}
    >
      <div className="mx-auto flex max-w-[1540px] flex-col gap-8">
        <header className="flex items-end justify-between gap-6">
          <div>
            <p
              className="font-mono text-chrome-micro uppercase tracking-[0.16em]"
              style={{ color: HUD.textDim }}
            >
              HUD Gallery / Team
            </p>
            <h1 className="mt-1 text-surface-title font-semibold">
              Agent tile image geometry
            </h1>
          </div>
          <Link
            href="/hud-gallery"
            className="font-mono text-chrome-label underline underline-offset-4"
            style={{ color: HUD.cyan }}
          >
            HUD gallery
          </Link>
        </header>
        <GoalVisualLayoutStudy />
      </div>
    </main>
  );
}
