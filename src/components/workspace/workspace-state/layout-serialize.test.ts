import { describe, expect, it } from 'vitest';
import { projectSessionAttention } from '@exawatt/core';
import type { GoalVisual } from '@exawatt/core/desktop-bridge';
import { ptySessionRecord } from '@/test-support/desktop-bridge-double';
import {
  persistedGoalVisual,
  serializeLayout,
  shutdownTargets,
  withLiveSessionFacts,
  type SerializeContext,
} from './layout-serialize';
import { parsePersisted, type PersistedSessionTab } from './persisted-layout';
import { restoreLayout } from './layout-restore';
import { restartRecoveryTabs } from './workspace-model';
import type {
  Project,
  RemoteAgentTab,
  SessionTab,
  WorkspaceLayout,
} from './workspace-model';

const REPO = '/repo/exawatt';

function tab(id: string, overrides: Partial<SessionTab> = {}): SessionTab {
  return {
    kind: 'session',
    id: `tab-${id}`,
    durableSessionId: `durable-${id}`,
    harness: 'claude',
    title: 'Claude Code',
    titleKind: 'default',
    cwd: REPO,
    sessionId: `pty-${id}`,
    harnessSessionId: `conversation-${id}`,
    resumeState: 'live',
    lifecycle: 'running',
    exitCode: null,
    exitSignal: null,
    roadmapItemId: null,
    initialTask: null,
    ...overrides,
  };
}

const draft = (id: string, overrides: Partial<SessionTab> = {}) =>
  tab(id, {
    lifecycle: 'draft',
    resumeState: 'identity-missing',
    sessionId: null,
    harnessSessionId: null,
    draftTask: null,
    draftTouched: false,
    ...overrides,
  });

const coworker: RemoteAgentTab = {
  kind: 'remote-agent',
  id: 'tab-remote',
  title: 'Scout',
  sourceId: 'source-1',
  nativeAgentId: 'scout',
  agentId: 'agent-scout',
  projectLabel: 'Exawatt',
};

function workspace(
  tabs: Project['tabs'],
  overrides: Partial<WorkspaceLayout> = {}
): WorkspaceLayout {
  return {
    projects: [
      {
        dir: REPO,
        name: 'exawatt',
        color: '#111111',
        tabs,
        activeTabId: tabs[0]?.id ?? null,
      },
    ],
    activeDir: REPO,
    lastUsedDir: REPO,
    pinnedTabId: null,
    ...overrides,
  };
}

const context = (
  overrides: Partial<SerializeContext> = {}
): SerializeContext => ({
  recentProjects: [],
  summaries: {},
  goalVisuals: {},
  cleanShutdown: false,
  shutdownTargets: new Set(),
  ...overrides,
});

const sessionTabs = (tabs: unknown[]) => tabs as PersistedSessionTab[];

describe('serializeLayout', () => {
  it('writes a record the reader accepts and a restart restores tab for tab', () => {
    const saved = serializeLayout(
      workspace([
        tab('a'),
        tab('b', { title: 'Renamed', titleKind: 'operator' }),
        coworker,
      ]),
      context({ summaries: { 'durable-a': 'Ship the split' } })
    );
    const { restored } = restoreLayout(parsePersisted(saved), [], {
      observedIdentities: new Map(),
      previousRunInterrupted: false,
    });
    expect(restored!.projects[0].tabs.map(t => [t.id, t.title])).toEqual([
      ['tab-a', 'Claude Code'],
      ['tab-b', 'Renamed'],
      ['tab-remote', 'Scout'],
    ]);
    expect(sessionTabs(saved.projects[0].tabs)[0].contextSummary).toBe(
      'Ship the split'
    );
  });

  it('lets an untouched draft vanish with the run, and keeps operator work', () => {
    const saved = serializeLayout(
      workspace([
        draft('empty'),
        draft('typed', { draftTask: 'Brief' }),
        draft('chosen', { draftTouched: true }),
      ]),
      context()
    );
    const tabs = saved.projects[0].tabs;
    expect(tabs.map(t => t.id)).toEqual(['tab-typed', 'tab-chosen']);
    // the Project's position moves off the draft that did not persist
    expect(saved.projects[0].activeTabId).toBe('tab-typed');
  });

  it('writes live and parked Sessions as cleanly stopped at a clean shutdown only', () => {
    const tabs = [
      tab('live'),
      tab('parked', {
        resumeState: 'ended-resumable',
        lifecycle: 'stopped-clean',
        sessionId: null,
      }),
      tab('exited', {
        resumeState: 'ended-resumable',
        lifecycle: 'exited',
        sessionId: null,
        exitCode: 1,
        exitSignal: 'SIGTERM',
      }),
    ];
    const parked = new Set(['durable-parked']);
    const clean = sessionTabs(
      serializeLayout(
        workspace(tabs),
        context({ cleanShutdown: true, shutdownTargets: parked })
      ).projects[0].tabs
    );
    expect(clean.map(t => [t.lifecycle, t.sessionId, t.exitSignal])).toEqual([
      ['stopped-clean', null, null],
      ['stopped-clean', null, null],
      ['exited', null, 'SIGTERM'],
    ]);
    const debounced = sessionTabs(
      serializeLayout(workspace(tabs), context({ shutdownTargets: parked }))
        .projects[0].tabs
    );
    expect(debounced[0]).toMatchObject({
      lifecycle: 'running',
      sessionId: 'pty-live',
    });
  });

  it('persists a goal visual as a reference once it is ready, never its pixels', () => {
    const ready: GoalVisual = {
      identityKey: 'identity-a',
      revision: 3,
      state: 'ready',
      dataUrl: 'data:image/jpeg;base64,AAAA',
    };
    const pending = { ...ready, state: 'generating' } as GoalVisual;
    const [a, b] = sessionTabs(
      serializeLayout(
        workspace([tab('a'), tab('b')]),
        context({ goalVisuals: { 'durable-a': ready, 'durable-b': pending } })
      ).projects[0].tabs
    );
    expect(a.goalVisual).toEqual({
      identityKey: 'identity-a',
      revision: 3,
      state: 'ready',
    });
    expect(JSON.stringify(a)).not.toContain('base64');
    expect(b.goalVisual).toBeNull();
    expect(persistedGoalVisual(undefined)).toBeNull();
  });

  it('keeps a pin only on a tab that can be pinned', () => {
    expect(
      serializeLayout(
        workspace([tab('a')], { pinnedTabId: 'tab-a' }),
        context()
      ).pinnedTabId
    ).toBe('tab-a');
    expect(
      serializeLayout(
        workspace([tab('a'), draft('d', { draftTask: 'x' })], {
          pinnedTabId: 'tab-d',
        }),
        context()
      ).pinnedTabId
    ).toBeNull();
  });

  it('writes a coworker as identity and nothing its source owns', () => {
    const saved = serializeLayout(
      workspace([{ ...coworker, transcript: 'secret' } as RemoteAgentTab]),
      context()
    );
    expect(saved.projects[0].tabs[0]).toEqual(coworker);
  });

  it('keeps an absent folder binding absent and a folderless one null', () => {
    const base = workspace([]);
    const saved = serializeLayout(
      {
        ...base,
        projects: [
          base.projects[0],
          { ...base.projects[0], dir: 'project-id', rootPath: null },
        ],
      },
      context()
    );
    expect(saved.projects[0]).not.toHaveProperty('rootPath');
    expect(saved.projects[1].rootPath).toBeNull();
  });
});

describe('shutdownTargets', () => {
  it('parks every Session with a process behind it, including a resume in flight', () => {
    const targets = shutdownTargets(
      workspace([
        tab('live'),
        tab('resumed', { resumeState: 'resumed' }),
        tab('resuming', {
          resumeState: 'resuming',
          lifecycle: 'resuming',
          sessionId: null,
        }),
        tab('stopped', {
          resumeState: 'ended-resumable',
          lifecycle: 'stopped-clean',
          sessionId: null,
        }),
        coworker,
      ]).projects
    );
    expect([...targets]).toEqual([
      'durable-live',
      'durable-resumed',
      'durable-resuming',
    ]);
  });
});

describe('withLiveSessionFacts', () => {
  it('adopts a conversation id main learned after the record was taken', () => {
    const saved = serializeLayout(
      workspace([
        tab('late', { harnessSessionId: null }),
        tab('known'),
        coworker,
      ]),
      context()
    );
    const next = withLiveSessionFacts(saved, [
      ptySessionRecord({
        durableSessionId: 'durable-late',
        harnessSessionId: 'learned',
      }),
      ptySessionRecord({
        durableSessionId: 'durable-known',
        harnessSessionId: null,
      }),
    ]);
    const tabs = sessionTabs(next.projects[0].tabs);
    expect(tabs[0].harnessSessionId).toBe('learned');
    expect(tabs[1].harnessSessionId).toBe('conversation-known');
    expect(next.projects[0].tabs[2]).toEqual(coworker);
  });
});

describe('restart recovery contract', () => {
  it('retains read requests, purpose and position, and admits only the running set', () => {
    const running = tab('running', { initialTask: 'Make updates safe' });
    const paused = tab('paused', {
      sessionId: null,
      lifecycle: 'stopped-clean',
      resumeState: 'ended-resumable',
    });
    const shell = tab('shell', { harness: 'shell' });
    const original = workspace([paused, running, shell], {
      pinnedTabId: paused.id,
    });
    original.projects[0].activeTabId = running.id;
    const attention = {
      kind: 'blocked' as const,
      since: 42,
      unread: false,
      request: 'blocking' as const,
      requestId: 'permission-7',
    };
    const save = serializeLayout(
      original,
      context({
        cleanShutdown: true,
        shutdownTargets: shutdownTargets(original.projects),
        attention: { [running.durableSessionId]: attention },
        summaries: {
          [running.durableSessionId]:
            'Install safely without losing your place',
        },
      })
    );
    const normalized = parsePersisted(save)!;
    const restored = restoreLayout(normalized, [], {
      observedIdentities: new Map(),
      previousRunInterrupted: false,
    }).restored!;
    expect(restored.projects[0].tabs.map(item => item.id)).toEqual(
      original.projects[0].tabs.map(item => item.id)
    );
    expect(restored.projects[0].activeTabId).toBe(running.id);
    expect(restored.pinnedTabId).toBe(paused.id);
    expect(
      restored.projects[0].tabs.every(
        item => item.kind === 'session' && item.sessionId === null
      )
    ).toBe(true);
    expect(
      restartRecoveryTabs(restored.projects).map(item => item.durableSessionId)
    ).toEqual([running.durableSessionId]);
    const savedRunning = sessionTabs(normalized.projects[0].tabs).find(
      item => item.id === running.id
    )!;
    expect(savedRunning.attention).toEqual(attention);
    expect(savedRunning.initialTask).toBe(running.initialTask);
    expect(savedRunning.contextSummary).toBe(
      'Install safely without losing your place'
    );
    // Dismissing the recovery notice or quitting again must not erase eligibility.
    const second = serializeLayout(
      restored,
      context({ attention: { [running.durableSessionId]: attention } })
    );
    expect(
      restartRecoveryTabs(
        restoreLayout(second, [], {
          observedIdentities: new Map(),
          previousRunInterrupted: false,
        }).restored!.projects
      ).map(item => item.id)
    ).toEqual([running.id]);
  });

  it('does not guess eligibility for legacy clean-paused Sessions', () => {
    const saved = serializeLayout(
      workspace([
        tab('legacy', {
          lifecycle: 'stopped-clean',
          sessionId: null,
          resumeState: 'ended-resumable',
        }),
      ]),
      context()
    );
    delete sessionTabs(saved.projects[0].tabs)[0].resumeAfterRestart;
    const restored = restoreLayout(parsePersisted(saved), [], {
      observedIdentities: new Map(),
      previousRunInterrupted: false,
    }).restored!;
    expect(restartRecoveryTabs(restored.projects)).toEqual([]);
  });

  it('recovers interrupted running Sessions without restoring running proof', () => {
    const saved = serializeLayout(workspace([tab('crashed')]), context());
    const restored = restoreLayout(saved, [], {
      observedIdentities: new Map(),
      previousRunInterrupted: true,
    }).restored!;
    expect(restartRecoveryTabs(restored.projects)).toHaveLength(1);
    expect(restored.projects[0].tabs[0]).toMatchObject({
      lifecycle: 'interrupted',
      sessionId: null,
    });
  });
});

it('checkpoints exact ended source snapshots, including resolution before exit', () => {
  const attention = { kind: 'blocked' as const, since: 1, unread: false };
  const saved = serializeLayout(
    workspace([tab('a')]),
    context({ attention: { 'durable-a': attention } })
  );
  const current = ptySessionRecord({ durableSessionId: 'durable-a' });
  const live = withLiveSessionFacts(saved, [{ ...current, attention: null }]);
  expect(sessionTabs(live.projects[0].tabs)[0].attention).toBeUndefined();
  const ended = withLiveSessionFacts(saved, [
    { ...current, exited: true, attention: null },
  ]);
  expect(sessionTabs(ended.projects[0].tabs)[0].attention).toBeUndefined();
  const pending = withLiveSessionFacts(saved, [
    { ...current, exited: true, attention },
  ]);
  expect(sessionTabs(pending.projects[0].tabs)[0].attention).toEqual(attention);
});

it('round-trips independent request receipts and an unread result together', () => {
  const attention = projectSessionAttention([
    {
      source: 'harness',
      kind: 'blocked',
      request: 'working',
      requestId: 'question-a',
      since: 1,
      unread: false,
    },
    {
      source: 'harness',
      kind: 'blocked',
      request: 'working',
      requestId: 'question-b',
      since: 2,
      unread: false,
    },
    { source: 'harness', kind: 'turn-end', since: 3, unread: true },
  ])!;
  const saved = serializeLayout(
    workspace([tab('a')]),
    context({ attention: { 'durable-a': attention } })
  );
  const decoded = parsePersisted(JSON.parse(JSON.stringify(saved)))!;
  expect(sessionTabs(decoded.projects[0].tabs)[0].attention).toEqual(attention);
});
