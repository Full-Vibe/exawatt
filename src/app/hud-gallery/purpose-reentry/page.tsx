import Link from 'next/link';
import { SessionOverviewCardContent } from '@/components/workspace/session-overview-card';
import { sessionDisplayCopy } from '@/components/workspace/session-display-copy';
import { WORKSPACE_HUD as HUD } from '@/components/workspace/workspace-theme';

const sessions = [
  {
    purpose: 'Make updates safe to install',
    state: 'Needs you',
    working: false,
  },
  {
    purpose: 'Help people understand Exawatt',
    state: 'Working',
    working: true,
  },
  {
    purpose: 'Make switching agents feel instant',
    state: 'Paused',
    working: false,
  },
];

/** Review-only comparison: shared identity, unchanged state and navigation. */
export default function PurposeReentryStudy() {
  return (
    <main className="min-h-screen bg-background px-6 py-8 font-ui text-foreground">
      <div className="mx-auto flex max-w-5xl flex-col gap-8">
        <header className="flex flex-col gap-2">
          <Link
            href="/hud-gallery"
            className="text-chrome-label text-muted-foreground underline underline-offset-4"
          >
            HUD gallery
          </Link>
          <h1 className="text-surface-title font-semibold">
            Purpose on return
          </h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Remember why this Session exists before reading what it needs.
            Source, status and Project remain visible. Positions stay fixed.
          </p>
        </header>
        <section
          className="flex flex-col gap-4"
          aria-labelledby="switcher-heading"
        >
          <h2 id="switcher-heading" className="text-lg font-semibold">
            Find the right Session
          </h2>
          <div className="grid gap-6 md:grid-cols-2">
            {[false, true].map(candidate => (
              <div
                key={String(candidate)}
                className="flex min-w-0 flex-col gap-3"
              >
                <h3 className="text-chrome-title font-medium">
                  {candidate ? 'Purpose first' : 'Current switcher'}
                </h3>
                <div className="overflow-hidden rounded-lg border border-border bg-card">
                  {sessions.map(session => {
                    const identity = sessionDisplayCopy({
                      harness: 'codex',
                      title: 'Codex',
                      titleKind: 'default',
                      lifecycle: 'running',
                      summary: session.purpose,
                    });
                    return (
                      <div
                        key={session.purpose}
                        className="flex min-w-0 items-center gap-3 border-b border-border px-3 py-3 last:border-b-0"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">
                            {candidate ? identity.primary : 'Codex'}
                          </p>
                          <p className="truncate text-chrome-label text-muted-foreground">
                            Exawatt
                            {candidate ? ' · Codex' : ` · ${session.purpose}`}
                          </p>
                        </div>
                        <span className="shrink-0 text-chrome-label text-muted-foreground">
                          {session.state}
                        </span>
                      </div>
                    );
                  })}
                </div>
                <p className="text-chrome-label text-muted-foreground">
                  {candidate
                    ? 'The same purpose you recognize in the Agent tab and Team view.'
                    : 'The purpose trails the source and Project, where it is easier to truncate.'}
                </p>
              </div>
            ))}
          </div>
        </section>
        <section
          className="flex flex-col gap-4"
          aria-labelledby="paused-heading"
        >
          <h2 id="paused-heading" className="text-lg font-semibold">
            Keep paused work readable
          </h2>
          <div className="grid gap-6 md:grid-cols-2">
            {[false, true].map(candidate => (
              <div key={String(candidate)} className="flex flex-col gap-3">
                <h3 className="text-chrome-title font-medium">
                  {candidate
                    ? 'Purpose stays readable'
                    : 'Current stopped card'}
                </h3>
                <div
                  className="rounded-lg p-4"
                  style={{ background: HUD.bg.void }}
                >
                  <div
                    className="flex h-64 max-w-sm flex-col rounded border p-3"
                    style={{
                      borderColor: HUD.strokeSoft,
                      background: HUD.bg.panelFill,
                      opacity: candidate ? 1 : 0.55,
                    }}
                  >
                    <SessionOverviewCardContent
                      title={sessions[2].purpose}
                      titleIsContext
                      color={HUD.cyan}
                      harness="codex"
                      glyphState="done"
                      lifecycleLabel="Paused"
                      current="Paused · history kept"
                      next={null}
                    />
                  </div>
                </div>
                <p className="text-chrome-label text-muted-foreground">
                  {candidate
                    ? 'The existing Paused word communicates lifecycle without dimming the reason to return.'
                    : 'The entire tile is dimmed, including its purpose.'}
                </p>
              </div>
            ))}
          </div>
        </section>
        <p className="max-w-2xl text-chrome-label text-muted-foreground">
          Review candidate. No production behavior changes. Operator renames
          keep their authority; request/read state never replaces purpose.
        </p>
      </div>
    </main>
  );
}
