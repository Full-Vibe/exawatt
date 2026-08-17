import { afterEach, describe, expect, it } from 'vitest';
import type { PtySessionInfo } from '../pty/session-manager';
import {
  DelegationMonitor,
  type DelegationReportSink,
} from './delegation-monitor';
import {
  CodexDelegationObserver,
  codexProtocolVersion,
  codexProtocolVersionSupported,
  parseCodexLatestTurn,
  parseCodexSubagentActivity,
  parseCodexThreadPage,
  type CodexChildThread,
  type CodexDelegationProtocol,
  type CodexSubagentActivity,
  type CodexTurnSummary,
} from './codex-app-server';
import { sessionGlyphState } from '../../../src/components/workspace/session-status';
import {
  sessionStatus,
  sessionToAgent,
} from '../../../packages/core/src/transports/local-sessions';
import {
  selectSpatialBoardLayout,
  selectSpatialDelegationUnits,
} from '../../../packages/ui-model/src/spatial-board';

const ROOT = '019fedc3-d5fb-77c0-8922-19d3ee31d297';

const session = (over: Partial<PtySessionInfo> = {}): PtySessionInfo => ({
  id: 'pty-codex',
  durableSessionId: 'durable-codex',
  harness: 'codex',
  title: 'Codex',
  cwd: '/code/exawatt',
  projectDir: '/code/exawatt',
  projectName: 'Exawatt',
  cols: 120,
  rows: 40,
  startedAt: 1,
  exited: false,
  exitCode: null,
  lastDataAt: 1,
  harnessSessionId: ROOT,
  ...over,
});

const child = (
  id: string,
  createdAt: number,
  over: Partial<CodexChildThread> = {}
): CodexChildThread => ({
  id,
  parentThreadId: ROOT,
  agentNickname: null,
  agentRole: null,
  agentPath: `/root/${id}`,
  createdAt,
  updatedAt: createdAt,
  ...over,
});

class FakeProtocol implements CodexDelegationProtocol {
  connectCalls = 0;
  closeCalls = 0;
  latestTurnCalls = 0;
  fail = false;
  descendants: CodexChildThread[] = [];
  turns = new Map<string, CodexTurnSummary | null>();
  activity = new Map<string, CodexSubagentActivity>();

  async connect(): Promise<void> {
    this.connectCalls += 1;
    if (this.fail) throw new Error('unavailable');
  }

  close(): void {
    this.closeCalls += 1;
  }

  async listDescendants(): Promise<CodexChildThread[]> {
    if (this.fail) throw new Error('disconnected');
    return this.descendants;
  }

  async latestTurn(threadId: string): Promise<CodexTurnSummary | null> {
    this.latestTurnCalls += 1;
    if (this.fail) throw new Error('disconnected');
    return this.turns.get(threadId) ?? null;
  }

  async latestSubagentActivity(): Promise<Map<string, CodexSubagentActivity>> {
    if (this.fail) throw new Error('disconnected');
    return this.activity;
  }
}

function running(): CodexTurnSummary {
  // Verified on the installed 0.147 app-server while a Code-mode child is
  // live in another TUI process: external active turns currently project as
  // interrupted with no completion timestamp.
  return { status: 'interrupted', completedAt: null };
}

function completed(at = 10): CodexTurnSummary {
  return { status: 'completed', completedAt: at };
}

describe('Codex 0.147 protocol shape', () => {
  it('version-probes the initialized server and rejects the older schema', () => {
    expect(
      codexProtocolVersion('exawatt-delegation/0.147.0 (Mac OS; arm64) Exawatt')
    ).toEqual([0, 147, 0]);
    expect(codexProtocolVersionSupported([0, 147, 0])).toBe(true);
    expect(codexProtocolVersionSupported([0, 146, 9])).toBe(false);
    expect(codexProtocolVersion('not-a-codex-agent')).toBeNull();
  });

  it('accepts only parented thread and lifecycle fields owned by app-server', () => {
    expect(
      parseCodexThreadPage({
        data: [
          {
            id: 'child-1',
            parentThreadId: ROOT,
            agentNickname: 'Copernicus',
            agentRole: null,
            createdAt: 10,
            updatedAt: 11,
            source: {
              subAgent: {
                thread_spawn: { agent_path: '/root/map_release' },
              },
            },
          },
        ],
        nextCursor: null,
      }).data[0]
    ).toEqual({
      id: 'child-1',
      parentThreadId: ROOT,
      agentNickname: 'Copernicus',
      agentRole: null,
      agentPath: '/root/map_release',
      createdAt: 10,
      updatedAt: 11,
    });
    expect(
      parseCodexLatestTurn({
        data: [{ status: 'inProgress', completedAt: null }],
      })
    ).toEqual({ status: 'inProgress', completedAt: null });
    expect(() =>
      parseCodexThreadPage({ data: [{}], nextCursor: null })
    ).toThrow('invalid child shape');
  });

  it('takes the newest parent-reported child activity from descending items', () => {
    const activity = parseCodexSubagentActivity({
      data: [
        {
          item: {
            type: 'subAgentActivity',
            agentThreadId: 'child-1',
            kind: 'interacted',
          },
        },
        {
          item: {
            type: 'subAgentActivity',
            agentThreadId: 'child-1',
            kind: 'interrupted',
          },
        },
      ],
    });
    expect(activity.get('child-1')).toBe('interacted');
  });
});

describe('CodexDelegationObserver', () => {
  const observers: CodexDelegationObserver[] = [];

  afterEach(() => {
    for (const observer of observers) observer.drop('pty-codex');
    observers.length = 0;
  });

  function harness() {
    const protocol = new FakeProtocol();
    const monitor = new DelegationMonitor();
    const lifecycle: unknown[] = [];
    const sink: DelegationReportSink = {
      report: (id, event) => {
        lifecycle.push(event);
        monitor.report(id, event);
      },
      clearReportedChildren: id => monitor.clearReportedChildren(id),
    };
    const observer = new CodexDelegationObserver({
      clientFactory: () => protocol,
      pollIntervalMs: 60_000,
      sink,
      autoPoll: false,
    });
    observers.push(observer);
    observer.observe(session());
    return { protocol, monitor, lifecycle, observer };
  }

  it('reports an exact two-child census once and ends children by source ID', async () => {
    const h = harness();
    h.protocol.descendants = [child('map_release', 10), child('audit_ci', 20)];
    h.protocol.turns.set('map_release', running());
    h.protocol.turns.set('audit_ci', running());
    h.protocol.activity.set('map_release', 'started');
    h.protocol.activity.set('audit_ci', 'started');

    await h.observer.pollNow();
    expect(h.monitor.getLive('pty-codex')?.children).toEqual([
      {
        id: 'map_release',
        agentType: 'Codex',
        description: 'map release',
        startedAt: 10_000,
      },
      {
        id: 'audit_ci',
        agentType: 'Codex',
        description: 'audit ci',
        startedAt: 20_000,
      },
    ]);
    await h.observer.pollNow();
    expect(h.lifecycle).toHaveLength(2); // unchanged snapshots are idempotent

    h.protocol.descendants[0] = child('map_release', 10, { updatedAt: 30 });
    h.protocol.turns.set('map_release', completed());
    await h.observer.pollNow();
    expect(
      h.monitor.getLive('pty-codex')?.children.map(item => item.id)
    ).toEqual(['audit_ci']);
    expect(h.lifecycle[h.lifecycle.length - 1]).toEqual({
      kind: 'child-end',
      childId: 'map_release',
    });
  });

  it('uses parent-reported interruption and never process or recency heuristics', async () => {
    const h = harness();
    h.protocol.descendants = [child('stopped', 10)];
    h.protocol.turns.set('stopped', running());
    h.protocol.activity.set('stopped', 'interrupted');

    await h.observer.pollNow();
    expect(h.monitor.getLive('pty-codex')).toBeNull();
    expect(h.lifecycle).toEqual([]);
  });

  it('fails to absent and reconnects with a fresh authoritative snapshot', async () => {
    const h = harness();
    h.protocol.descendants = [child('child-1', 10)];
    h.protocol.turns.set('child-1', running());
    h.protocol.activity.set('child-1', 'started');
    await h.observer.pollNow();
    expect(h.monitor.isBusy('pty-codex')).toBe(true);

    h.protocol.fail = true;
    await h.observer.pollNow();
    expect(h.monitor.getLive('pty-codex')).toBeNull();
    // Withdrawing observation is not child completion.
    expect(
      h.lifecycle.filter(
        event => (event as { kind?: string }).kind === 'child-end'
      )
    ).toEqual([]);

    h.protocol.fail = false;
    await h.observer.pollNow();
    expect(h.monitor.getLive('pty-codex')?.children).toHaveLength(1);
  });

  it('drives Agent, Team, and Fleet through the existing source-agnostic model', async () => {
    const h = harness();
    h.protocol.descendants = [child('alpha', 10), child('beta', 20)];
    h.protocol.turns.set('alpha', running());
    h.protocol.turns.set('beta', running());
    h.protocol.activity.set('alpha', 'started');
    h.protocol.activity.set('beta', 'started');
    await h.observer.pollNow();
    const delegation = h.monitor.getLive('pty-codex')!;

    // Agent altitude: a quiet parent with live children is still working.
    expect(
      sessionGlyphState({
        working: false,
        agent: true,
        started: true,
        delegatedBusy: delegation.children.length > 0,
        ownTurn: delegation.ownTurn,
      })
    ).toBe('working');

    // Team altitude: the shared local transport makes the same decision.
    expect(
      sessionStatus(
        {
          exited: false,
          exitCode: null,
          harness: 'codex',
          working: false,
          engaged: true,
          delegation,
        },
        1,
        100_000,
        15_000
      )
    ).toBe('working');

    // Fleet altitude: the existing board selector receives two real units.
    const agent = sessionToAgent(
      {
        ...session(),
        delegation,
        working: false,
        engaged: true,
      },
      1,
      100_000,
      15_000
    );
    const layout = selectSpatialBoardLayout({
      agents: { [agent.id]: agent },
      metrics: {
        activeCount: 1,
        blockedCount: 0,
        idleCount: 0,
        totalCost: 0,
        totalTokens: 0,
        totalCostRate: 0,
        costByProject: {},
      },
      lastUpdated: 1,
    });
    expect(selectSpatialDelegationUnits(layout)).toHaveLength(2);
  });
});
