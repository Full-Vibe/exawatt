import {
  AGENT_NAME_MAX_LENGTH,
  assignAgentNames,
  harnessCarriesAgentName,
  renameAgentName,
  type AgentNameRecord,
  type AgentNameRequest,
  type AgentNameSkip,
  type AgentRenameResult,
} from '@exawatt/core';

import { SessionRecordStore } from './session-record-store';

const SAFE_DURABLE_ID = /^[A-Za-z0-9._-]{1,200}$/;

function validRecord(value: unknown): value is AgentNameRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<AgentNameRecord>;
  return (
    typeof record.durableSessionId === 'string' &&
    SAFE_DURABLE_ID.test(record.durableSessionId) &&
    typeof record.projectKey === 'string' &&
    !!record.projectKey &&
    typeof record.harness === 'string' &&
    !!record.harness &&
    typeof record.name === 'string' &&
    !!record.name &&
    [...record.name].length <= AGENT_NAME_MAX_LENGTH &&
    (record.origin === 'assigned' || record.origin === 'operator') &&
    typeof record.updatedAt === 'number' &&
    Number.isFinite(record.updatedAt)
  );
}

/** The bridge's argument guard: a renderer request is data, not trusted. */
export function isAgentNameRequest(value: unknown): value is AgentNameRequest {
  if (!value || typeof value !== 'object') return false;
  const request = value as Partial<AgentNameRequest>;
  return (
    typeof request.durableSessionId === 'string' &&
    typeof request.projectKey === 'string' &&
    typeof request.harness === 'string' &&
    (request.preferredName === undefined ||
      request.preferredName === null ||
      typeof request.preferredName === 'string')
  );
}

/**
 * Agents' names (ENG-029 C4), persisted beside the Session identities main
 * already owns (`session-identities.json`), keyed by the same durable Session
 * id. Main is the one truth: the bus directory reads it here, and the
 * renderer reads it over the bridge. Allocation and rename rules live in
 * `@exawatt/core` (`agents/agent-name.ts`); this class only makes them
 * durable.
 *
 * A separate file rather than a second collection in the identity index, so
 * an older build reading that index never sets provider identities aside
 * over a shape it does not know.
 */
export class AgentNameStore extends SessionRecordStore<AgentNameRecord> {
  constructor(file: string) {
    super(file, {
      label: 'Agent names',
      collection: 'names',
      valid: validRecord,
      maxBytes: 16 * 1024 * 1024,
    });
  }

  /** Why main can never name this request as asked, or null when it can. */
  static skipReason(request: AgentNameRequest): string | null {
    if (!SAFE_DURABLE_ID.test(request.durableSessionId))
      return 'Not a Session id';
    if (!request.projectKey) return 'No Project to name it within';
    if (!harnessCarriesAgentName(request.harness))
      return 'A shell carries no name';
    return null;
  }

  /**
   * Name every requested Session that has none (or deal it a name in the
   * Project it moved to), in request order. Answers the requested Sessions'
   * records, the records this call changed, and every request it skipped
   * with the reason, so an asker never re-asks what can never be answered.
   */
  async ensure(requests: readonly AgentNameRequest[]): Promise<{
    records: AgentNameRecord[];
    changed: AgentNameRecord[];
    skipped: AgentNameSkip[];
  }> {
    await this.initialize();
    const skipped: AgentNameSkip[] = [];
    const usable: AgentNameRequest[] = [];
    for (const request of requests) {
      const reason = AgentNameStore.skipReason(request);
      if (reason)
        skipped.push({ durableSessionId: request.durableSessionId, reason });
      else usable.push(request);
    }
    // Compute and commit with no await in between: a concurrent launch
    // cannot be dealt the same name.
    const current = this.list();
    const { records, changed } = assignAgentNames(current, usable, Date.now());
    const before = new Map(
      current.map(record => [record.durableSessionId, record])
    );
    const touched = changed
      ? records.filter(record => before.get(record.durableSessionId) !== record)
      : [];
    const persisted = this.commit(touched);
    const wanted = new Set(usable.map(request => request.durableSessionId));
    const answer = records.filter(record =>
      wanted.has(record.durableSessionId)
    );
    // The names are dealt in memory either way; a failed write stays dirty for
    // the shutdown checkpoint rather than failing a launch.
    await persisted.catch(error => {
      console.error('Agent name checkpoint failed', error);
    });
    return { records: answer, changed: touched, skipped };
  }

  async rename(
    durableSessionId: string,
    input: string
  ): Promise<AgentRenameResult> {
    await this.initialize();
    const result = renameAgentName(
      this.list(),
      durableSessionId,
      input,
      Date.now()
    );
    if (!result.ok) return result;
    await this.commit([result.record]).catch(error => {
      console.error('Agent name checkpoint failed', error);
    });
    return result;
  }
}
