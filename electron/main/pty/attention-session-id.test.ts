import { expect, it } from 'vitest';
import type { PtySessionRecord } from '@exawatt/core/desktop-bridge';
import { resolveAttentionSessionId } from './attention-session-id';

it('routes durable inspection to the current incarnation while keeping exact and ended targets exact', () => {
  const sessions = [
    { id: 'ended', durableSessionId: 'durable', exited: true, startedAt: 1 },
    { id: 'current', durableSessionId: 'durable', exited: false, startedAt: 2 },
  ] as PtySessionRecord[];
  expect(resolveAttentionSessionId('durable', sessions)).toBe('current');
  expect(resolveAttentionSessionId('ended', sessions)).toBe('ended');
  expect(resolveAttentionSessionId('durable', sessions.slice(0, 1))).toBe(
    'ended'
  );
  expect(resolveAttentionSessionId('removed', sessions)).toBeNull();
  expect(resolveAttentionSessionId(null, sessions)).toBeNull();
});
