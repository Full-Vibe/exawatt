import { describe, expect, it } from 'vitest';
import {
  projectDeclaredLinks,
  projectRoadmapSessions,
} from './roadmap-lens-input';
import type { WorkspaceTab } from './use-workspace-state';

const tab = (over: Partial<WorkspaceTab>): WorkspaceTab =>
  ({
    id: 't1',
    durableSessionId: 'd1',
    sessionId: 's1',
    harness: 'claude',
    title: 'Alpha',
    titleKind: 'auto',
    cwd: '/p',
    resumeState: 'live',
    lifecycle: 'running',
    exitCode: null,
    harnessSessionId: null,
    initialTask: null,
    startedAt: 10,
    roadmapItemId: null,
    ...over,
  }) as WorkspaceTab;

const SOURCES = { activity: {}, engaged: {}, summaries: {}, delegation: {} };

describe('projectRoadmapSessions (one lens projection)', () => {
  it('projects only live tabs that have a session', () => {
    const rows = projectRoadmapSessions(
      [
        tab({}),
        tab({ id: 't2', sessionId: null }),
        tab({ id: 't3', resumeState: 'ended-resumable' }),
      ],
      {},
      SOURCES
    );
    expect(rows.map(r => r.tabId)).toEqual(['t1']);
  });

  it('rides the one attention rule: a finished turn is not needs-you', () => {
    const rows = projectRoadmapSessions(
      [tab({})],
      { s1: { kind: 'bell', since: 1 } },
      SOURCES
    );
    expect(rows[0].needsAttention).toBe(true);
    const done = projectRoadmapSessions(
      [tab({})],
      { s1: { kind: 'turn-end', since: 1 } },
      SOURCES
    );
    expect(done[0].needsAttention).toBe(false);
  });

  it('answers [] for an absent project', () => {
    expect(projectRoadmapSessions(undefined, {}, SOURCES)).toEqual([]);
  });
});

describe('projectDeclaredLinks', () => {
  it('links only live, declared tabs, at high declared confidence', () => {
    const links = projectDeclaredLinks(
      [
        tab({ roadmapItemId: 'ENG-015' }),
        tab({ id: 't2' }),
        tab({
          id: 't3',
          roadmapItemId: 'ENG-016',
          resumeState: 'ended-resumable',
        }),
      ],
      '/p'
    );
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({
      tabId: 't1',
      itemId: 'ENG-015',
      method: 'declared',
      confidence: 'high',
      projectDir: '/p',
    });
  });
});
