/**
 * One Session, one vocabulary (ENG-015 S6.4).
 *
 * A paused Agent used to speak four vocabularies at once: "Exited" on its
 * tab, "paused" in the recovery bar, "Stopped · Resume This Agent" in its
 * pane, "PAUSED" in its record, and a fifth lowercase word on its Team
 * tile. This test renders the same Session through every one of those
 * surfaces and pins that each prints the word, the line, and the verb the
 * shared owner in `@exawatt/ui-model` hands out. It derives every
 * expectation from that owner, so a deliberate change to the words moves
 * the product and the test together; only a surface growing its own copy
 * fails it.
 */
import type { ReactElement, ReactNode } from 'react';
import {
  fireEvent,
  render as testingRender,
  screen,
  waitFor,
} from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  pausedAgentsCopy,
  SESSION_LIFECYCLE_VERB_LABEL,
  SESSION_RESUME_SCOPE_LABEL,
  sessionLifecyclePresentation,
} from '@exawatt/ui-model';
import { TooltipProvider } from '@/components/ui/tooltip';
import { GoalVisualPreferenceProvider } from '@/components/goal-visuals/goal-visual-preference-provider';
import { ExposeOverlay } from './expose-overlay';
import { PausedAgentRecord } from './paused-agent-record';
import { ResumeRecoveryBar } from './resume-recovery-bar';
import { SessionRestorePanel } from './session-restore-panel';
import {
  fleetAttention,
  mergeFleetAttention,
  NO_FLEET_ATTENTION,
} from './session-status';
import { TabStrip } from './tab-strip';
import type { Project, SessionTab } from './use-workspace-state';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

vi.mock('@/lib/goal-visuals/preference-source', () => ({
  createGoalVisualPreferenceSource: () => ({
    kind: 'web' as const,
    load: () => new Promise<boolean>(() => undefined),
    save: async (enabled: boolean) => enabled,
    subscribe: () => () => undefined,
  }),
}));

function render(ui: ReactElement) {
  return testingRender(ui, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <GoalVisualPreferenceProvider>
        <TooltipProvider>{children}</TooltipProvider>
      </GoalVisualPreferenceProvider>
    ),
  });
}

/** One Agent whose process ended cleanly with its conversation recorded:
 *  the case the operator meets after every relaunch. */
const paused: SessionTab = {
  id: 'tab-p',
  kind: 'session',
  durableSessionId: 'durable-p',
  harness: 'claude',
  title: 'billing migration',
  titleKind: 'operator',
  cwd: '/repo',
  sessionId: null,
  harnessSessionId: 'provider-p',
  resumeState: 'ended-resumable',
  lifecycle: 'exited',
  exitCode: 0,
  roadmapItemId: null,
  initialTask: 'Migrate billing to usage-based',
};

const project: Project = {
  dir: '/repo',
  name: 'repo',
  color: '#19E6FF',
  activeTabId: paused.id,
  tabs: [paused],
};

const expected = sessionLifecyclePresentation(paused);

describe('one Session, one lifecycle vocabulary', () => {
  it('the tab strip prints the shared word and offers the shared verb', () => {
    const { container } = render(
      <TabStrip
        projects={[project]}
        activeDir="/repo"
        pinnedTabId={null}
        summaries={{}}
        attention={mergeFleetAttention(fleetAttention('pty', {}))}
        activity={{}}
        engaged={{}}
        delegation={{}}
        feedbackEnabled={false}
        onTogglePinTab={vi.fn()}
        onResumeTab={vi.fn()}
        onSelectProject={vi.fn()}
        onSelectTab={vi.fn()}
        onCloseTab={vi.fn()}
        onRenameTab={vi.fn()}
        onRenameProject={vi.fn()}
        onSetProjectColor={vi.fn()}
      />
    );
    expect(
      container.querySelector('[data-tab-lifecycle-word]')
    ).toHaveTextContent(expected.word);
    fireEvent.contextMenu(container.querySelector('[data-tab-id="tab-p"]')!);
    expect(screen.getByRole('menu').textContent).toContain(
      SESSION_LIFECYCLE_VERB_LABEL[expected.verb!]
    );
  });

  it('the recovery bar counts the same noun and scopes the same verb', () => {
    render(
      <ResumeRecoveryBar
        readyAgentCount={1}
        reconnectableAgentCount={0}
        activeProjectName="repo"
        activeProjectReadyCount={1}
        activeTabCanResume
        progress={null}
        onResumeActiveTab={vi.fn()}
        onResumeActiveProject={vi.fn()}
        onResumeAll={vi.fn()}
        onDismiss={vi.fn()}
      />
    );
    const status = screen.getByRole('status').textContent ?? '';
    expect(status).toContain(pausedAgentsCopy(1));
    expect(status.toLowerCase()).toContain(expected.word.toLowerCase());
    expect(
      screen.getByRole('button', { name: /^Resume 1 Agent in repo$/ })
    ).toHaveTextContent(SESSION_RESUME_SCOPE_LABEL.project);
  });

  it('the pane prints the shared word, line and verb', () => {
    render(<SessionRestorePanel tab={paused} onResumeTab={vi.fn()} />);
    expect(
      document.querySelector('[data-session-lifecycle-word]')
    ).toHaveTextContent(expected.word);
    expect(
      document.querySelector('[data-session-lifecycle-line]')
    ).toHaveTextContent(expected.line!);
    expect(
      screen.getByRole('button', {
        name: SESSION_LIFECYCLE_VERB_LABEL[expected.verb!],
      })
    ).toBeVisible();
  });

  it('the record names the state with the shared word', async () => {
    render(
      <PausedAgentRecord
        tab={paused}
        bridge={{
          retainedHistoryMeta: async () => ({
            bytes: 10,
            updatedAt: 1,
            exists: true,
          }),
          retainedTranscript: async () => ({
            lines: [],
            truncated: 0,
            corrupt: false,
          }),
        }}
      />
    );
    await waitFor(() =>
      expect(
        document.querySelector('[data-paused-agent-word]')
      ).toHaveTextContent(expected.word)
    );
  });

  it('the Team tile prints the shared word and the shared line', () => {
    render(
      <ExposeOverlay
        projects={[project]}
        summaries={{}}
        attention={NO_FLEET_ATTENTION}
        activeTabId={paused.id}
        onPick={vi.fn()}
        onClose={vi.fn()}
      />
    );
    const tile = document.querySelector('[data-expose-tile]')!;
    expect(tile.getAttribute('aria-label')).toContain(`, ${expected.word}`);
    expect(tile.querySelector('[data-expose-state]')).toHaveAttribute(
      'data-expose-state',
      expected.word
    );
    expect(tile.querySelector('[data-session-current]')).toHaveTextContent(
      expected.line!
    );
  });
});
