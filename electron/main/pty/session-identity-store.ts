import { isAgentHarness } from '@exawatt/core';

import { SessionRecordStore } from './session-record-store';
import type { AgentHarness } from './harness-types';

export interface SessionIdentityRecord {
  durableSessionId: string;
  harness: AgentHarness;
  harnessSessionId: string;
  cwd: string;
  updatedAt: number;
}

const SAFE_DURABLE_ID = /^[A-Za-z0-9._-]{1,200}$/;
const SAFE_PROVIDER_ID = /^[A-Za-z0-9_-]{8,128}$/;

function validRecord(value: unknown): value is SessionIdentityRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<SessionIdentityRecord>;
  return (
    typeof record.durableSessionId === 'string' &&
    SAFE_DURABLE_ID.test(record.durableSessionId) &&
    isAgentHarness(record.harness) &&
    typeof record.harnessSessionId === 'string' &&
    SAFE_PROVIDER_ID.test(record.harnessSessionId) &&
    typeof record.cwd === 'string' &&
    !!record.cwd &&
    typeof record.updatedAt === 'number' &&
    Number.isFinite(record.updatedAt)
  );
}

/**
 * Main-owned durable mapping from Exawatt Session identity to provider
 * conversation identity.
 *
 * The renderer persists layout; the main process owns provider processes and
 * learns their identities. Keeping this tiny index at the ownership boundary
 * closes the debounce/crash gap where terminal history survived but the exact
 * conversation ID did not. Every mutation is an atomic, serialized replace.
 */
export class SessionIdentityStore extends SessionRecordStore<SessionIdentityRecord> {
  constructor(file: string) {
    super(file, {
      label: 'saved Session resume links',
      collection: 'identities',
      valid: validRecord,
      maxBytes: 64 * 1024 * 1024,
    });
  }

  async remember(
    record: Omit<SessionIdentityRecord, 'updatedAt'>
  ): Promise<SessionIdentityRecord> {
    await this.initialize();
    const stamped: SessionIdentityRecord = {
      ...record,
      updatedAt: Date.now(),
    };
    if (!validRecord(stamped)) throw new Error('Invalid Session identity');
    await this.commit([stamped]);
    return stamped;
  }
}
