import { describe, expect, it } from 'vitest';
import type { GoalVisual, PtyAttention } from '@exawatt/core/desktop-bridge';
import { ptySessionInfo } from '@/test-support/desktop-bridge-double';
import {
  persistedContextSummaries,
  persistedGoalVisualRefs,
  restoreLayout,
  resumeIdentityHints,
  seedSessionStores,
  unresolvedGoalVisual,
  withReconciledIdentities,
} from './layout-restore';
import type {
  PersistedRemoteAgentTab,
  PersistedSessionTab,
  PersistedV7,
} from './persisted-layout';
import type { SessionTab, WorkspaceTab } from './workspace-model';

const REPO = '/repo/exawatt';

function savedTab(
  id: string,
  overrides: Partial<PersistedSessionTab> = {}
): PersistedSessionTab {
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
    roadmapItemId: null,
    lifecycle: 'running',
    exitCode: null,
    ...overrides,
  };
}

const remoteTab: PersistedRemoteAgentTab = {
  kind: 'remote-agent',
  id: 'tab-remote',
  title: 'Scout',
  sourceId: 'source-1',
  nativeAgentId: 'scout',
  agentId: 'agent-scout',
  projectLabel: 'Exawatt',
};

function layout(
  tabs: PersistedV7['projects'][number]['tabs'],
  overrides: Partial<PersistedV7> = {}
): PersistedV7 {
  return {
    v: 7,
    lastUsedDir: REPO,
    activeDir: REPO,
    projects: [
      {
        dir: REPO,
        name: 'exawatt',
        color: '#111111',
        activeTabId: tabs[0]?.id ?? null,
        tabs,
      },
    ],
    ...overrides,
  };
}

const quietRestart = {
  observedIdentities: new Map<string, string>(),
  previousRunInterrupted: false,
};

function sessionTabs(tabs: WorkspaceTab[]): SessionTab[] {
  return tabs.filter((tab): tab is SessionTab => tab.kind === 'session');
}

describe('restoreLayout', () => {
  it('re-adopts a saved tab whose process is still live, and claims it', () => {
    const live = ptySessionInfo({
      id: 'pty-new-incarnation',
      durableSessionId: 'durable-a',
      harnessSessionId: 'conversation-a',
    });
    const { restored, unclaimed } = restoreLayout(
      layout([savedTab('a')]),
      [live],
      quietRestart
    );
    expect(sessionTabs(restored!.projects[0].tabs)[0]).toMatchObject({
      sessionId: 'pty-new-incarnation',
      lifecycle: 'running',
      resumeState: 'live',
      exitSignal: null,
    });
    expect(unclaimed).toEqual([]);
  });

  it('rebuilds a tab whose process ended while the renderer was away from main’s record of that exit', () => {
    const exited = ptySessionInfo({
      durableSessionId: 'durable-a',
      exited: true,
      exitCode: 137,
      exitSignal: 'SIGKILL',
      harnessSessionId: null,
    });
    const { restored } = restoreLayout(
      layout([savedTab('a', { exitSignal: 'SIGTERM' })]),
      [exited],
      quietRestart
    );
    expect(sessionTabs(restored!.projects[0].tabs)[0]).toMatchObject({
      sessionId: null,
      lifecycle: 'exited',
      exitCode: 137,
      exitSignal: 'SIGKILL',
      // the saved conversation identity still makes it resumable
      resumeState: 'ended-resumable',
    });
  });

  it('never spawns on restart, and says whether the last run ended cleanly', () => {
    for (const previousRunInterrupted of [false, true]) {
      const { restored } = restoreLayout(
        layout([
          savedTab('running'),
          savedTab('resuming', { lifecycle: 'resuming' }),
          savedTab('failed', { lifecycle: 'failed', sessionId: null }),
        ]),
        [],
        { ...quietRestart, previousRunInterrupted }
      );
      const tabs = sessionTabs(restored!.projects[0].tabs);
      expect(tabs.map(tab => tab.sessionId)).toEqual([null, null, null]);
      const ended = previousRunInterrupted ? 'interrupted' : 'stopped-clean';
      expect(tabs.map(tab => tab.lifecycle)).toEqual([ended, ended, 'failed']);
    }
  });

  it('takes an identity main announced before the tab was committed', () => {
    const { restored } = restoreLayout(
      layout([savedTab('a', { harnessSessionId: null })]),
      [],
      {
        ...quietRestart,
        observedIdentities: new Map([['durable-a', 'late-conversation']]),
      }
    );
    expect(sessionTabs(restored!.projects[0].tabs)[0]).toMatchObject({
      harnessSessionId: 'late-conversation',
      resumeState: 'ended-resumable',
    });
  });

  it('restores a draft as a composer, dropping launch choices it cannot trust', () => {
    const { restored } = restoreLayout(
      layout([
        savedTab('draft', {
          lifecycle: 'draft',
          sessionId: null,
          harnessSessionId: null,
          draftTask: 'Half-written brief',
          draftSource: 'not-a-source',
          draftModel: 'model with spaces',
          draftEffort: 'high',
          draftTouched: true,
          draftBranch: 'feature/x',
        }),
      ]),
      [],
      quietRestart
    );
    expect(sessionTabs(restored!.projects[0].tabs)[0]).toMatchObject({
      lifecycle: 'draft',
      resumeState: 'identity-missing',
      sessionId: null,
      draftTask: 'Half-written brief',
      draftSource: null,
      draftModel: null,
      draftEffort: 'high',
      draftTouched: true,
      draftWorktree: false,
      draftBranch: 'feature/x',
      draftRoadmapItemId: null,
    });
  });

  it('keeps draft fields off a tab that is not a draft', () => {
    const { restored } = restoreLayout(
      layout([savedTab('a', { draftTask: 'stale', draftTouched: true })]),
      [],
      quietRestart
    );
    const [tab] = sessionTabs(restored!.projects[0].tabs);
    expect(tab).not.toHaveProperty('draftTask');
    expect(tab).not.toHaveProperty('draftTouched');
  });

  it('repairs a position that names nothing instead of blanking the pane', () => {
    const saved = layout([savedTab('a'), savedTab('b')], {
      activeDir: null,
      pinnedTabId: 'tab-gone',
    });
    saved.projects[0].activeTabId = 'tab-gone';
    const { restored } = restoreLayout(saved, [], quietRestart);
    expect(restored!.projects[0].activeTabId).toBe('tab-a');
    expect(restored!.activeDir).toBe(REPO);
    expect(restored!.pinnedTabId).toBeNull();
  });

  it('keeps a pin whose tab still exists', () => {
    const { restored } = restoreLayout(
      layout([savedTab('a'), savedTab('b')], { pinnedTabId: 'tab-b' }),
      [],
      quietRestart
    );
    expect(restored!.pinnedTabId).toBe('tab-b');
  });

  it('gives every uncoloured Project its own colour', () => {
    const saved = layout([]);
    saved.projects = ['/a', '/b', '/c'].map(dir => ({
      dir,
      name: dir,
      activeTabId: null,
      tabs: [],
    }));
    const { restored } = restoreLayout(saved, [], quietRestart);
    const colors = restored!.projects.map(project => project.color);
    expect(new Set(colors).size).toBe(3);
  });

  it('restores a coworker as identity only', () => {
    const { restored } = restoreLayout(layout([remoteTab]), [], quietRestart);
    expect(restored!.projects[0].tabs[0]).toEqual(remoteTab);
  });

  it('hands back unclaimed incarnations in main’s order', () => {
    const live = ['x', 'a', 'y'].map(id =>
      ptySessionInfo({ id: `pty-${id}`, durableSessionId: `durable-${id}` })
    );
    const { unclaimed } = restoreLayout(
      layout([savedTab('a')]),
      live,
      quietRestart
    );
    expect(unclaimed.map(session => session.durableSessionId)).toEqual([
      'durable-x',
      'durable-y',
    ]);
  });

  it('restores nothing, and adopts everything live, when no layout was saved', () => {
    const live = [ptySessionInfo({ durableSessionId: 'durable-fresh' })];
    expect(restoreLayout(null, live, quietRestart)).toEqual({
      restored: null,
      unclaimed: live,
    });
  });

  it('reads a corrupt recency record as empty rather than failing', () => {
    const saved = layout([], {
      recentProjects: [
        null,
        { dir: 42 },
        { dir: '/kept', name: 'kept', lastOpenedAt: 1 },
      ] as unknown as PersistedV7['recentProjects'],
    });
    const { restored } = restoreLayout(saved, [], quietRestart);
    expect(restored!.recentProjects.map(recent => recent.dir)).toEqual([
      '/kept',
    ]);
  });
});

describe('seedSessionStores', () => {
  const attention: PtyAttention = { kind: 'turn-end', since: 1 };

  it('lets live truth override the saved goal, and skips a goal main refused', () => {
    const seeds = seedSessionStores(
      [
        ptySessionInfo({
          durableSessionId: 'durable-a',
          contextSummary: 'live',
        }),
      ],
      {
        summaries: [
          ['durable-a', 'saved'],
          ['durable-b', 'kept'],
          ['durable-c', null],
        ],
        goalVisuals: [],
      },
      { attentionCleared: new Set(), quiet: new Set(), settled: new Set() }
    );
    expect(seeds.summaries).toEqual({
      'durable-a': 'live',
      'durable-b': 'kept',
    });
  });

  it('does not let a stale snapshot resurrect state an event already cleared', () => {
    const live = ptySessionInfo({
      id: 'pty-a',
      attention,
      working: true,
      engaged: true,
      delegation: {
        ownTurn: 'generating',
        blockedOn: null,
        children: [],
      },
    });
    const raced = new Set(['pty-a']);
    const seeds = seedSessionStores(
      [live],
      { summaries: [], goalVisuals: [] },
      { attentionCleared: raced, quiet: raced, settled: raced }
    );
    expect(seeds.attention).toEqual({});
    expect(seeds.activity).toEqual({});
    expect(seeds.delegation).toEqual({});
    // Engagement never un-happens, so no event can race it.
    expect(seeds.engaged).toEqual({ 'pty-a': true });
  });
});

describe('resume identity reconciliation', () => {
  const saved = layout([
    savedTab('agent', { harnessSessionId: null }),
    savedTab('shell', { harness: 'shell', title: 'Shell' }),
    savedTab('draft', { lifecycle: 'draft' }),
    remoteTab,
  ]);

  it('asks main only about Agent tabs that can have a provider conversation', () => {
    expect(resumeIdentityHints(saved)).toEqual([
      {
        durableSessionId: 'durable-agent',
        harness: 'claude',
        cwd: REPO,
        initialTask: null,
        harnessSessionId: null,
      },
    ]);
  });

  it('adopts what main recovered and leaves every other tab as it was', () => {
    const next = withReconciledIdentities(saved, [
      {
        durableSessionId: 'durable-agent',
        harness: 'claude',
        cwd: REPO,
        harnessSessionId: 'recovered',
        source: 'durable-index',
      },
    ]);
    const tabs = next.projects[0].tabs;
    expect(tabs[0]).toMatchObject({ harnessSessionId: 'recovered' });
    expect(tabs.slice(1)).toEqual(saved.projects[0].tabs.slice(1));
  });
});

describe('persisted goals', () => {
  const visual: GoalVisual = {
    identityKey: 'identity-a',
    revision: 2,
    state: 'ready',
    dataUrl: 'data:image/jpeg;base64,AAAA',
  };
  const saved = layout([
    savedTab('a', {
      contextSummary: 'Ship the split',
      goalVisual: { identityKey: 'identity-a', revision: 2, state: 'ready' },
    }),
    savedTab('b'),
    remoteTab,
  ]);

  it('lists only the goals a Session tab carried', () => {
    expect(persistedContextSummaries(saved)).toEqual([
      ['durable-a', 'Ship the split'],
    ]);
    expect(persistedGoalVisualRefs(saved)).toEqual([
      ['durable-a', { identityKey: 'identity-a', revision: 2, state: 'ready' }],
    ]);
  });

  it('never presents an unresolved reference as a ready image', () => {
    const fallback = unresolvedGoalVisual({
      identityKey: visual.identityKey,
      revision: visual.revision,
      state: 'ready',
    });
    expect(fallback.state).toBe('fallback');
    expect(fallback.dataUrl).toBeNull();
  });
});
