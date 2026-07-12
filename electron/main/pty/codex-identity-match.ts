export interface PendingCodexSession {
  id: string;
  cwd: string;
  startedAt: number;
}

/** Assign a rollout to the pending PTY whose launch timestamp is closest. */
export function ownerOfCodexCandidate(
  sessions: PendingCodexSession[],
  candidate: { cwd: string; startedAt: number }
): string | null {
  return (
    sessions
      .filter(session => session.cwd === candidate.cwd)
      .sort(
        (a, b) =>
          Math.abs(a.startedAt - candidate.startedAt) -
            Math.abs(b.startedAt - candidate.startedAt) ||
          a.startedAt - b.startedAt ||
          a.id.localeCompare(b.id)
      )[0]?.id ?? null
  );
}
