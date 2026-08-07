'use client';

/**
 * Team ordering study (ENG-015 S6, FIX-008) — the design pass, on the bench.
 *
 * Operator, 2026-08-07: "Add a filter strip / ribbon in Team view … that
 * with one click (or keyboard) lets one sort the active agents to the front
 * within each project. Right now I have to scroll and scan to see what I
 * was working on."
 *
 * This study renders the REAL Team altitude (`ExposeOverlay`) over a fixture
 * fleet, with a candidate order strip above it. Switching a chip re-feeds
 * the overlay the same Projects with their tabs in that mode's view order
 * (`orderTeamTabs` — pure, tested, stable, never written back), so the
 * operator judges the actual surface reordering, not a mock of one.
 *
 * The open questions this bench exists to answer stay open here: whether
 * ordering is a view mode or a transient filter, what "active" means, and
 * where the strip lives in production chrome. The chips are candidates, not
 * shipped vocabulary.
 */
import { useMemo, useState } from 'react';
import { ExposeOverlay } from '@/components/workspace/expose-overlay';
import type {
  Project,
  WorkspaceTab,
} from '@/components/workspace/use-workspace-state';
import {
  orderTeamTabs,
  TEAM_ORDER_MODES,
  type TeamOrderMode,
} from '@/components/workspace/team-order';
import type { SessionAttentionSignal } from '@/components/workspace/session-status';
import { WORKSPACE_HUD as HUD, withThemeAlpha } from '@/components/workspace/workspace-theme';

/** A believable ten-agent fleet across three Projects: working, needs-you,
 *  idle, and stopped Agents interleaved in MANUAL order, so "I have to
 *  scroll and scan" is reproduced before a chip is pressed. */
const tab = (
  id: string,
  title: string,
  over: Partial<WorkspaceTab> = {}
): WorkspaceTab =>
  ({
    id,
    durableSessionId: `durable-${id}`,
    sessionId: `session-${id}`,
    harness: 'claude',
    title,
    titleKind: 'operator',
    cwd: '/workspace',
    resumeState: 'live',
    lifecycle: 'running',
    exitCode: null,
    harnessSessionId: null,
    initialTask: null,
    startedAt: 1_722_000_000_000,
    roadmapItemId: null,
    ...over,
  }) as WorkspaceTab;

const FLEET: Project[] = [
  {
    dir: '/workspace/exawatt',
    name: 'exawatt',
    color: '#19E6FF',
    activeTabId: 'exa-1',
    tabs: [
      tab('exa-1', 'Ship the launcher redraw'),
      tab('exa-2', 'Fix Sessions rendering', { harness: 'codex' }),
      tab('exa-3', 'Define the durable session', {
        resumeState: 'ended-resumable',
        sessionId: null,
        lifecycle: 'stopped-clean',
        harnessSessionId: 'prov-exa-3',
      }),
      tab('exa-4', 'Review keyboard navigation'),
      tab('exa-5', 'Design clear subagent rails', { harness: 'codex' }),
    ],
  },
  {
    dir: '/workspace/stock',
    name: 'Stock',
    color: '#FFB86B',
    activeTabId: 'stock-1',
    tabs: [
      tab('stock-1', 'Backtest the rebalance rule'),
      tab('stock-2', 'Wire the earnings feed', {
        resumeState: 'ended-resumable',
        sessionId: null,
        lifecycle: 'stopped-clean',
        harnessSessionId: 'prov-stock-2',
      }),
      tab('stock-3', 'Chart drawdown bands'),
    ],
  },
  {
    dir: '/workspace/photo-generator',
    name: 'photo-generator',
    color: '#B084FF',
    activeTabId: 'photo-1',
    tabs: [
      tab('photo-1', 'Tune the upscaler pass'),
      tab('photo-2', 'Batch the export queue', { harness: 'codex' }),
    ],
  },
];

/** exa-2, stock-3, photo-1 working; exa-4, stock-1 waiting on the operator —
 *  deliberately NOT at the front of their Projects in manual order. */
const ACTIVITY: Record<string, boolean> = {
  'session-exa-2': true,
  'session-stock-3': true,
  'session-photo-1': true,
};
const ATTENTION: Record<string, SessionAttentionSignal> = {
  'session-exa-4': { kind: 'bell', since: 1_722_000_100_000 },
  'session-stock-1': { kind: 'bell', since: 1_722_000_200_000 },
};
const SUMMARIES: Record<string, string> = {
  'durable-exa-2': 'Repainting the Sessions grid from live tile geometry',
  'durable-exa-4': 'Two migration paths found — needs a call on which',
  'durable-stock-1': 'Backtest done; asking before writing results',
  'durable-stock-3': 'Rendering drawdown bands against the 2024 window',
  'durable-photo-1': 'Sweeping sharpen radius against the eval set',
};

export function TeamOrderStudy() {
  const [mode, setMode] = useState<TeamOrderMode>('active-first');
  const signals = useMemo(
    () => ({ activity: ACTIVITY, attention: ATTENTION }),
    []
  );
  const projects = useMemo(
    () =>
      FLEET.map(project => ({
        ...project,
        tabs: orderTeamTabs(project.tabs, mode, signals),
      })),
    [mode, signals]
  );

  return (
    <section data-team-order-study className="flex flex-col gap-4">
      {/* the candidate strip: one click per order, keyboard-reachable */}
      <div
        role="radiogroup"
        aria-label="Team order"
        className="flex flex-wrap items-center gap-2"
      >
        {TEAM_ORDER_MODES.map(candidate => {
          const selected = candidate.id === mode;
          return (
            <button
              key={candidate.id}
              type="button"
              role="radio"
              aria-checked={selected}
              data-team-order-mode={candidate.id}
              onClick={() => setMode(candidate.id)}
              title={candidate.meaning}
              className="inline-flex min-h-9 items-center gap-2 rounded-md border px-3 font-mono text-chrome-label outline-none transition-colors focus-visible:ring-1 focus-visible:ring-hud-cyan"
              style={{
                borderColor: selected
                  ? withThemeAlpha(HUD.cyan, 0.5)
                  : withThemeAlpha(HUD.textDim, 0.18),
                background: selected
                  ? withThemeAlpha(HUD.cyan, 0.08)
                  : 'transparent',
                color: selected ? HUD.cyan : HUD.textDim,
              }}
            >
              {candidate.label}
            </button>
          );
        })}
        <p
          className="ml-1 font-mono text-chrome-meta"
          style={{ color: HUD.textDim }}
        >
          {TEAM_ORDER_MODES.find(candidate => candidate.id === mode)?.meaning}
        </p>
      </div>

      {/* the real Team altitude over the fixture fleet */}
      <div
        className="relative overflow-hidden rounded-lg border"
        style={{
          borderColor: withThemeAlpha(HUD.textDim, 0.16),
          height: '640px',
        }}
      >
        <ExposeOverlay
          projects={projects}
          summaries={SUMMARIES}
          attention={ATTENTION}
          activity={ACTIVITY}
          activeTabId="exa-1"
          onPick={() => undefined}
          onClose={() => undefined}
        />
      </div>
    </section>
  );
}
