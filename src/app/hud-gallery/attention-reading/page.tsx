'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { TooltipProvider } from '@/components/ui/tooltip';
import { TabStrip } from '@/components/workspace/tab-strip';
import { SessionOverviewCardContent } from '@/components/workspace/session-overview-card';
import type { SessionTab } from '@/components/workspace/use-workspace-state';
import {
  fleetAttention,
  mergeFleetAttention,
  nextAttentionTarget,
  orderedAttentionTargets,
  type SessionAttentionSignal,
} from '@/components/workspace/session-status';
import { WORKSPACE_HUD as HUD } from '@/components/workspace/workspace-theme';

const samples = [
  {
    id: 'switching',
    purpose: 'Make agent switching instant',
    current: 'Handoff profiling is ready to review.',
  },
  {
    id: 'updates',
    purpose: 'Make updates safe to install',
    current: 'Restart recovery checks passed.',
  },
  {
    id: 'understanding',
    purpose: 'Make Exawatt understandable',
    current: 'Choose which explanation leads the guide.',
  },
];
const initialSignals: Record<string, SessionAttentionSignal> = {
  switching: { kind: 'turn-end', since: 1, unread: true },
  updates: { kind: 'turn-end', since: 2, unread: false },
  understanding: {
    kind: 'blocked',
    request: 'blocking',
    since: 3,
    unread: false,
  },
};
const tabs: SessionTab[] = samples.map(sample => ({
  kind: 'session',
  id: sample.id,
  durableSessionId: sample.id,
  sessionId: sample.id,
  title: sample.purpose,
  titleKind: 'operator',
  harness: 'claude',
  cwd: '/study',
  harnessSessionId: null,
  resumeState: 'live',
  lifecycle: 'running',
  exitCode: null,
  roadmapItemId: null,
  initialTask: null,
}));
const noop = () => undefined;

/** Bounded review proposal. Existing neutral text-dim, spacing grid, and
 * actual production components; the candidate flags are off in production. */
export default function AttentionReadingStudy() {
  const [signals, setSignals] = useState(initialSignals);
  const [active, setActive] = useState<string>('updates');
  const pass = useRef<ReadonlyMap<string, string>>(new Map());
  const attention = mergeFleetAttention(fleetAttention('study', signals));
  const inspect = (id: string) => {
    setActive(id);
    setSignals(current => ({
      ...current,
      [id]: { ...current[id], unread: false },
    }));
  };
  const markUnread = (id: string) =>
    setSignals(current => ({
      ...current,
      [id]: { ...current[id], unread: true },
    }));
  return (
    <TooltipProvider>
      <main className="min-h-screen bg-background p-6 font-ui text-foreground sm:p-8">
        <div className="mx-auto flex max-w-screen-2xl flex-col gap-8">
          <header className="flex flex-col items-start gap-3">
            <Link
              href="/hud-gallery"
              className="text-chrome-label text-muted-foreground underline"
            >
              HUD gallery
            </Link>
            <h1 className="text-surface-title font-semibold">
              Read at a glance
            </h1>
            <p className="max-w-2xl text-sm text-muted-foreground">
              An unread dot uses neutral chrome beside the existing status.
              Opening a Session removes the dot; a request keeps its needs-you
              signal. Purpose, completion and position stay unchanged.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <Button
                variant="outline"
                onClick={() => {
                  const next = nextAttentionTarget(
                    orderedAttentionTargets(attention, null),
                    active,
                    pass.current,
                    attention
                  );
                  pass.current = next.visited;
                  if (next.target) inspect(next.target);
                }}
              >
                Next attention
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setSignals(initialSignals);
                  setActive('updates');
                  pass.current = new Map();
                }}
              >
                Reset study
              </Button>
              <span
                className="text-chrome-meta text-muted-foreground"
                aria-live="polite"
              >
                Opened: {samples.find(sample => sample.id === active)?.purpose}
              </span>
            </div>
          </header>
          <section className="flex flex-col gap-3" aria-label="Agent ribbon">
            <h2 className="text-chrome-title font-medium">Agent</h2>
            <div
              className="rounded border p-3"
              style={{ borderColor: HUD.strokeFaint, background: HUD.bg.deep }}
            >
              <TabStrip
                projects={[
                  {
                    dir: '/study',
                    name: 'Polish',
                    color: HUD.cyan,
                    activeTabId: active,
                    tabs,
                  },
                ]}
                activeDir="/study"
                pinnedTabId={null}
                summaries={{}}
                attention={attention}
                engaged={Object.fromEntries(
                  samples.map(sample => [sample.id, true])
                )}
                onSelectProject={noop}
                onSelectTab={(_, id) => inspect(id)}
                onCloseTab={noop}
                onRenameTab={noop}
                onRenameProject={noop}
                onSetProjectColor={noop}
                onMarkUnread={markUnread}
                showUnreadMarker
              />
            </div>
          </section>
          <section className="flex flex-col gap-3" aria-label="Team cards">
            <h2 className="text-chrome-title font-medium">Team</h2>
            <div className="grid gap-4 lg:grid-cols-3">
              {samples.map(sample => {
                const signal = signals[sample.id];
                return (
                  <button
                    key={sample.id}
                    data-attention-reading-sample={sample.id}
                    onClick={() => inspect(sample.id)}
                    aria-label={`Open ${sample.purpose}`}
                    className="flex min-w-0 flex-col gap-3 rounded-lg border p-4 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                    style={{
                      borderColor: HUD.strokeFaint,
                      background: HUD.bg.panel,
                    }}
                  >
                    <SessionOverviewCardContent
                      title={sample.purpose}
                      color={HUD.cyan}
                      harness="claude"
                      glyphState={
                        signal.kind === 'blocked' ? 'blocked' : 'done'
                      }
                      attention={signal}
                      current={sample.current}
                      next={null}
                      showUnreadMarker
                    />
                  </button>
                );
              })}
            </div>
          </section>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              disabled={signals[active].unread !== false}
              onClick={() => markUnread(active)}
            >
              Mark opened Session unread
            </Button>
            <p className="text-chrome-label text-muted-foreground">
              The first result starts unread; the second is read. The read
              request still needs you.
            </p>
          </div>
          <p className="max-w-2xl text-chrome-label text-muted-foreground">
            Review candidate only. The same marker is embedded in the real
            ribbon and Team content. Its fixed slot prevents title movement when
            reading changes; status glyphs and their colors are untouched.
          </p>
        </div>
      </main>
    </TooltipProvider>
  );
}
