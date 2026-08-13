import Link from 'next/link';
import { PausedAgentRecordStudy } from '@/components/hud/paused-agent-record-study';
import { WORKSPACE_HUD as HUD } from '@/components/workspace/workspace-theme';

export default function PausedAgentBenchPage() {
  return (
    <main
      className="min-h-screen bg-background px-4 py-6 font-ui text-foreground sm:px-6 sm:py-8 lg:px-8"
      style={{
        background: `radial-gradient(110% 80% at 70% -10%, ${HUD.bg.hazeIndigo}, transparent 58%), ${HUD.bg.void}`,
        color: HUD.text,
      }}
    >
      <div className="mx-auto flex max-w-[1100px] flex-col gap-8">
        <header className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-end sm:gap-6">
          <div>
            <p
              className="font-mono text-chrome-micro uppercase tracking-[0.16em]"
              style={{ color: HUD.textDim }}
            >
              HUD Gallery / Agent
            </p>
            <h1 className="mt-1 text-surface-title font-semibold">
              Paused Agent record
            </h1>
            <p className="mt-2 max-w-2xl text-sm" style={{ color: HUD.textDim }}>
              A paused Agent is a record, not a replayed terminal: what it was
              doing, how it ended, and how to get back to it. The transcript is
              one click away, rendered to lines in main and bounded before it
              crosses IPC.
            </p>
          </div>
          <Link
            href="/hud-gallery"
            className="inline-flex min-h-11 items-center font-mono text-chrome-label underline underline-offset-4"
            style={{ color: HUD.cyan }}
          >
            HUD gallery
          </Link>
        </header>
        <PausedAgentRecordStudy />
      </div>
    </main>
  );
}
