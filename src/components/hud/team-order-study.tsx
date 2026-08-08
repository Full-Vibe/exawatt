'use client';

/**
 * Team ordering rig (ENG-015 S6.3, FIX-008 — shipped 2026-08-07).
 *
 * The design pass ran here and the operator picked, in his vocabulary:
 * two named sorts. **Started** is the stored default (Chrome's model — a
 * new Agent appends); **Activity** leads each Project with its most recent
 * activity, fully live; needs-you-first does not exist. This page survives
 * as the deterministic REVIEW RIG for that shipped behaviour (the
 * ribbon-bench precedent): the real `ExposeOverlay` over a fixture fleet,
 * driven through its own production control, with `eval:workspace:team`
 * asserting order, glide, and persistence against it.
 *
 * The fixture is adversarial on purpose: creation times deliberately
 * disagree with manual order, and the working / needs-you Agents are buried
 * mid-Project, so both orders are observable and neither happens to equal
 * the array as written.
 */
import { ExposeOverlay } from '@/components/workspace/expose-overlay';
import type {
  Project,
  WorkspaceTab,
} from '@/components/workspace/use-workspace-state';
import type { SessionAttentionSignal } from '@/components/workspace/session-status';
import {
  WORKSPACE_HUD as HUD,
  withThemeAlpha,
} from '@/components/workspace/workspace-theme';

const T0 = 1_722_000_000_000;
const MIN = 60_000;

const tab = (
  id: string,
  title: string,
  startedAt: number,
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
    startedAt,
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
      // manual order ≠ creation order: exa-1 is the NEWEST despite being first
      tab('exa-1', 'Ship the launcher redraw', T0 + 9 * MIN),
      tab('exa-2', 'Fix Sessions rendering', T0 + 2 * MIN, {
        harness: 'codex',
      }),
      tab('exa-3', 'Define the durable session', T0 + 5 * MIN, {
        resumeState: 'ended-resumable',
        sessionId: null,
        lifecycle: 'stopped-clean',
        harnessSessionId: 'prov-exa-3',
      }),
      tab('exa-4', 'Review keyboard navigation', T0 + 1 * MIN),
      tab('exa-5', 'Design clear subagent rails', T0 + 7 * MIN, {
        harness: 'codex',
      }),
    ],
  },
  {
    dir: '/workspace/stock',
    name: 'Stock',
    color: '#FFB86B',
    activeTabId: 'stock-1',
    tabs: [
      tab('stock-1', 'Backtest the rebalance rule', T0 + 6 * MIN),
      tab('stock-2', 'Wire the earnings feed', T0 + 3 * MIN, {
        resumeState: 'ended-resumable',
        sessionId: null,
        lifecycle: 'stopped-clean',
        harnessSessionId: 'prov-stock-2',
      }),
      tab('stock-3', 'Chart drawdown bands', T0 + 4 * MIN),
    ],
  },
  {
    dir: '/workspace/photo-generator',
    name: 'photo-generator',
    color: '#B084FF',
    activeTabId: 'photo-1',
    tabs: [
      tab('photo-1', 'Tune the upscaler pass', T0 + 8 * MIN),
      tab('photo-2', 'Batch the export queue', T0 + 0 * MIN, {
        harness: 'codex',
      }),
    ],
  },
];

/** exa-2, stock-3, photo-1 working; exa-4, stock-1 waiting on the operator. */
const ACTIVITY: Record<string, boolean> = {
  'session-exa-2': true,
  'session-stock-3': true,
  'session-photo-1': true,
};
const ATTENTION: Record<string, SessionAttentionSignal> = {
  'session-exa-4': { kind: 'bell', since: T0 + 10 * MIN },
  'session-stock-1': { kind: 'bell', since: T0 + 11 * MIN },
};
const SUMMARIES: Record<string, string> = {
  'durable-exa-2': 'Repainting the Sessions grid from live tile geometry',
  'durable-exa-4': 'Two migration paths found — needs a call on which',
  'durable-stock-1': 'Backtest done; asking before writing results',
  'durable-stock-3': 'Rendering drawdown bands against the 2024 window',
  'durable-photo-1': 'Sweeping sharpen radius against the eval set',
};

export function TeamOrderStudy() {
  return (
    <section data-team-order-study className="flex flex-col gap-4">
      <div
        className="relative overflow-hidden rounded-lg border"
        style={{
          borderColor: withThemeAlpha(HUD.textDim, 0.16),
          height: '640px',
        }}
      >
        <ExposeOverlay
          projects={FLEET}
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
