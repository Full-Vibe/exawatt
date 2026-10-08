'use client';

/**
 * The agent panel from the design partner's deck (slides 5 to 8), lofi
 * (ENG-031 W15): status, working time, credit usage, reset, model, source,
 * and one action. It is pointed at a real agent in the visual by a leader
 * line the experience draws, so the panel is never decoration.
 */

import { cn } from '@/lib/utils';
import type { StatusLightState } from '@/components/status-light/protocol';
import { formatMinutes, STATUS_LABEL, type FleetAgent } from './fleet-model';

const STATUS_TONE: Record<StatusLightState, string> = {
  active: 'text-sky-300',
  'needs-you': 'text-amber-300',
  result: 'text-emerald-300',
  off: 'text-white/55',
  fault: 'text-rose-300',
};

const STATUS_DOT: Record<StatusLightState, string> = {
  active: 'bg-sky-300',
  'needs-you': 'bg-amber-300',
  result: 'bg-emerald-300',
  off: 'bg-white/40',
  fault: 'bg-rose-300',
};

export function AgentCard({
  agent,
  className,
  compact = false,
}: {
  agent: FleetAgent;
  className?: string;
  compact?: boolean;
}) {
  const resetMinutes = 240 - ((agent.id * 37) % 200);
  return (
    <div
      className={cn(
        'w-[300px] rounded-xl border border-white/12 bg-[#0b1018]/90 text-white shadow-2xl backdrop-blur-md',
        compact ? 'p-3' : 'p-4',
        className
      )}
      data-study-agent-card
    >
      <div className="flex items-center justify-between gap-3">
        <p className="text-[13px] font-medium text-white/80">Agent status</p>
        <p
          className={cn(
            'flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.12em]',
            STATUS_TONE[agent.status]
          )}
        >
          <span
            className={cn('h-1.5 w-1.5 rounded-full', STATUS_DOT[agent.status])}
          />
          {STATUS_LABEL[agent.status]}
        </p>
      </div>
      <p className="mt-2 truncate text-[15px] font-semibold">{agent.name}</p>
      <p className="truncate text-[12px] text-white/55">{agent.doing}</p>
      {compact ? null : (
        <>
          <dl className="mt-4 grid grid-cols-[1fr_auto] gap-x-4 gap-y-2 text-[12px]">
            <dt className="text-white/50">Working time</dt>
            <dd className="font-mono text-white/85">
              {formatMinutes(agent.minutes)}
            </dd>
            <dt className="text-white/50">Credit usage</dt>
            <dd className="flex items-center gap-2">
              <span className="h-1 w-20 overflow-hidden rounded-full bg-white/12">
                <span
                  className={cn(
                    'block h-full rounded-full',
                    agent.burn > 0.85 ? 'bg-rose-400' : 'bg-sky-300'
                  )}
                  style={{ width: `${Math.round(agent.burn * 100)}%` }}
                />
              </span>
              <span className="font-mono text-white/85">
                {Math.round(agent.burn * 100)}%
              </span>
            </dd>
            <dt className="text-white/50">Credit reset in</dt>
            <dd className="font-mono text-white/85">
              {formatMinutes(resetMinutes)}
            </dd>
            <dt className="text-white/50">Model</dt>
            <dd className="text-white/85">{agent.model}</dd>
            <dt className="text-white/50">Source</dt>
            <dd className="text-white/85">{agent.source}</dd>
          </dl>
          <div className="mt-4 flex justify-end gap-2">
            {agent.status === 'needs-you' ? (
              <button
                type="button"
                className="rounded-md border border-white/15 px-3 py-1.5 text-[12px] font-medium text-white/80 hover:bg-white/5"
              >
                Pause agent
              </button>
            ) : null}
            <button
              type="button"
              className="rounded-md bg-white px-3 py-1.5 text-[12px] font-semibold text-black hover:bg-white/90"
            >
              {agent.status === 'needs-you'
                ? 'Answer'
                : agent.status === 'result'
                  ? 'Review'
                  : 'View task'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
