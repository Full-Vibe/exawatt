import { describe, expect, it } from 'vitest';
import { createAgentProjectOwnersSelector } from './agent-project-owners';

describe('Agent command Project ownership', () => {
  it('retains routing identity across equivalent source ticks and zone ordering', () => {
    const select = createAgentProjectOwnersSelector();
    const first = select([
      { clusterId: 'project-a', agentIds: ['a', 'b'] },
      { clusterId: 'project-b', agentIds: ['c'] },
    ]);
    expect(
      select([
        { clusterId: 'project-b', agentIds: ['c'] },
        { clusterId: 'project-a', agentIds: ['b', 'a'] },
      ])
    ).toBe(first);
  });

  it('immediately routes moves, additions and removals using current membership', () => {
    const select = createAgentProjectOwnersSelector();
    const before = select([
      { clusterId: 'old-project', agentIds: ['a', 'removed'] },
    ]);
    const after = select([
      { clusterId: 'new-project', agentIds: ['a', 'added'] },
    ]);
    expect(after).not.toBe(before);
    expect(after.get('a')).toBe('new-project');
    expect(after.get('added')).toBe('new-project');
    expect(after.get('removed') ?? null).toBeNull();
    expect(after.get('unknown') ?? null).toBeNull();
    expect(before.get('a')).toBe('old-project');
  });

  it('keeps first-match semantics for ambiguous membership', () => {
    const select = createAgentProjectOwnersSelector();
    const a = { clusterId: 'a', agentIds: ['agent'] };
    const b = { clusterId: 'b', agentIds: ['agent'] };
    expect(select([a, b]).get('agent')).toBe('a');
    expect(select([b, a]).get('agent')).toBe('b');
  });
});
