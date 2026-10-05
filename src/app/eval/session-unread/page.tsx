'use client';

import { useMemo, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import {
  attentionIsUnread,
  withAttentionRead,
  type SessionAttentionSignal,
} from '@exawatt/core';
import type { SpatialBoardPiece } from '@exawatt/ui-model';
import type { WebGLRenderer } from 'three';
import { Button } from '@/components/ui/button';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useAppearance } from '@/components/appearance/appearance-provider';
import { TabStrip } from '@/components/workspace/tab-strip';
import { SessionOverviewCardContent } from '@/components/workspace/session-overview-card';
import type { SessionTab } from '@/components/workspace/use-workspace-state';
import {
  fleetAttention,
  mergeFleetAttention,
} from '@/components/workspace/session-status';
import { StatusMarkLayer } from '@/components/fleet/spatial/operations-board/operations-board-status-marks';
import { PARKED_AMBIENT } from '@/components/fleet/spatial/operations-board/operations-board-ambient';
import { spatialThemeFromResolvedAppearance } from '@/components/fleet/spatial/spatial-theme';
import { WORKSPACE_HUD as HUD } from '@/components/workspace/workspace-theme';

const samples = [
  {
    id: 'unread-result',
    purpose: 'Make agent switching instant',
    current: 'Handoff profiling is ready to review.',
    status: 'complete' as const,
  },
  {
    id: 'read-result',
    purpose: 'Make updates safe to install',
    current: 'Restart recovery checks passed.',
    status: 'complete' as const,
  },
  {
    id: 'request',
    purpose: 'Make Exawatt understandable',
    current: 'Choose which explanation leads the guide.',
    status: 'blocked' as const,
  },
  {
    id: 'working-question',
    purpose: 'Make every answer dependable',
    current: 'Checks continue; choose the fallback behavior.',
    status: 'blocked' as const,
  },
  {
    id: 'reminder',
    purpose: 'Keep the next milestone moving',
    current: 'Work continues; marked unread to revisit.',
    status: 'working' as const,
  },
];
const original: Record<string, SessionAttentionSignal> = {
  'unread-result': { kind: 'turn-end', since: 1, unread: true },
  'read-result': { kind: 'turn-end', since: 2, unread: false },
  request: { kind: 'blocked', request: 'blocking', since: 3, unread: false },
  'working-question': {
    kind: 'blocked',
    request: 'working',
    since: 4,
    unread: true,
  },
  reminder: {
    kind: 'reminder',
    since: 5,
    unread: true,
    records: [{ kind: 'reminder', since: 5, unread: true, source: 'operator' }],
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
  cwd: '/eval',
  harnessSessionId: null,
  resumeState: 'live',
  lifecycle: 'running',
  exitCode: null,
  roadmapItemId: null,
  initialTask: null,
}));
const noop = () => undefined;

declare global {
  interface Window {
    __UNREAD_EVAL_GL__?: WebGLRenderer;
  }
}

/** Permanent behavioral/render rig for the accepted same-slot read detail.
 * Both renderers use their production owner; no lookalike glyphs live here. */
export default function SessionUnreadEval() {
  const [signals, setSignals] = useState(original);
  const [active, setActive] = useState('read-result');
  const { resolved, previewTheme } = useAppearance();
  const theme = useMemo(
    () => spatialThemeFromResolvedAppearance(resolved),
    [resolved]
  );
  const attention = mergeFleetAttention(fleetAttention('eval', signals));
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
  const pieces: SpatialBoardPiece[] = useMemo(
    () =>
      samples.map((sample, index) => ({
        id: `agent:${sample.id}`,
        agentId: sample.id,
        projectId: 'polish',
        slotIndex: index,
        kind: 'agent',
        label: sample.purpose,
        summary: '',
        status: sample.status,
        count: 1,
        x: (index - 2) * 100,
        y: 0,
        size: 48,
        visible: true,
        selected: false,
        needsAttention: sample.status === 'blocked',
        unread: attentionIsUnread(signals[sample.id]),
        labelVisibility: 'always',
        burnIntensity: null,
      })),
    [signals]
  );
  return (
    <TooltipProvider>
      <main className="min-h-screen bg-background p-6 font-ui text-foreground">
        <div className="mx-auto flex max-w-screen-2xl flex-col gap-6">
          <h1 className="text-surface-title font-semibold">
            Session inspection
          </h1>
          <div className="flex flex-wrap gap-3">
            <Button
              variant="outline"
              onClick={() =>
                setSignals(current =>
                  Object.fromEntries(
                    Object.entries(current).map(([id, signal]) => [
                      id,
                      withAttentionRead(
                        { ...signal, kind: signal.kind ?? 'bell' },
                        false
                      ),
                    ])
                  )
                )
              }
            >
              Read all
            </Button>
            <Button variant="outline" onClick={() => setRead(active, true)}>
              Mark selected unread
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setSignals(original);
                setActive('read-result');
              }}
            >
              Reset
            </Button>
          </div>
          <div className="flex gap-3">
            <Button
              variant="ghost"
              onClick={() => previewTheme('exawatt-air-light')}
            >
              Air
            </Button>
            <Button
              variant="ghost"
              onClick={() => previewTheme('exawatt-night-dark')}
            >
              Night
            </Button>
          </div>
          <section
            aria-label="Agent ribbon"
            className="rounded border p-3"
            style={{ borderColor: HUD.strokeFaint, background: HUD.bg.deep }}
          >
            <TabStrip
              projects={[
                {
                  dir: '/eval',
                  name: 'Polish',
                  color: HUD.cyan,
                  activeTabId: active,
                  tabs,
                },
              ]}
              activeDir="/eval"
              pinnedTabId={null}
              summaries={{}}
              attention={attention}
              activity={{ 'working-question': true, reminder: true }}
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
            />
          </section>
          <section
            aria-label="Team cards"
            className="grid gap-3 md:grid-cols-2 xl:grid-cols-5"
          >
            {samples.map(sample => (
              <button
                key={sample.id}
                data-inspection-session={sample.id}
                onClick={() => inspect(sample.id)}
                aria-label={`Open ${sample.purpose}`}
                className="flex min-w-0 flex-col gap-3 rounded-lg border p-4 text-left"
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
                    sample.id === 'working-question' || sample.id === 'reminder'
                      ? 'working'
                      : sample.status === 'blocked'
                        ? 'blocked'
                        : 'done'
                  }
                  attention={signals[sample.id]}
                  current={sample.current}
                  next={null}
                />
              </button>
            ))}
          </section>
          <section
            aria-label="Fleet status marks"
            className="overflow-hidden rounded border"
            style={{ borderColor: HUD.strokeFaint, background: theme.canvas }}
          >
            <div className="h-40">
              <Canvas
                aria-hidden
                orthographic
                camera={{ position: [0, 0, 100], zoom: 1 }}
                frameloop="demand"
                dpr={[1, 1.5]}
                gl={{ preserveDrawingBuffer: true }}
                onCreated={({ gl }) => {
                  window.__UNREAD_EVAL_GL__ = gl;
                }}
              >
                <color attach="background" args={[theme.canvas]} />
                <StatusMarkLayer
                  pieces={pieces}
                  ambient={PARKED_AMBIENT}
                  lens="status"
                  theme={theme}
                />
              </Canvas>
            </div>
            <p className="p-3 text-chrome-meta text-muted-foreground">
              Unread result · read result · read request · working with question
              · working with reminder
            </p>
          </section>
        </div>
      </main>
    </TooltipProvider>
  );
}
