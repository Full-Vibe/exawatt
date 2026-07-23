import { describe, expect, it, vi } from 'vitest';

import {
  reconcileResumeIdentities,
  type ResumeIdentityHint,
} from './resume-candidates';

const hint = (
  durableSessionId: string,
  initialTask: string,
  harnessSessionId: string | null = null,
  harness: ResumeIdentityHint['harness'] = 'codex'
): ResumeIdentityHint => ({
  durableSessionId,
  harness,
  cwd: '/project',
  initialTask,
  harnessSessionId,
});

describe('resume identity reconciliation', () => {
  it('uses main-owned durable identity before transcript correlation', async () => {
    const findCandidates = vi.fn(async () => ['provider-from-task']);
    const result = await reconcileResumeIdentities(
      [hint('session-one', 'Build voting')],
      new Map([
        [
          'session-one',
          {
            harness: 'codex' as const,
            harnessSessionId: 'provider-durable',
            cwd: '/old-worktree',
          },
        ],
      ]),
      findCandidates
    );

    expect(result).toEqual([
      expect.objectContaining({
        durableSessionId: 'session-one',
        harnessSessionId: 'provider-durable',
        source: 'durable-index',
      }),
    ]);
    expect(findCandidates).not.toHaveBeenCalled();
  });

  it('repairs a unique legacy task match without using recency', async () => {
    const result = await reconcileResumeIdentities(
      [hint('session-one', 'Build voting')],
      new Map(),
      async () => ['provider-one']
    );
    expect(result[0]).toMatchObject({
      durableSessionId: 'session-one',
      harnessSessionId: 'provider-one',
      source: 'task-correlation',
    });
  });

  it('refuses ambiguous, duplicate, or already-owned provider matches', async () => {
    const results = await reconcileResumeIdentities(
      [
        hint('ambiguous', 'Repeated task'),
        hint('duplicate-a', 'Same task'),
        hint('duplicate-b', 'Same task'),
        hint('already-owned', 'Other task'),
        hint('owner', 'Known task', 'provider-owned'),
      ],
      new Map(),
      async candidate => {
        if (candidate.durableSessionId === 'ambiguous') {
          return ['provider-a', 'provider-b'];
        }
        if (candidate.durableSessionId.startsWith('duplicate')) {
          return ['provider-shared'];
        }
        return ['provider-owned'];
      }
    );
    expect(results).toEqual([]);
  });

  it('refuses a duplicated durable-index identity', async () => {
    const results = await reconcileResumeIdentities(
      [hint('duplicate-a', 'First task'), hint('duplicate-b', 'Second task')],
      new Map([
        [
          'duplicate-a',
          {
            harness: 'codex' as const,
            harnessSessionId: 'provider-shared',
            cwd: '/project',
          },
        ],
        [
          'duplicate-b',
          {
            harness: 'codex' as const,
            harnessSessionId: 'provider-shared',
            cwd: '/project',
          },
        ],
      ]),
      async () => []
    );

    expect(results).toEqual([]);
  });

  it('namespaces provider identities by harness', async () => {
    const results = await reconcileResumeIdentities(
      [
        hint('codex-session', 'Same visible task'),
        hint('claude-session', 'Same visible task', null, 'claude'),
      ],
      new Map(),
      async () => ['same-provider-shaped-id']
    );

    expect(results).toEqual([
      expect.objectContaining({
        durableSessionId: 'codex-session',
        harness: 'codex',
      }),
      expect.objectContaining({
        durableSessionId: 'claude-session',
        harness: 'claude',
      }),
    ]);
  });
});
