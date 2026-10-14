'use client';

/**
 * The agent panel from the design partner's deck (slides 5 to 8), lofi
 * (ENG-031 W15): status, working time, credit usage, reset, model, source,
 * and one action, on the agent the stage lifts. The harness is its mark,
 * never its name.
 */

import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import type { StatusLightState } from '@/components/status-light/protocol';
import { usePrefersReducedMotion } from '@/lib/motion/use-prefers-reduced-motion';
import { formatMinutes, STATUS_LABEL, type FleetAgent } from './fleet-model';
import { MarkGlyph } from './mark-glyph';

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
  accent,
}: {
  agent: FleetAgent;
  className?: string;
  compact?: boolean;
  /** The product's selection colour, when the card is an open selection. */
  accent?: string;
}) {
  const resetMinutes = 240 - ((agent.id * 37) % 200);
  return (
    <div
      className={cn(
        'relative w-[300px] rounded-xl border border-white/12 bg-[#0b1018]/90 text-white shadow-2xl backdrop-blur-md',
        compact ? 'p-3' : 'p-4',
        className
      )}
      style={accent ? { borderColor: accent } : undefined}
      data-study-agent-card
    >
      {/* its status and its harness's mark: the card is an agent, so it does
          not need to say so (operator 2026-10-14: "we don't need the
          redundant phrase 'agent status'") */}
      <div className="flex items-center justify-between gap-3">
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
        <span className="flex items-center text-white/85" title={agent.source}>
          <MarkGlyph source={agent.source} size={15} />
        </span>
      </div>
      <p className="mt-2 truncate text-[15px] font-semibold">{agent.name}</p>
      {agent.status === 'active' && agent.steps && agent.steps.length > 1 ? (
        <StepTicker key={agent.id} agent={agent} steps={agent.steps} />
      ) : (
        <p className="truncate text-[12px] leading-[18px] text-white/55">
          {agent.doing}
        </p>
      )}
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
            {agent.model ? (
              <>
                <dt className="text-white/50">Model</dt>
                <dd className="text-white/85">{agent.model}</dd>
              </>
            ) : null}
          </dl>
          {/* the actions the product's card offers, drawn as a picture of
              them: on the homepage they have nothing to act on, so they
              are not controls a reader could press or tab to */}
          <div className="mt-4 flex justify-end gap-2" aria-hidden>
            {agent.status === 'needs-you' ? (
              <span className="rounded-md border border-white/15 px-3 py-1.5 text-[12px] font-medium text-white/80">
                Pause agent
              </span>
            ) : null}
            <span className="rounded-md bg-white px-3 py-1.5 text-[12px] font-semibold text-black">
              {agent.status === 'needs-you'
                ? 'Answer'
                : agent.status === 'result'
                  ? 'Review'
                  : 'View task'}
            </span>
          </div>
        </>
      )}
    </div>
  );
}

/** How long a working agent stays on a step, in milliseconds, and how far
 *  one agent's pace is from another's, so two cards never step together. */
const STEP_MS = 2600;
const STEP_SPREAD_MS = 700;
/** The roll from one step to the next. */
const ROLL_MS = 420;
const ROLL_EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';

const STEP_KEYFRAMES = `
@keyframes agent-step-in { from { transform: translateY(100%); opacity: 0 } to { transform: none; opacity: 1 } }
@keyframes agent-step-out { from { transform: none; opacity: 1 } to { transform: translateY(-100%); opacity: 0 } }
@keyframes agent-step-shimmer { 0%, 14% { background-position: 100% 0 } 78%, 100% { background-position: 0% 0 } }
`;

/**
 * A working agent's line (operator 2026-10-14: "show that text scrolling
 * by... just like how ChatGPT or Claude clients show thinking and the
 * current little micro-goal"): the step it is on, a light passing over it
 * once a step, and at each change the old step rolling up and out as the
 * next rolls in from below, through its goal's steps and round again. The
 * line keeps its height, so the card never moves. Under reduced motion it
 * is the step it is on, still.
 */
function StepTicker({
  agent,
  steps,
}: {
  agent: FleetAgent;
  /** Its goal's steps, two or more. */
  steps: string[];
}) {
  const reducedMotion = usePrefersReducedMotion();
  // from the step it says it is on
  const [at, setAt] = useState(() => ({
    step: Math.max(0, steps.indexOf(agent.doing)),
    previous: -1,
    turn: 0,
  }));
  // every agent keeps its own pace
  const period =
    STEP_MS + ((agent.id * 397) % STEP_SPREAD_MS) - STEP_SPREAD_MS / 2;
  useEffect(() => {
    if (reducedMotion || steps.length < 2) return;
    let timer = 0;
    const advance = () => {
      setAt(current => ({
        step: (current.step + 1) % steps.length,
        previous: current.step,
        turn: current.turn + 1,
      }));
      timer = window.setTimeout(advance, period);
    };
    timer = window.setTimeout(advance, period);
    return () => window.clearTimeout(timer);
  }, [reducedMotion, steps, period]);

  if (reducedMotion)
    return (
      <p className="truncate text-[12px] leading-[18px] text-white/55">
        {agent.doing}
      </p>
    );
  return (
    <p className="relative h-[18px] overflow-hidden text-[12px] leading-[18px]">
      <style>{STEP_KEYFRAMES}</style>
      {at.previous >= 0 ? (
        <span
          key={`out-${at.turn}`}
          aria-hidden
          className="absolute inset-x-0 top-0 truncate text-white/55"
          style={{ animation: `agent-step-out ${ROLL_MS}ms ${ROLL_EASE} both` }}
        >
          {steps[at.previous]}
        </span>
      ) : null}
      {/* the light passes over the words, not the line's whole width */}
      <span
        key={`in-${at.turn}`}
        className="absolute inset-x-0 top-0"
        style={
          at.turn > 0
            ? { animation: `agent-step-in ${ROLL_MS}ms ${ROLL_EASE} both` }
            : undefined
        }
      >
        <span
          className="inline-block max-w-full truncate bg-gradient-to-r from-white/55 from-35% via-white via-50% to-white/55 to-65% bg-clip-text align-top text-transparent"
          style={{
            backgroundSize: '250% 100%',
            animation: `agent-step-shimmer ${period}ms linear infinite`,
          }}
        >
          {steps[at.step]}
        </span>
      </span>
    </p>
  );
}
