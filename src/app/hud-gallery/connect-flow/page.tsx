import Link from 'next/link';
import { WORKSPACE_HUD as HUD } from '@/components/workspace/workspace-theme';
import { ConnectFlowStudy } from './study';

export default function ConnectFlowBenchPage() {
  return (
    <main
      className="min-h-screen bg-background px-4 py-6 font-ui text-foreground sm:px-6 sm:py-8 lg:px-8"
      style={{
        background: `radial-gradient(110% 80% at 70% -10%, ${HUD.bg.hazeTeal}, transparent 58%), ${HUD.bg.void}`,
        color: HUD.text,
      }}
    >
      <div className="mx-auto flex max-w-[1280px] flex-col gap-8">
        <header className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-end sm:gap-6">
          <div>
            <p
              className="font-mono text-chrome-micro tracking-[0.16em]"
              style={{ color: HUD.textDim }}
            >
              HUD Gallery / Agent
            </p>
            <h1 className="mt-1 text-surface-title font-semibold">
              Connect in one step
            </h1>
            <p
              className="mt-2 max-w-2xl text-sm"
              style={{ color: HUD.textDim }}
            >
              ENG-033 H2.4. Connect from ⌘T into the current Project or from ⌘N
              into Remote, test servers in place, and confirm on one screen.
            </p>
          </div>
          <Link
            className="inline-flex min-h-11 items-center font-mono text-chrome-label underline underline-offset-4"
            href="/hud-gallery"
            style={{ color: HUD.cyan }}
          >
            HUD gallery
          </Link>
        </header>
        <ConnectFlowStudy />
      </div>
    </main>
  );
}
