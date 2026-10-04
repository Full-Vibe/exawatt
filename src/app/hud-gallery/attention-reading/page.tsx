'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { withAttentionRead } from '@exawatt/core';
import { Button } from '@/components/ui/button';
import { TooltipProvider } from '@/components/ui/tooltip';
import { TabStrip } from '@/components/workspace/tab-strip';
import { SessionOverviewCardContent } from '@/components/workspace/session-overview-card';
import type { SessionTab } from '@/components/workspace/use-workspace-state';
import type { SessionUnreadTreatment } from '@/components/workspace/session-unread-marker';
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
  {
    id: 'reliability',
    purpose: 'Make every answer dependable',
    current: 'Checks continue; choose the fallback behavior.',
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
  reliability: { kind: 'blocked', request: 'working', since: 4, unread: true },
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
const options: {
  treatment: SessionUnreadTreatment;
  label: string;
  description: string;
}[] = [
  {
    treatment: 'corner-dot',
    label: 'A · Corner dot',
    description:
      'A small neutral dot touches the top-right edge of the existing state icon.',
  },
  {
    treatment: 'outer-mark',
    label: 'B · Outer mark',
    description:
      'A thin neutral arc follows the upper edge of the same state icon.',
  },
];
const noop = () => undefined;

/** Existing D40 glyphs remain intact. Both review-only decorations stay inside
 * the established 16px slot and use neutral text-dim. No added layout width. */
export default function AttentionReadingStudy() {
  const [signals, setSignals] = useState(initialSignals);
  const [active, setActive] = useState<string>('updates');
  const pass = useRef<ReadonlyMap<string, string>>(new Map());
  const attention = mergeFleetAttention(fleetAttention('study', signals));
  const setRead = (id: string, unread: boolean) =>
    setSignals(current => ({
      ...current,
      [id]: withAttentionRead(
        { ...current[id], kind: current[id].kind ?? 'bell' },
        unread
      ),
    }));
  const inspect = (id: string) => {
    setActive(id);
    setRead(id, false);
  };
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
              Unread, in the familiar place
            </h1>
            <p className="max-w-2xl text-sm text-muted-foreground">
              Two details attached to the existing state icon. Opening removes
              the unread detail; outstanding requests keep their status. The
              original glyph, color and purpose position stay unchanged.
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
              <Button
                variant="ghost"
                disabled={signals[active].unread !== false}
                onClick={() => setRead(active, true)}
              >
                Mark opened Session unread
              </Button>
              <span
                className="text-chrome-meta text-muted-foreground"
                aria-live="polite"
              >
                Opened: {samples.find(sample => sample.id === active)?.purpose}
              </span>
            </div>
          </header>
          {options.map(option => (
            <section
              key={option.treatment}
              data-attention-treatment={option.treatment}
              className="flex flex-col gap-4"
            >
              <div className="flex flex-wrap items-baseline gap-3">
                <h2 className="text-base font-semibold">{option.label}</h2>
                <p className="text-chrome-label text-muted-foreground">
                  {option.description}
                </p>
              </div>
              <div
                className="rounded border p-3"
                style={{
                  borderColor: HUD.strokeFaint,
                  background: HUD.bg.deep,
                }}
                aria-label={`${option.label} Agent ribbon`}
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
                  activity={{ reliability: true }}
                  engaged={Object.fromEntries(
                    samples.map(sample => [sample.id, true])
                  )}
                  onSelectProject={noop}
                  onSelectTab={(_, id) => inspect(id)}
                  onCloseTab={noop}
                  onRenameTab={noop}
                  onRenameProject={noop}
                  onSetProjectColor={noop}
                  onMarkUnread={id => setRead(id, true)}
                  unreadTreatment={option.treatment}
                />
              </div>
              <div
                className="grid gap-4 md:grid-cols-2 xl:grid-cols-4"
                aria-label={`${option.label} Team cards`}
              >
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
                          signal.request === 'working'
                            ? 'working'
                            : signal.kind === 'blocked'
                              ? 'blocked'
                              : 'done'
                        }
                        attention={signal}
                        current={sample.current}
                        next={null}
                        unreadTreatment={option.treatment}
                      />
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
          <p className="max-w-2xl text-chrome-label text-muted-foreground">
            Both rows show the same four cases: unread result, read result, read
            unresolved request, and a working Agent with an unread question.
            Hover an icon for the combined explanation. Both candidates are
            static and review-only.
          </p>
          <p className="max-w-2xl text-chrome-label text-muted-foreground">
            Fleet visual proof is pending. An accepted treatment would attach to
            the existing per-Agent board status mark, preserving its anchor,
            size and status color; the board body and Project color would stay
            unchanged. This comparison proves Agent and Team only.
          </p>
        </div>
      </main>
    </TooltipProvider>
  );
}
