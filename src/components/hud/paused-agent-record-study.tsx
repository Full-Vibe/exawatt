'use client';

/**
 * Paused-Agent record rig (ENG-016 BUG-012/BUG-013).
 *
 * Renders the production `PausedAgentRecord` across the states a paused
 * Agent actually reaches, against a stubbed IPC so the page is deterministic
 * and needs no Electron. `eval:workspace:paused` drives this.
 *
 * The states matter more than the pixels here: the surface exists because
 * the operator saw "jumbled, unreadable text", so what has to be reviewable
 * is that every ending SAYS what happened.
 */
import {
  PausedAgentRecord,
  type PausedHistoryBridge,
} from '@/components/workspace/paused-agent-record';
import type { SessionTab } from '@/components/workspace/use-workspace-state';
import {
  WORKSPACE_HUD as HUD,
  withThemeAlpha,
} from '@/components/workspace/workspace-theme';

const TRANSCRIPT = [
  '$ pnpm test:run',
  ' Test Files  255 passed | 1 skipped (256)',
  '      Tests  2245 passed | 1 skipped (2246)',
  '',
  '● Compacted the conversation and resumed the roadmap pass.',
  'Reading docs/engineering/roadmap.md',
  'Edited src/components/workspace/paused-agent-record.tsx',
];

/**
 * A plain object, not a fake `window.electron`. Installing a PARTIAL bridge
 * on the global made a browser look like Electron, and the app shell's own
 * `pty.list` then threw on every page load — the rig broke the page it was
 * meant to review.
 */
const BRIDGE: PausedHistoryBridge = {
  retainedHistoryMeta: async id =>
    id === 'durable-empty'
      ? { bytes: 0, updatedAt: 0, exists: false }
      : {
          bytes: 1_493_172,
          updatedAt: Date.now() - 3 * 60 * 60 * 1000,
          exists: true,
        },
  retainedTranscript: async () => ({
    lines: TRANSCRIPT,
    truncated: 1_284,
    corrupt: false,
  }),
};

const tab = (over: Partial<SessionTab>): SessionTab =>
  ({
    id: 't',
    durableSessionId: 'durable-1',
    sessionId: null,
    harness: 'claude',
    title: 'Alpha',
    titleKind: 'operator',
    cwd: '/workspace/exawatt',
    harnessSessionId: 'prov-1',
    resumeState: 'ended-resumable',
    lifecycle: 'stopped-clean',
    exitCode: null,
    initialTask: 'Improve Exawatt codebase and UI holistically',
    startedAt: Date.now() - 4 * 60 * 60 * 1000,
    roadmapItemId: null,
    ...over,
  }) as SessionTab;

const CASES: Array<{ id: string; caption: string; tab: SessionTab; summary?: string }> =
  [
    {
      id: 'stopped-clean',
      caption: 'Stopped cleanly, with a task and a summary',
      tab: tab({}),
      summary: 'Landed the sort, then reviewed it and fixed three defects.',
    },
    {
      id: 'exited-nonzero',
      caption: 'Exited with a code. The ending is stated, not implied',
      tab: tab({ lifecycle: 'exited', exitCode: 137 }),
    },
    {
      id: 'interrupted',
      caption: 'Interrupted: the previous run did not shut down cleanly',
      tab: tab({ lifecycle: 'interrupted' }),
    },
    {
      id: 'no-task',
      caption: 'No task recorded. Says so rather than showing an empty pane',
      tab: tab({ initialTask: null }),
    },
    {
      id: 'nothing-saved',
      caption: 'Nothing saved: the transcript control is honestly disabled',
      tab: tab({ durableSessionId: 'durable-empty' }),
    },
  ];

export function PausedAgentRecordStudy() {
  return (
    <section data-paused-record-study className="flex flex-col gap-6">
      {CASES.map(item => (
        <figure key={item.id} data-paused-case={item.id} className="flex flex-col gap-2">
          <figcaption
            className="font-mono text-chrome-label"
            style={{ color: HUD.textDim }}
          >
            {item.caption}
          </figcaption>
          <div
            className="flex overflow-hidden rounded-lg border"
            style={{ borderColor: withThemeAlpha(HUD.textDim, 0.16), height: 280 }}
          >
            <PausedAgentRecord
              tab={item.tab}
              summary={item.summary}
              bridge={BRIDGE}
            />
          </div>
        </figure>
      ))}
    </section>
  );
}
