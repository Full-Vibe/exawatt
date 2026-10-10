'use client';

/**
 * The open agent (ENG-031 W15e, operator 2026-10-09: "some sort of full
 * panel, but very small and simple and subtle... feel like it's part of
 * the scene and be desirable UI instead of an afterthought").
 *
 * Glass over the globe, tethered to the tile by a leader the experience
 * draws in the product's selection colour, corner ticks in the same
 * colour, the status as a lit dot, three facts, one action. Nothing in it
 * is decoration; every line is a thing the product knows about the agent.
 */

import type { SpatialThemeSnapshot } from '@/components/fleet/spatial/spatial-theme';
import { formatMinutes, STATUS_LABEL, type FleetAgent } from './fleet-model';

export function AgentPanel({
  agent,
  theme,
}: {
  agent: FleetAgent;
  theme: SpatialThemeSnapshot;
}) {
  const accent = theme.selection;
  const status = theme.status[agent.status];
  const action =
    agent.status === 'needs-you'
      ? 'Answer'
      : agent.status === 'result'
        ? 'Review result'
        : 'View task';
  const tick = 'pointer-events-none absolute h-2 w-2';
  return (
    <div
      className="relative w-[236px] rounded-md border bg-[#070b12]/70 px-3 py-2.5 text-white shadow-[0_18px_40px_rgba(0,0,0,0.5)] backdrop-blur-md"
      style={{ borderColor: `${accent}55` }}
      data-study-agent-panel
    >
      <span
        className={`${tick} -left-px -top-px border-l border-t`}
        style={{ borderColor: accent }}
      />
      <span
        className={`${tick} -right-px -top-px border-r border-t`}
        style={{ borderColor: accent }}
      />
      <span
        className={`${tick} -bottom-px -left-px border-b border-l`}
        style={{ borderColor: accent }}
      />
      <span
        className={`${tick} -bottom-px -right-px border-b border-r`}
        style={{ borderColor: accent }}
      />
      <div className="flex items-center justify-between gap-2">
        <span
          className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.16em]"
          style={{ color: status }}
        >
          <span
            className="h-1.5 w-1.5 rounded-full"
            style={{ background: status, boxShadow: `0 0 8px ${status}` }}
          />
          {STATUS_LABEL[agent.status]}
        </span>
        <span className="font-mono text-[10px] text-white/45">
          {agent.source}
        </span>
      </div>
      <p className="mt-1.5 truncate text-[13px] font-medium">{agent.name}</p>
      <p className="truncate text-[11px] text-white/55">{agent.doing}</p>
      <dl className="mt-2 grid grid-cols-3 gap-x-2 border-t border-white/8 pt-2 text-[10px]">
        <div>
          <dt className="text-white/40">Time</dt>
          <dd className="font-mono text-[11px] text-white/85">
            {formatMinutes(agent.minutes)}
          </dd>
        </div>
        <div>
          <dt className="text-white/40">Credit</dt>
          <dd className="mt-1 flex items-center gap-1.5">
            <span className="h-1 w-9 overflow-hidden rounded-full bg-white/12">
              <span
                className="block h-full rounded-full"
                style={{
                  width: `${Math.round(agent.burn * 100)}%`,
                  background: agent.burn > 0.85 ? theme.status.fault : accent,
                }}
              />
            </span>
            <span className="font-mono text-[11px] text-white/85">
              {Math.round(agent.burn * 100)}%
            </span>
          </dd>
        </div>
        <div>
          <dt className="text-white/40">Model</dt>
          <dd className="truncate text-[11px] text-white/85">{agent.model}</dd>
        </div>
      </dl>
      <button
        type="button"
        className="mt-2.5 w-full rounded border px-2 py-1 text-[11px] font-medium transition-colors hover:bg-white/5"
        style={{ borderColor: `${accent}66`, color: accent }}
      >
        {action}
      </button>
    </div>
  );
}
