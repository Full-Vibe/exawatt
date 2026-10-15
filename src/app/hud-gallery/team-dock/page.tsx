'use client';

/**
 * Team dock specimen (ENG-029 B3, design-system rule: cross-surface state is
 * reviewed here from the production components). The real `TeamDock` with
 * its two real panels — the roadmap over a lab fixture, Chatter over the Demo
 * bus client — plus every Chatter state side by side: each delivery result,
 * loading, empty, Live without a bus, and a failed read.
 */
import { useMemo, useState } from 'react';
import { DEMO_BASE_AGENTS, DEMO_PROJECTS } from '@exawatt/core';
import { RoadmapPanel } from '@/components/roadmap/roadmap-panel';
import { ROADMAP_LAB_STATES } from '@/components/roadmap/lab-fixtures';
import {
  TEAM_DOCK_WIDTH,
  TeamDock,
  useTeamDockTab,
} from '@/components/team/team-dock';
import type { ChatterParticipant } from '@/components/team/chatter/chatter-endpoint';
import { ChatterRow } from '@/components/team/chatter/chatter-row';
import { ChatterView } from '@/components/team/chatter/chatter-view';
import { WORKSPACE_HUD as HUD } from '@/components/workspace/workspace-theme';
import { createDemoBusClient, demoBusMessages } from '@/lib/bus/demo-client';
import { latestAt } from '@/lib/bus/selectors';
import { refusedSend } from '@/lib/bus/client';
import type { BusDeliveryState } from '@exawatt/core';
import {
  BusClientProvider,
  useBusMessages,
  useProjectUnread,
  type BusMessagesState,
} from '@/lib/bus/use-bus';

const NOW = Date.now();
const DEMO_CLIENT = createDemoBusClient(NOW);
const MESSAGES = demoBusMessages(NOW);
const CHATTER_PROJECTS = DEMO_PROJECTS.filter(project =>
  MESSAGES.some(message => message.projectId === project.dir)
);
const PARTICIPANTS: ReadonlyMap<string, ChatterParticipant> = new Map(
  DEMO_BASE_AGENTS.map(agent => [agent.id, { label: agent.name, tabId: null }])
);
const DELIVERY_STATES: BusDeliveryState[] = [
  'delivered',
  'queued',
  'held',
  'terminal',
  'undeliverable',
  'expired',
  'unknown',
];
const noSend = async () => refusedSend('Specimen');

function Frame({
  label,
  children,
  width = TEAM_DOCK_WIDTH,
  height = 560,
}: {
  label: string;
  children: React.ReactNode;
  width?: number;
  height?: number;
}) {
  return (
    <figure className="flex flex-col gap-2">
      <figcaption
        className="font-ui text-chrome-label"
        style={{ color: HUD.textDim }}
      >
        {label}
      </figcaption>
      <div
        className="flex flex-col overflow-hidden rounded-lg border"
        style={{
          width,
          height,
          borderColor: HUD.strokeFaint,
          background: HUD.bg.deep,
        }}
      >
        {children}
      </div>
    </figure>
  );
}

function DockSpecimen() {
  const [projectId, setProjectId] = useState(CHATTER_PROJECTS[0].dir);
  const [tab, setTab] = useTeamDockTab();
  const project = CHATTER_PROJECTS.find(p => p.dir === projectId)!;
  const chatter = useBusMessages(projectId);
  const unread = useProjectUnread(projectId, chatter.state);
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-1.5">
        {CHATTER_PROJECTS.map(candidate => (
          <button
            key={candidate.dir}
            type="button"
            onClick={() => setProjectId(candidate.dir)}
            className="rounded-full border px-3 py-1 font-ui text-chrome-label outline-none focus-visible:ring-1 focus-visible:ring-hud-cyan"
            style={{
              borderColor:
                candidate.dir === projectId ? HUD.stroke : HUD.strokeFaint,
              color: candidate.dir === projectId ? HUD.text : HUD.textDim,
            }}
          >
            {candidate.name}
          </button>
        ))}
      </div>
      <div
        className="relative flex h-[640px] overflow-hidden rounded-xl border"
        style={{ borderColor: HUD.strokeFaint, background: HUD.bg.void }}
      >
        <div
          className="grid flex-1 place-items-center font-ui text-chrome-meta"
          style={{ color: HUD.textDim }}
        >
          Team grid
        </div>
        <TeamDock
          overlay={false}
          tab={tab}
          onTabChange={setTab}
          panels={[
            {
              id: 'roadmap',
              label: 'Roadmap',
              content: (
                <RoadmapPanel
                  view={ROADMAP_LAB_STATES[0].view}
                  projectDir={project.dir}
                  projectName={project.name}
                  projectColor={project.color}
                  onSelectSession={() => {}}
                  untriagedFeedback={null}
                />
              ),
            },
            {
              id: 'chatter',
              label: 'Chatter',
              badge: tab === 'chatter' ? 0 : unread,
              badgeLabel: `${unread} unread`,
              content: (
                <ChatterView
                  projectId={projectId}
                  projectName={project.name}
                  projectColor={project.color}
                  state={chatter.state}
                  send={chatter.send}
                  participants={PARTICIPANTS}
                  visible={tab === 'chatter'}
                  onSelectSession={() => {}}
                />
              ),
            },
          ]}
        />
      </div>
    </section>
  );
}

function StateFrame({
  label,
  state,
}: {
  label: string;
  state: BusMessagesState;
}) {
  return (
    <Frame label={label} height={220}>
      <ChatterView
        projectId={CHATTER_PROJECTS[0].dir}
        projectName={CHATTER_PROJECTS[0].name}
        projectColor={CHATTER_PROJECTS[0].color}
        state={state}
        send={noSend}
        participants={PARTICIPANTS}
        visible={false}
        onSelectSession={() => {}}
      />
    </Frame>
  );
}

export default function TeamDockSpecimenPage() {
  const byState = useMemo(
    () =>
      DELIVERY_STATES.map(
        state => MESSAGES.find(message => message.delivery.state === state)!
      ),
    []
  );
  const newest = latestAt(MESSAGES);
  return (
    <main
      className="min-h-svh px-8 py-8"
      style={{ background: HUD.bg.void, color: HUD.text }}
    >
      <header className="mb-6 flex max-w-3xl flex-col gap-1.5">
        <h1 className="font-display text-surface-title font-semibold">
          Team dock
        </h1>
        <p className="font-ui text-sm" style={{ color: HUD.textDim }}>
          The production dock and its two panels over the Demo Workspace:
          Roadmap, and Chatter with Voltaic&apos;s authored agent messages.
          Switch tabs, pick a Project, open a row, open a message in place, and
          try Send as operator (the Demo answers that it cannot send).
        </p>
      </header>

      <BusClientProvider client={DEMO_CLIENT}>
        <DockSpecimen />
      </BusClientProvider>

      <h2 className="mb-3 mt-10 font-display text-lg font-semibold">
        Every delivery result
      </h2>
      <Frame label="One row per result" height={byState.length * 46 + 8}>
        <div className="py-1">
          {byState.map(message => (
            <ChatterRow
              key={message.id}
              message={message}
              participants={PARTICIPANTS}
              now={NOW}
              unread={message.at === newest}
              selected={false}
              onOpen={() => {}}
              onHover={() => {}}
            />
          ))}
        </div>
      </Frame>

      <h2 className="mb-3 mt-10 font-display text-lg font-semibold">
        Panel states
      </h2>
      <div className="flex flex-wrap gap-6">
        <StateFrame label="Loading" state={{ status: 'loading' }} />
        <StateFrame
          label="No messages yet"
          state={{ status: 'ok', messages: [] }}
        />
        <StateFrame
          label="Live, this build has no bus"
          state={{
            status: 'unavailable',
            reason:
              'This version of Exawatt does not carry agent messages yet.',
          }}
        />
        <StateFrame
          label="Live, the read failed"
          state={{ status: 'error', message: 'The message log is unreadable.' }}
        />
      </div>
    </main>
  );
}
