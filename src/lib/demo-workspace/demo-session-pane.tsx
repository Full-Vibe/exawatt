'use client';

/**
 * Demo Session pane (ENG-027 W2) — the pane content source, rendered.
 *
 * A Demo-tenant Session opens READABLE content: an authored hero transcript
 * when one exists, otherwise the Session's honest record (goal, subtitle,
 * status, blocker, team, usage). Never a PTY, never a simulated stream,
 * never a blank pane. There is no input affordance — a demo Session accepts
 * nothing, which is the "demo tabs cannot spawn a process" guarantee made
 * visible.
 */
import { HUD } from '@/components/hud';
import { HarnessGlyph } from '@/components/workspace/harness-icons';
import {
  STATUS_LIGHT_META,
  StatusLight,
  statusLightStateForAgentStatus,
} from '@/components/status-light';
import type { DemoFleetAgent } from '@exawatt/core';
import {
  demoPaneContent,
  demoProjectFor,
  demoShellNowMs,
  demoHarness,
} from './model';

function relativeTime(nowMs: number, atMs: number): string {
  const minutes = Math.floor(Math.max(0, nowMs - atMs) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

const ROLE_LABEL: Record<'operator' | 'agent' | 'tool', string> = {
  operator: 'operator',
  agent: 'agent',
  tool: 'tool',
};

const ROLE_COLOR: Record<'operator' | 'agent' | 'tool', string> = {
  operator: '#7FD4FF',
  agent: HUD.text,
  tool: '#B9A6FF',
};

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return `${n}`;
}

export function DemoSessionPane({ agent }: { agent: DemoFleetAgent }) {
  const nowMs = demoShellNowMs();
  const project = demoProjectFor(agent);
  const content = demoPaneContent(agent);
  const lightState = statusLightStateForAgentStatus(agent.status);

  return (
    <div
      data-demo-session-pane={agent.id}
      className="flex h-full min-h-0 flex-col overflow-hidden"
      style={{ background: '#04060b' }}
    >
      {/* Session header — identity, status, readiness truth */}
      <header
        className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-2.5"
        style={{ borderColor: `${project?.color ?? '#50E6FF'}33` }}
      >
        <span style={{ color: project?.color }}>
          <HarnessGlyph harness={demoHarness(agent)} size={14} />
        </span>
        <h2
          className="min-w-0 truncate font-display text-sm font-semibold"
          style={{ color: HUD.text }}
        >
          {agent.name}
        </h2>
        <span
          className="inline-flex items-center gap-1.5 font-mono text-[11px]"
          style={{ color: STATUS_LIGHT_META[lightState].color }}
        >
          <StatusLight decorative size="compact" state={lightState} />
          {STATUS_LIGHT_META[lightState].label}
        </span>
        {agent.roadmapItemId && (
          <span className="font-mono text-[11px]" style={{ color: HUD.textDim }}>
            {agent.roadmapItemId}
            {agent.link ? ` · ${agent.link}` : ''}
          </span>
        )}
        <span className="flex-1" />
        {agent.readiness === 'preview' && (
          <span
            data-demo-preview-marker
            className="rounded-sm border px-1.5 py-0.5 font-mono text-[10px]"
            style={{ borderColor: 'rgba(185,166,255,0.5)', color: '#B9A6FF' }}
            title={`${project?.agentType ?? 'This'} desks preview the Agent Types direction (ENG-028); the capability does not ship today.`}
          >
            Preview · {project?.agentType ?? 'Agent Types'}
          </span>
        )}
        <span
          className="font-mono text-[10px]"
          style={{ color: HUD.textDim }}
          title="Demo Sessions are authored recordings and records. They accept no input and can never spawn a process."
        >
          read-only demo Session
        </span>
      </header>

      {/* Goal line — the launch sentence, then the six-word subtitle */}
      <div className="shrink-0 border-b border-white/5 px-4 py-2.5">
        <p className="text-[13px] leading-relaxed" style={{ color: HUD.text }}>
          {agent.goal}
        </p>
        <p className="mt-0.5 font-mono text-[11px]" style={{ color: HUD.textDim }}>
          {agent.contextLabel} · {project?.name ?? agent.projectKey} · started{' '}
          {relativeTime(nowMs, agent.startedAtMs)} · last activity{' '}
          {relativeTime(nowMs, agent.lastActivityAtMs)}
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {/* Blocker — the needs-you story, verbatim from the record */}
        {agent.blocker && (
          <section
            data-demo-blocker
            className="mb-4 rounded-md border p-3"
            style={{
              borderColor: 'rgba(255,120,120,0.35)',
              background: 'rgba(255,80,80,0.06)',
            }}
          >
            <p className="font-mono text-[11px] text-red-300">
              needs you · {agent.blocker.title}
            </p>
            <p className="mt-1 text-[13px] leading-relaxed text-red-100/85">
              {agent.blocker.description}
            </p>
            {agent.blocker.suggestedResponses &&
              agent.blocker.suggestedResponses.length > 0 && (
                <p className="mt-2 font-mono text-[11px] text-red-200/70">
                  suggested: {agent.blocker.suggestedResponses.join(' · ')}
                </p>
              )}
          </section>
        )}

        {/* Fault — what actually failed */}
        {agent.faultNote && (
          <section
            data-demo-fault
            className="mb-4 rounded-md border p-3"
            style={{
              borderColor: 'rgba(255,120,120,0.35)',
              background: 'rgba(255,80,80,0.06)',
            }}
          >
            <p className="font-mono text-[11px] text-red-300">fault</p>
            <p className="mt-1 text-[13px] leading-relaxed text-red-100/85">
              {agent.faultNote}
            </p>
          </section>
        )}

        {/* Delegated team (ENG-023) */}
        {agent.delegated.length > 0 && (
          <section className="mb-4">
            <p className="mb-1.5 font-mono text-[11px]" style={{ color: HUD.textDim }}>
              {agent.delegated.length} delegated{' '}
              {agent.delegated.length === 1 ? 'agent' : 'agents'}
            </p>
            <ul className="flex flex-col gap-1">
              {agent.delegated.map(run => (
                <li
                  key={run.agentId}
                  className="flex items-baseline gap-2 font-mono text-[12px]"
                >
                  <span style={{ color: '#B9A6FF' }}>{run.agentType}</span>
                  <span style={{ color: HUD.text }}>{run.task}</span>
                  <span style={{ color: HUD.textDim }}>
                    {relativeTime(nowMs, run.startedAtMs)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {content.kind === 'transcript' ? (
          <section data-demo-transcript className="flex flex-col gap-3 pb-4">
            {content.lines.map((line, index) => (
              <div key={index} className="flex flex-col gap-0.5">
                <p className="font-mono text-[10px]" style={{ color: HUD.textDim }}>
                  {ROLE_LABEL[line.role]} · {relativeTime(nowMs, line.atMs)}
                </p>
                <p
                  className={
                    line.role === 'tool'
                      ? 'font-mono text-[12px] leading-relaxed'
                      : 'text-[13px] leading-relaxed'
                  }
                  style={{ color: ROLE_COLOR[line.role] }}
                >
                  {line.text}
                </p>
              </div>
            ))}
            <p className="mt-2 font-mono text-[10px]" style={{ color: HUD.textDim }}>
              End of recorded transcript.
            </p>
          </section>
        ) : (
          <section data-demo-session-record className="pb-4">
            <p className="font-mono text-[11px]" style={{ color: HUD.textDim }}>
              No transcript recorded for this Session — its goal, status, and
              usage above are the honest record, exactly what a real fleet
              shows for a tab you have not opened.
            </p>
          </section>
        )}
      </div>

      {/* Usage footer — fixture truth, no invented dollars */}
      <footer
        className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-t border-white/5 px-4 py-2 font-mono text-[11px]"
        style={{ color: HUD.textDim }}
      >
        <span>{agent.turns} turns</span>
        <span>{fmtTokens(agent.usage.input)} in</span>
        <span>{fmtTokens(agent.usage.output)} out</span>
        <span>{fmtTokens(agent.usage.cacheRead)} cache read</span>
        <span>
          {agent.model}
          {agent.effort ? ` · ${agent.effort}` : ''}
        </span>
        {agent.gitBranch && <span>{agent.gitBranch}</span>}
      </footer>
    </div>
  );
}
