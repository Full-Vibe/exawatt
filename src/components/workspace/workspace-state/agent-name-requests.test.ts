import { describe, expect, it } from 'vitest';
import type { AgentNameRecord } from '@exawatt/core';

import { agentNameRequests } from './agent-name-requests';
import { newDraftTab, type Project, type SessionTab } from './workspace-model';

function tab(
  durableSessionId: string,
  harness: string,
  extra: Partial<SessionTab> = {}
): SessionTab {
  return {
    ...newDraftTab('/p', null),
    durableSessionId,
    harness,
    lifecycle: 'stopped-clean',
    title: harness,
    titleKind: 'default',
    ...extra,
  };
}

function project(dir: string, tabs: SessionTab[]): Project {
  return { dir, name: dir, color: '#fff', tabs, activeTabId: null };
}

const named = (
  durableSessionId: string,
  projectKey: string
): [string, AgentNameRecord] => [
  durableSessionId,
  {
    durableSessionId,
    projectKey,
    harness: 'claude',
    name: 'x',
    origin: 'assigned',
    updatedAt: 0,
  },
];

describe('agentNameRequests', () => {
  it('asks for every unnamed Agent in strip order, offering an older rename', () => {
    const projects = [
      project('/one', [
        tab('a', 'claude'),
        tab('draft', 'claude', { lifecycle: 'draft' }),
        tab('shell', 'shell'),
        tab('b', 'codex', { title: 'Login fix', titleKind: 'operator' }),
      ]),
      project('/two', [tab('c', 'antigravity')]),
    ];
    expect(agentNameRequests(projects, new Map())).toEqual([
      {
        durableSessionId: 'a',
        projectKey: '/one',
        harness: 'claude',
        preferredName: null,
      },
      {
        durableSessionId: 'b',
        projectKey: '/one',
        harness: 'codex',
        preferredName: 'Login fix',
      },
      {
        durableSessionId: 'c',
        projectKey: '/two',
        harness: 'antigravity',
        preferredName: null,
      },
    ]);
  });

  it('asks again only for a Session that moved Project', () => {
    const projects = [
      project('/one', [tab('a', 'claude'), tab('b', 'claude')]),
    ];
    const names = new Map([named('a', '/one'), named('b', '/elsewhere')]);
    expect(
      agentNameRequests(projects, names).map(
        request => request.durableSessionId
      )
    ).toEqual(['b']);
  });
});
