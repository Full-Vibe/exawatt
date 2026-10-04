import type { EventEmitter } from 'events';
import type {
  PtyAttention,
  PtySessionRecord,
} from '@exawatt/core/desktop-bridge';

/** Exact-resume custody is installed before spawn can expose source events.
 * Scoped listeners isolate concurrent Sessions and are always removed, including
 * failed creates. The manager emits `created` synchronously after registration,
 * before PTY callbacks or source-observer lifecycle events are attached. */
export async function withInitialSessionAttention<T>(
  manager: Pick<EventEmitter, 'prependListener' | 'removeListener'>,
  monitor: { restore(id: string, snapshot: PtyAttention): void },
  options: {
    durableSessionId?: string;
    resumeSessionId?: string;
    restoredAttention?: PtyAttention;
  },
  create: () => Promise<T>
): Promise<T> {
  const { durableSessionId, resumeSessionId, restoredAttention } = options;
  if (!durableSessionId || !resumeSessionId || !restoredAttention)
    return create();
  const seed = (record: PtySessionRecord) => {
    if (
      record.durableSessionId !== durableSessionId ||
      record.harnessSessionId !== resumeSessionId
    )
      return;
    monitor.restore(record.id, restoredAttention);
    manager.removeListener('created', seed);
  };
  manager.prependListener('created', seed);
  try {
    return await create();
  } finally {
    manager.removeListener('created', seed);
  }
}
