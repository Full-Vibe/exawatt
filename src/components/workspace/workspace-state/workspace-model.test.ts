import { describe, expect, it } from 'vitest';
import type { ClosedSessionEntry } from '@exawatt/core/desktop-bridge';
import { ptySessionRecord } from '@/test-support/desktop-bridge-double';
import { HARNESS_META } from '../harnesses';
import {
  newDraftTab,
  runtimeAdoptionPatch,
  tabCanResumeAsAgent,
  tabFromClosedEntry,
  tabIsLive,
  type SessionTab,
} from './workspace-model';

function closedEntry(
  overrides: Partial<ClosedSessionEntry> = {}
): ClosedSessionEntry {
  return {
    durableSessionId: 'durable-closed',
    title: 'Claude Code',
    goal: null,
    harness: 'claude',
    cwd: '/repo',
    projectDir: '/repo',
    projectName: 'repo',
    harnessSessionId: 'conversation-1',
    initialTask: null,
    closedAt: 1,
    ...overrides,
  };
}

describe('newDraftTab', () => {
  it('is a composer with no process and nothing to resume', () => {
    const draft = newDraftTab('/repo', 'codex');
    expect(draft).toMatchObject({
      lifecycle: 'draft',
      cwd: '/repo',
      sessionId: null,
      harnessSessionId: null,
      draftSource: 'codex',
      draftTouched: false,
    });
    expect(tabIsLive(draft)).toBe(false);
    expect(tabCanResumeAsAgent(draft)).toBe(false);
  });

  it('mints a fresh tab and Session identity every time', () => {
    const [a, b] = [newDraftTab('/repo', null), newDraftTab('/repo', null)];
    expect(a.id).not.toBe(b.id);
    expect(a.durableSessionId).not.toBe(b.durableSessionId);
  });
});

describe('tabFromClosedEntry', () => {
  it('reopens as a stopped tab that keeps its identity and never a process', () => {
    const tab = tabFromClosedEntry(
      closedEntry({ initialTask: 'Ship it' }),
      'tab-1'
    );
    expect(tab).toMatchObject({
      id: 'tab-1',
      durableSessionId: 'durable-closed',
      sessionId: null,
      lifecycle: 'stopped-clean',
      resumeState: 'ended-resumable',
      harnessSessionId: 'conversation-1',
      initialTask: 'Ship it',
    });
    expect(tabCanResumeAsAgent(tab)).toBe(true);
  });

  it('an Agent without a provider identity must be reconnected; a shell need not', () => {
    expect(
      tabFromClosedEntry(closedEntry({ harnessSessionId: null }), 't')
        .resumeState
    ).toBe('identity-missing');
    expect(
      tabFromClosedEntry(
        closedEntry({
          harness: 'shell',
          title: 'Shell',
          harnessSessionId: null,
        }),
        't'
      ).resumeState
    ).toBe('ended-resumable');
  });

  it('keeps an explicit title owner, and infers one for older entries', () => {
    expect(
      tabFromClosedEntry(
        closedEntry({ title: 'Claude Code', titleKind: 'operator' }),
        't'
      ).titleKind
    ).toBe('operator');
    expect(
      tabFromClosedEntry(closedEntry({ title: 'Release train' }), 't').titleKind
    ).toBe('operator');
    expect(
      tabFromClosedEntry(closedEntry({ title: HARNESS_META.claude.label }), 't')
        .titleKind
    ).toBe('default');
  });

  it('repairs the D31 catalog-prompt title leak on an entry that predates title ownership', () => {
    const leaked = tabFromClosedEntry(
      closedEntry({
        title: 'please look at the failing build and fix the flaky…',
        initialTask: 'please look at the failing build',
        goal: 'Fixing the build',
      }),
      't'
    );
    expect(leaked).toMatchObject({
      title: HARNESS_META.claude.label,
      titleKind: 'default',
    });
  });
});

describe('runtimeAdoptionPatch', () => {
  const retained: SessionTab = {
    kind: 'session',
    id: 'tab-1',
    durableSessionId: 'durable-1',
    harness: 'claude',
    title: 'Claude Code',
    titleKind: 'default',
    cwd: '/repo',
    sessionId: null,
    harnessSessionId: 'conversation-1',
    resumeState: 'resuming',
    lifecycle: 'resuming',
    exitCode: null,
    roadmapItemId: null,
    initialTask: null,
  };

  it('a replacement that answers live resumes the retained conversation', () => {
    expect(
      runtimeAdoptionPatch(
        retained,
        ptySessionRecord({ id: 'pty-2', harnessSessionId: null }),
        undefined
      )
    ).toMatchObject({
      sessionId: 'pty-2',
      lifecycle: 'running',
      resumeState: 'resumed',
      harnessSessionId: 'conversation-1',
      exitCode: null,
      exitSignal: null,
    });
  });

  it('an exit that beat the reply wins over the reply', () => {
    expect(
      runtimeAdoptionPatch(
        retained,
        ptySessionRecord({ id: 'pty-2', exited: false }),
        { exitCode: 7, exitSignal: 'SIGTERM' }
      )
    ).toMatchObject({
      sessionId: null,
      lifecycle: 'exited',
      resumeState: 'ended-resumable',
      exitCode: 7,
      exitSignal: 'SIGTERM',
    });
  });

  it('a fresh start with no identity anywhere is live, not resumed', () => {
    expect(
      runtimeAdoptionPatch(
        { ...retained, harnessSessionId: null },
        ptySessionRecord({ harnessSessionId: null }),
        undefined
      ).resumeState
    ).toBe('live');
  });
});
