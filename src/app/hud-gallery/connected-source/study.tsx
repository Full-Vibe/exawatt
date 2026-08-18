'use client';

/**
 * Connected Agents study (ENG-010 C2).
 *
 * The cross-surface treatment this study exists to review holds four facts
 * apart that a naive card collapses into one badge:
 *
 *   placement   Local / Remote / Exawatt Cloud, an infrastructure fact
 *   connection  Live / Reconnecting / Stale / Unavailable, observation age
 *   work state  the D40 five-signal protocol, identical for every placement
 *   identity    SourceIdentityMark plus source metadata, never the name
 *
 * Placement is painted from the HUD dim-text role only: it may never borrow a
 * D40 status role, a Project identity color, or a source brand color. The
 * source brand color stays inside `SourceIdentityMark`'s instrument plate.
 *
 * Colour is switchable off because the acceptance criterion is that remote
 * state stays comprehensible without colour, hover, or animation.
 *
 * The work-state word comes from `statusLightWord`, the same owner production
 * Team tiles read (ENG-033 H2). The operator reviewed the word here and
 * adopted it there; sharing the owner is what keeps the study and the shipped
 * roster from drifting apart again.
 */
import { useState } from 'react';
import type { ComponentType, ReactNode } from 'react';
import {
  Clock,
  Cloud,
  Monitor,
  RefreshCw,
  Server,
  Signal,
  Unplug,
} from 'lucide-react';
import type { AgentSourcePlacement, ConnectionStatus } from '@exawatt/core';
import {
  describeConnectionStatus,
  resolveConnectionStatus,
} from '@exawatt/core';
import {
  StatusLight,
  statusLightWord,
  type StatusLightState,
} from '@/components/status-light';
import { SourceIdentityMark } from '@/components/workspace/source-identity-mark';
import { OpenClawIcon } from '@/components/workspace/harness-icons';
import {
  WORKSPACE_HUD as HUD,
  withThemeAlpha,
} from '@/components/workspace/workspace-theme';
import {
  AUTOMATION_ONLY_AGENT,
  IDENTITY_DRIFT_AGENT,
  OPENCLAW_SOURCE,
  ROSTER,
  type ConnectedAgentFixture,
} from './fixtures';

type Glyph = ComponentType<{ size?: number | string; className?: string }>;

const PLACEMENT: Record<AgentSourcePlacement, { label: string; Glyph: Glyph }> =
  {
    local: { label: 'Local', Glyph: Monitor },
    'customer-hosted': { label: 'Remote', Glyph: Server },
    'exawatt-hosted': { label: 'Exawatt Cloud', Glyph: Cloud },
  };

const CONNECTION_GLYPH: Record<ConnectionStatus['state'], Glyph> = {
  live: Signal,
  reconnecting: RefreshCw,
  stale: Clock,
  unavailable: Unplug,
};

function PlacementTag({ placement }: { placement: AgentSourcePlacement }) {
  const { label, Glyph: PlacementGlyph } = PLACEMENT[placement];
  return (
    <span
      className="inline-flex items-center gap-1"
      data-placement={placement}
      style={{ color: HUD.textDim }}
    >
      <PlacementGlyph size={12} />
      <span className="text-chrome-meta">{label}</span>
    </span>
  );
}

function SourceLine({ placement }: { placement: AgentSourcePlacement }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <SourceIdentityMark
        className="size-4 rounded-sm"
        color={OPENCLAW_SOURCE.color}
      >
        <OpenClawIcon size={11} />
      </SourceIdentityMark>
      <span className="text-chrome-meta" style={{ color: HUD.textDim }}>
        {OPENCLAW_SOURCE.label}
      </span>
      <span aria-hidden="true" style={{ color: HUD.textDim }}>
        ·
      </span>
      <PlacementTag placement={placement} />
    </span>
  );
}

function ConnectionChip({ status }: { status: ConnectionStatus }) {
  const ChipGlyph = CONNECTION_GLYPH[status.state];
  const attention = status.state === 'unavailable';
  const ink = attention ? HUD.amber : HUD.textDim;
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1.5 rounded border px-2 py-0.5 text-chrome-meta"
      data-connection-chip={status.state}
      style={{
        color: ink,
        borderColor: withThemeAlpha(ink, 0.32),
        background: withThemeAlpha(ink, 0.06),
      }}
    >
      <ChipGlyph size={12} />
      {describeConnectionStatus(status)}
    </span>
  );
}

function StudyButton({
  children,
  quiet = false,
}: {
  children: string;
  quiet?: boolean;
}) {
  return (
    <button
      className="inline-flex min-h-11 items-center rounded px-3 text-chrome-label transition-colors duration-200 outline-none focus-visible:ring-2 motion-reduce:transition-none"
      style={{
        color: quiet ? HUD.textDim : HUD.text,
        border: quiet
          ? '1px solid transparent'
          : `1px solid ${withThemeAlpha(HUD.textDim, 0.32)}`,
      }}
      type="button"
    >
      {children}
    </button>
  );
}

function WorkLine({
  work,
  workLine,
  lastKnown,
}: {
  work: StatusLightState;
  workLine: string;
  lastKnown: boolean;
}) {
  return (
    <p
      className="flex flex-wrap items-center gap-x-2 gap-y-1 text-chrome-meta"
      data-current={lastKnown ? 'false' : 'true'}
      data-work-line
    >
      {lastKnown ? (
        <span
          className="rounded border px-1.5 py-0.5"
          data-last-known
          style={{
            color: HUD.textDim,
            borderColor: withThemeAlpha(HUD.textDim, 0.28),
          }}
        >
          Last known
        </span>
      ) : null}
      <span style={{ color: HUD.text, opacity: lastKnown ? 0.62 : 1 }}>
        {statusLightWord(work)}
      </span>
      <span style={{ color: HUD.textDim, opacity: lastKnown ? 0.62 : 1 }}>
        {workLine}
      </span>
    </p>
  );
}

function panelStyle() {
  return {
    borderColor: withThemeAlpha(HUD.textDim, 0.18),
    background: HUD.bg.panelFill,
  };
}

function AgentCard({ agent }: { agent: ConnectedAgentFixture }) {
  const status = resolveConnectionStatus(agent.observation);
  return (
    <article
      className="flex flex-col gap-2 rounded-lg border p-4"
      data-connected-agent={agent.id}
      data-connection={status.state}
      style={panelStyle()}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <StatusLight size="standard" state={agent.work} />
          <div className="min-w-0">
            <p
              className="truncate text-base font-semibold"
              style={{ color: HUD.text }}
            >
              {agent.name}
            </p>
            <p className="text-chrome-meta" style={{ color: HUD.textDim }}>
              {agent.project}
            </p>
          </div>
        </div>
        <ConnectionChip status={status} />
      </div>

      <WorkLine
        lastKnown={status.stalePresentation}
        work={agent.work}
        workLine={agent.workLine}
      />

      <div className="mt-auto flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <SourceLine placement={agent.placement} />
        {status.state === 'stale' || status.state === 'unavailable' ? (
          <span className="flex items-center gap-1">
            <StudyButton>Reconnect</StudyButton>
            {status.state === 'unavailable' ? (
              <StudyButton quiet>Source details</StudyButton>
            ) : null}
          </span>
        ) : null}
      </div>
    </article>
  );
}

function PanelHeader({
  name,
  project,
  work,
  placement,
  status,
}: {
  name: string;
  project: string;
  work: StatusLightState;
  placement: AgentSourcePlacement;
  status: ConnectionStatus;
}) {
  return (
    <header className="flex flex-col gap-2">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <StatusLight size="standard" state={work} />
          <div className="min-w-0">
            <p
              className="truncate text-base font-semibold"
              style={{ color: HUD.text }}
            >
              {name}
            </p>
            <p className="text-chrome-meta" style={{ color: HUD.textDim }}>
              {project}
            </p>
          </div>
        </div>
        <ConnectionChip status={status} />
      </div>
      <SourceLine placement={placement} />
    </header>
  );
}

function PanelSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-1.5" data-panel-section={title}>
      <h4 className="text-chrome-title font-medium" style={{ color: HUD.text }}>
        {title}
      </h4>
      {children}
    </section>
  );
}

function AutomationOnlyAgentPanel() {
  const agent = AUTOMATION_ONLY_AGENT;
  const status = resolveConnectionStatus(agent.observation);
  return (
    <article
      className="flex flex-col gap-4 rounded-lg border p-4"
      data-agent-panel="automation-only"
      style={panelStyle()}
    >
      <PanelHeader
        name={agent.name}
        placement={agent.placement}
        project={agent.project}
        status={status}
        work={agent.work}
      />
      <PanelSection title="Automations">
        {agent.automations.map(automation => (
          <div className="flex flex-col gap-0.5" key={automation.id}>
            <p className="text-sm" style={{ color: HUD.text }}>
              {automation.name}
            </p>
            <p className="text-chrome-meta" style={{ color: HUD.textDim }}>
              {automation.schedule}
            </p>
            <p className="text-chrome-meta" style={{ color: HUD.textDim }}>
              {automation.lastRun}. {automation.nextRun}.
            </p>
          </div>
        ))}
      </PanelSection>
      <PanelSection title="Work">
        <WorkLine
          lastKnown={status.stalePresentation}
          work={agent.work}
          workLine={agent.workLine}
        />
      </PanelSection>
      <PanelSection title="History">
        <p className="text-chrome-meta" style={{ color: HUD.textDim }}>
          {agent.history}
        </p>
      </PanelSection>
      <p
        className="text-chrome-meta"
        data-conversation-state="unavailable"
        style={{ color: HUD.textDim }}
      >
        Conversation unavailable on this source
      </p>
    </article>
  );
}

function IdentityDriftPanel() {
  const agent = IDENTITY_DRIFT_AGENT;
  const status = resolveConnectionStatus(agent.observation);
  return (
    <article
      className="flex flex-col gap-4 rounded-lg border p-4"
      data-agent-panel="identity-drift"
      style={panelStyle()}
    >
      <PanelHeader
        name={agent.name}
        placement={agent.placement}
        project={agent.project}
        status={status}
        work={agent.work}
      />
      <PanelSection title="Identity drift">
        <div className="grid gap-2 sm:grid-cols-2">
          {[agent.mapped, agent.observed].map(side => (
            <div
              className="flex flex-col gap-0.5 rounded border p-3"
              data-identity-side={side.label}
              key={side.label}
              style={{ borderColor: withThemeAlpha(HUD.textDim, 0.22) }}
            >
              <p className="text-chrome-meta" style={{ color: HUD.textDim }}>
                {side.label}
              </p>
              <p className="text-sm font-medium" style={{ color: HUD.text }}>
                {side.name}
              </p>
              <p
                className="font-mono text-chrome-meta"
                style={{ color: HUD.textDim }}
              >
                {side.nativeId}
              </p>
              <p className="text-chrome-meta" style={{ color: HUD.textDim }}>
                {side.detail}
              </p>
            </div>
          ))}
        </div>
      </PanelSection>
      <div className="flex flex-wrap items-center gap-2">
        <StudyButton>Remap</StudyButton>
        <StudyButton>Detach</StudyButton>
      </div>
    </article>
  );
}

export function ConnectedSourceStudy() {
  const [colour, setColour] = useState(true);

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-center gap-1.5">
        {[
          { label: 'Colour', on: colour },
          { label: 'No colour', on: !colour },
        ].map(option => (
          <button
            aria-pressed={option.on}
            className="inline-flex min-h-11 items-center rounded border px-3 text-chrome-label transition-colors duration-200 outline-none focus-visible:ring-2 motion-reduce:transition-none"
            data-colour-option={option.label}
            key={option.label}
            onClick={() => setColour(option.label === 'Colour')}
            style={{
              color: option.on ? HUD.text : HUD.textDim,
              borderColor: withThemeAlpha(HUD.textDim, option.on ? 0.55 : 0.2),
              background: option.on
                ? withThemeAlpha(HUD.textDim, 0.08)
                : 'transparent',
            }}
            type="button"
          >
            {option.label}
          </button>
        ))}
      </div>

      <div
        className="flex flex-col gap-8"
        data-colour={colour ? 'on' : 'off'}
        data-connected-source-deck
        style={colour ? undefined : { filter: 'grayscale(1)' }}
      >
        <section className="flex flex-col gap-3" data-study-section="roster">
          <h3 className="text-lg font-semibold" style={{ color: HUD.text }}>
            Team
          </h3>
          <div className="grid gap-3 lg:grid-cols-2">
            {ROSTER.map(agent => (
              <AgentCard agent={agent} key={agent.id} />
            ))}
          </div>
          <p className="text-chrome-meta" style={{ color: HUD.textDim }}>
            Live, Reconnecting, and the last-seen time describe Exawatt&apos;s
            connection. Work state is what the Agent was doing when Exawatt last
            saw it.
          </p>
        </section>

        <section className="flex flex-col gap-3" data-study-section="agent">
          <h3 className="text-lg font-semibold" style={{ color: HUD.text }}>
            Agent
          </h3>
          <div className="grid gap-3 lg:grid-cols-2">
            <AutomationOnlyAgentPanel />
            <IdentityDriftPanel />
          </div>
        </section>
      </div>
    </div>
  );
}
