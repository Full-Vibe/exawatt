'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import {
  selectFleetCommandView,
  selectSpatialBoardLayout,
  selectSpatialGhostSlots,
} from '@exawatt/ui-model';
import { OperationsBoardSurface } from '@/components/fleet/spatial/operations-board/operations-board-surface';
import { SpatialSelectionPanel } from '@/components/fleet/spatial/spatial-selection-panel';
import { directRecipients } from '@/components/fleet/spatial/direct/direct-model';
import type {
  DirectAvailability,
  DirectResult,
} from '@/components/fleet/spatial/direct/direct-model';
import { boardStudyFleet } from '@/components/hud/board-study-fixtures';
import { DEMO_BUS_SEND_REASON } from '@exawatt/core';

/**
 * ENG-004 V4.2 specimens: Direct N Agents and the ghost slot, rendered by the
 * production components over the Demo fleet. Each Direct specimen is one
 * moment of the same panel (before Send, after Send, and a board that cannot
 * send), with results injected rather than sent.
 */

const CALLOUT = {
  border: 'var(--border)',
  background: 'transparent',
  text: 'var(--foreground)',
  detail: 'var(--muted-foreground)',
  signal: 'var(--foreground)',
};

const STATES: Array<{
  id: string;
  title: string;
  availability: DirectAvailability;
  results: (ids: string[]) => Map<string, DirectResult>;
}> = [
  {
    id: 'before',
    title: 'Before Send',
    availability: { kind: 'ready' },
    results: () => new Map(),
  },
  {
    id: 'after',
    title: 'After Send',
    availability: { kind: 'ready' },
    results: ids =>
      new Map<string, DirectResult>([
        [ids[0]!, { state: 'delivered' }],
        [ids[1]!, { state: 'queued' }],
        [ids[2]!, { state: 'terminal' }],
        [ids[3]!, { state: 'undeliverable', reason: 'Session stopped' }],
      ]),
  },
  {
    id: 'demo',
    title: 'Demo',
    availability: { kind: 'unavailable', reason: DEMO_BUS_SEND_REASON },
    results: () => new Map(),
  },
];

export default function DirectAgentsSpecimenPage() {
  const fleet = useMemo(() => boardStudyFleet('demo'), []);
  const picked = useMemo(() => {
    const live = Object.values(fleet.agents).filter(
      agent => agent.sessionState !== 'stopped'
    );
    const working = live.find(agent => agent.status === 'working')!;
    const others = live.filter(agent => agent.status !== 'working');
    const stopped = { ...others[2]!, sessionState: 'stopped' as const };
    return [others[0]!, working, others[1]!, stopped];
  }, [fleet]);
  const recipients = useMemo(() => directRecipients(picked), [picked]);
  const views = useMemo(() => {
    const view = selectFleetCommandView(fleet, { now: 0 });
    return picked.map(
      agent =>
        view.agents.find(candidate => candidate.id === agent.id) ??
        view.agents[0]!
    );
  }, [fleet, picked]);
  const layout = useMemo(() => {
    const base = selectSpatialBoardLayout(fleet);
    const project = base.zones.find(zone => !zone.isAggregate)?.id ?? null;
    return selectSpatialBoardLayout(fleet, {
      altitude: 'project',
      focusedProjectId: project,
      selectedProjectId: project,
    });
  }, [fleet]);
  const ghosts = useMemo(() => selectSpatialGhostSlots(layout), [layout]);
  const ids = recipients.map(recipient => recipient.agentId);

  return (
    <main className="min-h-screen bg-background p-6 text-foreground">
      <header className="mb-6 flex items-end justify-between gap-4">
        <div>
          <p className="text-chrome-label text-muted-foreground">
            HUD Gallery / ENG-004 V4.2
          </p>
          <h1 className="mt-1 text-2xl font-semibold">
            Direct and ghost slots
          </h1>
        </div>
        <Link
          href="/hud-gallery"
          className="text-sm underline underline-offset-4"
        >
          Gallery
        </Link>
      </header>
      <section className="grid gap-4 md:grid-cols-3" aria-label="Direct">
        {STATES.map(state => (
          <figure key={state.id} data-specimen={state.id} className="min-w-0">
            <figcaption className="mb-2 text-chrome-label text-muted-foreground">
              {state.title}
            </figcaption>
            <div className="grid max-h-[640px] border border-border">
              <SpatialSelectionPanel
                agent={null}
                selectedAgents={views}
                scopeActivity={null}
                activity={[]}
                delegation={null}
                statusColors={{
                  active: '#5fb3ff',
                  blocked: '#ff9f5a',
                  idle: '#8a93a3',
                }}
                needsOperatorCallout={CALLOUT}
                faultCallout={CALLOUT}
                isDemo={state.id === 'demo'}
                opening={false}
                handoffError={null}
                now={0}
                onOpenSession={() => undefined}
                onClearSelection={() => undefined}
                onInspectAgent={() => undefined}
                direct={{
                  recipients,
                  addresses: new Map(),
                  availability: state.availability,
                  results: state.results(ids),
                  sending: false,
                  onSend: async () => false,
                  shortcutLabel: '⌘D',
                }}
              />
            </div>
          </figure>
        ))}
      </section>
      <section className="mt-8" aria-label="Ghost slots">
        <p className="mb-2 text-chrome-label text-muted-foreground">
          Ghost slots, Project altitude
        </p>
        <div
          data-specimen="ghosts"
          className="relative h-[520px] border border-border"
        >
          <OperationsBoardSurface
            layout={layout}
            projection="top-down"
            onDrillProject={() => undefined}
            onSelectAgent={() => undefined}
            onOverview={() => undefined}
            onProjectionChange={() => undefined}
            ghostSlots={ghosts}
            onActivateGhost={() => undefined}
            preserveDrawingBuffer
          />
        </div>
      </section>
    </main>
  );
}
