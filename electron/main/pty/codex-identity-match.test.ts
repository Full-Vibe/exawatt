import { describe, expect, it } from 'vitest';
import { ownerOfCodexCandidate } from './codex-identity-match';

describe('ownerOfCodexCandidate', () => {
  it('keeps parallel same-project rollouts attached to their nearest launch', () => {
    const sessions = [
      { id: 'agent-a', cwd: '/project', startedAt: 1_000 },
      { id: 'agent-b', cwd: '/project', startedAt: 2_000 },
      { id: 'agent-c', cwd: '/other', startedAt: 2_010 },
    ];
    expect(
      ownerOfCodexCandidate(sessions, { cwd: '/project', startedAt: 1_020 })
    ).toBe('agent-a');
    expect(
      ownerOfCodexCandidate(sessions, { cwd: '/project', startedAt: 1_980 })
    ).toBe('agent-b');
    expect(
      ownerOfCodexCandidate(sessions, { cwd: '/other', startedAt: 2_020 })
    ).toBe('agent-c');
  });

  it('breaks equal timestamp ties deterministically', () => {
    const sessions = [
      { id: 'second', cwd: '/project', startedAt: 1_000 },
      { id: 'first', cwd: '/project', startedAt: 1_000 },
    ];
    expect(
      ownerOfCodexCandidate(sessions, { cwd: '/project', startedAt: 1_000 })
    ).toBe('first');
  });
});
