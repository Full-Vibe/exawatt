import type { PtySessionInfo } from './session-manager';

export interface SessionPauseResult {
  durableSessionId: string;
  status: 'paused' | 'already-paused' | 'unsupported' | 'failed';
  error?: string;
}
export type SessionPauseBatchResult =
  | { kind: 'needs-confirmation'; activeSessionIds: string[] }
  | { kind: 'completed'; results: SessionPauseResult[] };

interface PausePorts {
  session(durableSessionId: string): PtySessionInfo | undefined;
  active(runtimeId: string): boolean;
  prepare(
    runtimeId: string
  ): Promise<{ stop(): Promise<void>; release(): void }>;
}

/** Project is only a selection scope. Each durable Session keeps its own result.
 * Confirmation preflight stops nothing; confirmed requests re-read live ownership. */
export function createSessionPauser(ports: PausePorts) {
  return async (
    requested: string[],
    confirmed = false
  ): Promise<SessionPauseBatchResult> => {
    if (
      !Array.isArray(requested) ||
      requested.some(id => typeof id !== 'string' || !id)
    )
      throw new Error('Invalid Session selection.');
    const ids = [...new Set(requested)];
    const activeSessionIds = ids.filter(id => {
      const session = ports.session(id);
      return (
        session &&
        !session.exited &&
        session.harness !== 'shell' &&
        ports.active(session.id)
      );
    });
    if (activeSessionIds.length && confirmed !== true)
      return { kind: 'needs-confirmation', activeSessionIds };
    const preparations = await Promise.all(
      ids.map(async durableSessionId => {
        const session = ports.session(durableSessionId);
        let result: SessionPauseResult | undefined;
        let prepared: Awaited<ReturnType<PausePorts['prepare']>> | undefined;
        if (!session || session.harness === 'shell') {
          result = {
            durableSessionId,
            status: 'unsupported',
            error: 'This Agent Source cannot be paused here.',
          };
        } else if (session.exited) {
          result = { durableSessionId, status: 'already-paused' };
        } else {
          try {
            prepared = await ports.prepare(session.id);
          } catch (error) {
            result = failure(durableSessionId, error);
          }
        }
        return { durableSessionId, runtimeId: session?.id, prepared, result };
      })
    );
    try {
      // No member stops while another is awaiting identity discovery. Recheck
      // the entire batch after all asynchronous preparation, with locks held.
      const becameActive = preparations
        .filter(
          item =>
            item.prepared && item.runtimeId && ports.active(item.runtimeId)
        )
        .map(item => item.durableSessionId);
      if (becameActive.length && confirmed !== true)
        return { kind: 'needs-confirmation', activeSessionIds: becameActive };
      const results = await Promise.all(
        preparations.map(async (item): Promise<SessionPauseResult> => {
          if (item.result) return item.result;
          try {
            if (ports.session(item.durableSessionId)?.id !== item.runtimeId)
              throw new Error('The Session changed before it could pause.');
            await item.prepared!.stop();
            return {
              durableSessionId: item.durableSessionId,
              status: 'paused',
            };
          } catch (error) {
            return failure(item.durableSessionId, error);
          }
        })
      );
      return { kind: 'completed', results };
    } finally {
      for (const item of preparations) item.prepared?.release();
    }
  };
}

function failure(durableSessionId: string, error: unknown): SessionPauseResult {
  return {
    durableSessionId,
    status: 'failed',
    error: error instanceof Error ? error.message : String(error),
  };
}
