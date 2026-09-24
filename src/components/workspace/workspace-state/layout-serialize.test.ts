import { describe, expect, it } from 'vitest';
import type { GoalVisual } from '@exawatt/core/desktop-bridge';
import { ptySessionRecord } from '@/test-support/desktop-bridge-double';
import {
  persistedGoalVisual,
  serializeLayout,
  shutdownTargets,
  withLiveHarnessIdentities,
  type SerializeContext,
} from './layout-serialize';
import { parsePersisted, type PersistedSessionTab } from './persisted-layout';
import { restoreLayout } from './layout-restore';
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

describe('withLiveHarnessIdentities', () => {
  it('adopts a conversation id main learned after the record was taken', () => {
    const saved = serializeLayout(
      workspace([
        tab('late', { harnessSessionId: null }),
        tab('known'),
        coworker,
      ]),
      context()
    );
    const next = withLiveHarnessIdentities(saved, [
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
