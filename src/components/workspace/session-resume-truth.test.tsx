/**
 * One predicate for "paused" (BUG-185, ENG-015 S6.4).
 *
 * The tab chose its word from how the process ended; every "paused" count
 * and resume verb chose its members by whether a conversation id was
 * recorded. One word, two tests, and a release review found both ways they
 * disagreed: after a crash the recovery bar said "4 Agents paused" over four
 * tabs that said Interrupted, and after a clean quit an Agent with no
 * recorded conversation said Paused while its resume chord answered "This
 * Agent is not paused".
 *
 * This walks every combination of the lifecycle facts a local Session
 * carries through the tab strip and the recovery bar, and fails if the word
 * a tab prints and the set the counts and verbs act on (`tabCanResumeAsAgent`,
 * which the bar, ⌘K, the chords and the resume batch all read) disagree for
 * any of them. Expectations come from the lifecycle owner, so a deliberate
 * change of words moves product and test together.
 */
import type { ReactElement, ReactNode } from 'react';
import { render as testingRender, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SESSION_LIFECYCLE_WORD } from '@exawatt/core';
import {
  resumableAgents,
  resumableAgentsNoun,
  SESSION_RESUME_UNAVAILABLE,
} from '@exawatt/ui-model';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ResumeRecoveryBar } from './resume-recovery-bar';
import { fleetAttention, mergeFleetAttention } from './session-status';
import { TabStrip } from './tab-strip';
import {
  tabCanResumeAsAgent,
  type Project,
  type ResumeState,
  type SessionLifecycle,
  type SessionTab,
} from './use-workspace-state';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

function render(ui: ReactElement) {
  return testingRender(ui, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <TooltipProvider>{children}</TooltipProvider>
    ),
  });
}

const PAUSED = SESSION_LIFECYCLE_WORD.paused;

const LIFECYCLES: SessionLifecycle[] = [
  'running',
  'resuming',
  'stopped-clean',
  'interrupted',
  'exited',
  'failed',
  'draft',
];

/** The resume state the workspace writes beside each lifecycle. */
function resumeStateFor(
  lifecycle: SessionLifecycle,
  identity: string | null
): ResumeState {
  if (lifecycle === 'running') return 'live';
  if (lifecycle === 'resuming') return 'resuming';
  if (lifecycle === 'failed') return 'failed';
  if (lifecycle === 'draft') return 'identity-missing';
  return identity ? 'ended-resumable' : 'identity-missing';
}

/** Every combination of the facts a local Session's lifecycle reads. */
function sessionSpace(): SessionTab[] {
  const tabs: SessionTab[] = [];
  for (const lifecycle of LIFECYCLES)
    for (const exitCode of [null, 0, 137])
      for (const exitSignal of [undefined, null, 'SIGKILL'])
        for (const harness of ['claude', 'codex', 'shell'] as const)
          for (const harnessSessionId of ['provider-1', null]) {
            const id = `tab-${tabs.length}`;
            tabs.push({
              kind: 'session',
              id,
              durableSessionId: `durable-${id}`,
              harness,
              title: id,
              titleKind: 'operator',
              cwd: '/repo',
              sessionId: lifecycle === 'running' ? `pty-${id}` : null,
              harnessSessionId,
              resumeState: resumeStateFor(lifecycle, harnessSessionId),
              lifecycle,
              exitCode: lifecycle === 'running' ? null : exitCode,
              ...(exitSignal === undefined ? {} : { exitSignal }),
              roadmapItemId: null,
              initialTask: null,
            });
          }
  return tabs;
}

const TABS = sessionSpace();

/** The word each tab's own chip prints, read from the rendered strip. */
function printedWords(tabs: SessionTab[]): Map<string, string | null> {
  const project: Project = {
    dir: '/repo',
    name: 'repo',
    color: '#19E6FF',
    activeTabId: tabs[0]?.id ?? null,
    tabs,
  };
  const { container, unmount } = render(
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
  const words = new Map<string, string | null>();
  for (const tab of tabs) {
    const chip = container.querySelector(`[data-tab-id="${tab.id}"]`);
    if (!chip) throw new Error(`the strip did not render ${tab.id}`);
    words.set(
      tab.id,
      chip.querySelector('[data-tab-lifecycle-word]')?.textContent ?? null
    );
  }
  unmount();
  return words;
}

const WORDS = printedWords(TABS);
const describeTab = (tab: SessionTab) =>
  JSON.stringify({
    lifecycle: tab.lifecycle,
    exitCode: tab.exitCode,
    exitSignal: tab.exitSignal,
    harness: tab.harness,
    harnessSessionId: tab.harnessSessionId,
    printed: WORDS.get(tab.id),
  });

/** The recovery bar's status line for exactly this counted set. */
function barStatus(members: SessionTab[]): string {
  const { unmount } = render(
    <ResumeRecoveryBar
      readyAgents={resumableAgents(members)}
      reconnectableAgentCount={0}
      activeProjectName="repo"
      activeProjectReadyCount={members.length}
      activeTabCanResume={false}
      progress={null}
      onResumeActiveTab={vi.fn()}
      onResumeActiveProject={vi.fn()}
      onResumeAll={vi.fn()}
      onDismiss={vi.fn()}
    />
  );
  const status = screen.getByRole('status').textContent ?? '';
  unmount();
  return status;
}

describe('the word Paused and the resume count are one derivation', () => {
  const counted = TABS.filter(tabCanResumeAsAgent);

  it('covers both sides of the question', () => {
    expect(counted.length).toBeGreaterThan(0);
    expect(TABS.some(tab => WORDS.get(tab.id) === PAUSED)).toBe(true);
    expect(
      counted.some(tab => WORDS.get(tab.id) !== PAUSED),
      'the space must hold resumable Agents that are not Paused'
    ).toBe(true);
  });

  it('never prints Paused on a Session the resume verbs skip', () => {
    for (const tab of TABS) {
      if (WORDS.get(tab.id) !== PAUSED) continue;
      expect(tabCanResumeAsAgent(tab), describeTab(tab)).toBe(true);
    }
  });

  it('counts only Sessions whose tab states a stopped word', () => {
    for (const tab of counted) {
      expect(WORDS.get(tab.id), describeTab(tab)).toMatch(/\S/);
    }
  });

  it('refuses resume only for a Session its tab does not call Paused', () => {
    // "This Agent is not paused" is what the chord announces for any target
    // the predicate rejects; it must be true of every such tab.
    expect(SESSION_RESUME_UNAVAILABLE.agent.toLowerCase()).toContain(
      PAUSED.toLowerCase()
    );
    for (const tab of TABS.filter(tab => !tabCanResumeAsAgent(tab))) {
      expect(WORDS.get(tab.id), describeTab(tab)).not.toBe(PAUSED);
    }
  });

  it('says paused only when every Agent it counts prints Paused', () => {
    const sets: SessionTab[][] = [
      counted,
      counted.filter(tab => WORDS.get(tab.id) === PAUSED),
      ...counted.map(tab => [tab]),
    ];
    for (const members of sets) {
      const status = barStatus(members).toLowerCase();
      const noun = resumableAgentsNoun(resumableAgents(members)).toLowerCase();
      const allPaused = members.every(tab => WORDS.get(tab.id) === PAUSED);
      const claimsPaused = status.includes(PAUSED.toLowerCase());
      expect(
        claimsPaused,
        `${status} over ${members.map(describeTab).join(', ')}`
      ).toBe(allPaused);
      expect(noun.includes(PAUSED.toLowerCase()), noun).toBe(allPaused);
      if (!allPaused) expect(status).toContain('to resume');
    }
  });

  it('reads the two cases the release review found honestly', () => {
    const interrupted = TABS.filter(
      tab =>
        tab.lifecycle === 'interrupted' &&
        tab.harness === 'claude' &&
        tab.harnessSessionId !== null &&
        tab.exitCode === null &&
        tab.exitSignal === undefined
    );
    // A: after a crash the count names the action, not a word no tab prints.
    expect(interrupted.every(tabCanResumeAsAgent)).toBe(true);
    expect(barStatus(interrupted)).toContain(
      `${interrupted.length} Agent${interrupted.length === 1 ? '' : 's'} to resume`
    );
    // B: a clean stop with no recorded conversation is not Paused, which is
    // what its resume chord already says.
    const unrecorded = TABS.find(
      tab =>
        tab.lifecycle === 'stopped-clean' &&
        tab.harness === 'claude' &&
        tab.harnessSessionId === null &&
        tab.exitCode === null &&
        tab.exitSignal === null
    )!;
    expect(tabCanResumeAsAgent(unrecorded)).toBe(false);
    expect(WORDS.get(unrecorded.id)).not.toBe(PAUSED);
    // And a signalled exit (BUG-186) never reads as a clean pause.
    const killed = TABS.find(
      tab =>
        tab.lifecycle === 'exited' &&
        tab.harness === 'claude' &&
        tab.harnessSessionId !== null &&
        tab.exitCode === 0 &&
        tab.exitSignal === 'SIGKILL'
    )!;
    expect(WORDS.get(killed.id)).not.toBe(PAUSED);
  });
});
