import type { PtySessionRecord } from '@exawatt/core/desktop-bridge';

/** Inspection targets an existing Session, including its retained ended runtime.
 * Durable identity follows the newest incarnation; an exact process id stays exact. */
export function resolveAttentionSessionId(
  id: string | null,
  sessions: readonly PtySessionRecord[]
): string | null {
  if (!id) return null;
  const exact = sessions.find(session => session.id === id);
  if (exact) return exact.id;
  const matches = sessions.filter(session => session.durableSessionId === id);
  matches.sort(
    (a, b) => Number(a.exited) - Number(b.exited) || b.startedAt - a.startedAt
  );
  return matches[0]?.id ?? null;
}
