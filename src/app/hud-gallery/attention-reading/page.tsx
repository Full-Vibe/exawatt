'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { TooltipProvider } from '@/components/ui/tooltip';
import { TabStrip } from '@/components/workspace/tab-strip';
import { SessionOverviewCardContent } from '@/components/workspace/session-overview-card';
import type { SessionTab } from '@/components/workspace/use-workspace-state';
import {
  attentionReadLabel,
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
    purpose: 'Make switching agents feel instant',
    current: 'Handoff profiling is ready to review.',
  },
  {
    id: 'updates',
    purpose: 'Make updates safe to install',
    current: 'Restart recovery checks passed.',
  },
  {
    id: 'understanding',
    purpose: 'Help people understand Exawatt',
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
const noop = () => undefined;

/** Bounded review proposal. Uses chrome-meta, semantic muted text, p-3/p-4,
 * gap-2/gap-4; no new token, glyph, or production visual treatment. */
export default function AttentionReadingStudy() {
  const [signals, setSignals] = useState(initialSignals);
  const [active, setActive] = useState<string | null>(null);
  const pass = useRef<ReadonlyMap<string, string>>(new Map());
  const attention = mergeFleetAttention(fleetAttention('study', signals));
  const inspect = (id: string) => {
    setActive(id);
    setSignals(current => ({
      ...current,
      [id]: { ...current[id], unread: false },
    }));
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
              Reading without losing the purpose
            </h1>
            <p className="max-w-2xl text-sm text-muted-foreground">
              A neutral read label sits beside the existing state. Reading a
              result removes it from the next-attention pass; reading a request
              leaves the request open. The purpose and completion glyph keep
              their prominence.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <Button
                variant="outline"
                onClick={() => {
                  const next = nextAttentionTarget(
                    orderedAttentionTargets(attention, null),
                    active,
                    pass.current
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
                  setActive(null);
                  pass.current = new Map();
                }}
              >
                Reset study
              </Button>
              <span
                className="text-chrome-meta text-muted-foreground"
                aria-live="polite"
              >
                {active
                  ? `Opened: ${samples.find(sample => sample.id === active)?.purpose}`
                  : 'Choose a Session or try the attention pass.'}
              </span>
            </div>
          </header>
          <div className="grid gap-6 xl:grid-cols-3">
            {samples.map(sample => {
              const signal = signals[sample.id];
              const tab: SessionTab = {
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
              };
              const readLabel = attentionReadLabel(signal);
              return (
                <section
                  key={sample.id}
                  data-attention-reading-sample={sample.id}
                  className="flex min-w-0 flex-col gap-4"
                >
                  <h2 className="text-chrome-title font-medium">
                    {sample.purpose}
                  </h2>
                  <div className="flex flex-col gap-2">
                    <span className="text-chrome-meta text-muted-foreground">
                      Agent tab
                    </span>
                    <div
                      className="rounded border p-3"
                      style={{
                        borderColor: HUD.strokeFaint,
                        background: HUD.bg.deep,
                      }}
                    >
                      <TabStrip
                        projects={[
                          {
                            dir: '/study',
                            name: 'Polish',
                            color: HUD.cyan,
                            activeTabId: sample.id,
                            tabs: [tab],
                          },
                        ]}
                        activeDir="/study"
                        pinnedTabId={null}
                        summaries={{}}
                        attention={attention}
                        engaged={{ [sample.id]: true }}
                        onSelectProject={noop}
                        onSelectTab={() => inspect(sample.id)}
                        onCloseTab={noop}
                        onRenameTab={noop}
                        onRenameProject={noop}
                        onSetProjectColor={noop}
                        onMarkUnread={() =>
                          setSignals(current => ({
                            ...current,
                            [sample.id]: { ...signal, unread: true },
                          }))
                        }
                      />
                      <p
                        className="mt-2 text-chrome-meta text-muted-foreground"
                        data-study-read-label
                      >
                        {readLabel}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-col gap-2">
                    <span className="text-chrome-meta text-muted-foreground">
                      Team card
                    </span>
                    <div
                      className="flex flex-col gap-3 rounded-lg border p-4"
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
                      />
                      <span
                        className="text-chrome-meta text-muted-foreground"
                        data-study-read-label
                      >
                        {readLabel}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => inspect(sample.id)}
                    >
                      Open Session
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={signal.unread !== false}
                      onClick={() =>
                        setSignals(current => ({
                          ...current,
                          [sample.id]: { ...signal, unread: true },
                        }))
                      }
                    >
                      Mark unread
                    </Button>
                  </div>
                </section>
              );
            })}
          </div>
          <p className="max-w-2xl text-chrome-label text-muted-foreground">
            Review proposal: labels are neutral chrome metadata, separate from
            the status channel. The unread/read treatment is exploratory. No
            automatic fading, moving, hiding, or closing is part of this study.
          </p>
        </div>
      </main>
    </TooltipProvider>
  );
}
