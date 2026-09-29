import * as fs from 'fs';
import * as path from 'path';

import { isAgentHarness } from '@exawatt/core';
import type { ConfigFileUnreadableCause } from '@exawatt/core/server';

import {
  UnreadableStateWatch,
  jsonStateGrammar,
  readPersistedState,
} from '../persisted-state-file';
import type { AgentHarness } from './harness-types';

export interface SessionIdentityRecord {
  durableSessionId: string;
  harness: AgentHarness;
  harnessSessionId: string;
  cwd: string;
  updatedAt: number;
}

interface StoredSessionIdentitiesV1 {
  v: 1;
  identities: SessionIdentityRecord[];
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
 * The whole file or nothing: one record this build cannot read sets the file
 * aside with its bytes, rather than being dropped by the next save (the rule
 * settings follow since 0.1.13).
 */
const IDENTITY_FILE = jsonStateGrammar<SessionIdentityRecord[]>(
  value => {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      return null;
    const stored = value as Partial<StoredSessionIdentitiesV1>;
    if (stored.v !== 1 || !Array.isArray(stored.identities)) return null;
    return stored.identities.every(validRecord) ? stored.identities : null;
  },
  64 * 1024 * 1024
);

/**
 * Main-owned durable mapping from Exawatt Session identity to provider
 * conversation identity.
 *
 * The renderer persists layout; the main process owns provider processes and
 * learns their identities. Keeping this tiny index at the ownership boundary
 * closes the debounce/crash gap where terminal history survived but the exact
 * conversation ID did not. Every mutation is an atomic, serialized replace.
 */
export class SessionIdentityStore {
  private identities = new Map<string, SessionIdentityRecord>();
  private initializePromise: Promise<void> | null = null;
  private operationTail: Promise<void> = Promise.resolve();
  private temporarySequence = 0;
  private mutationVersion = 0;
  private persistedVersion = 0;
  /**
   * Set while the file exists and cannot be read (BUG-247). Nothing is
   * written over it; changes stay in memory, deletions included, and are
   * merged over the file once a later read succeeds.
   */
  private unreadable: ConfigFileUnreadableCause | null = null;
  private pendingDeletes = new Set<string>();
  private readonly watch: UnreadableStateWatch;

  constructor(private readonly file: string) {
    this.watch = new UnreadableStateWatch(file, 'saved Session resume links');
  }

  /**
   * Reads the file once, and again on every later call while it is
   * unreadable: each mutation and flush calls this first, so the next access
   * retries.
   */
  async initialize(): Promise<void> {
    if (!this.initializePromise || this.unreadable) {
      const previous = this.initializePromise;
      this.initializePromise = (async () => {
        await previous;
        if (previous && !this.unreadable) return;
        await this.read();
      })();
    }
    await this.initializePromise;
  }

  private async read(): Promise<void> {
    const read = await readPersistedState(this.file, IDENTITY_FILE);
    if (read.status === 'unreadable') {
      this.unreadable = read.cause;
      this.watch.failed(read.cause);
      return;
    }
    // Missing, or damaged and set aside with its bytes: a fresh index.
    const disk = new Map<string, SessionIdentityRecord>();
    if (read.status === 'ok') {
      for (const record of read.value) {
        disk.set(record.durableSessionId, record);
      }
    }
    const blocked = this.unreadable !== null;
    this.unreadable = null;
    this.watch.recovered();
    // Changes made while the file could not be read win over it.
    for (const id of this.pendingDeletes) disk.delete(id);
    for (const [id, record] of this.identities) disk.set(id, record);
    this.pendingDeletes.clear();
    this.identities = disk;
    if (blocked && this.persistedVersion < this.mutationVersion) {
      await this.persist().catch(error => {
        console.error('Session identity checkpoint failed', error);
      });
    }
  }

  list(): SessionIdentityRecord[] {
    return [...this.identities.values()];
  }

  get(durableSessionId: string): SessionIdentityRecord | null {
    return this.identities.get(durableSessionId) ?? null;
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
    this.identities.set(stamped.durableSessionId, stamped);
    this.mutationVersion += 1;
    await this.persist();
    return stamped;
  }

  async delete(durableSessionId: string): Promise<void> {
    await this.initialize();
    if (this.unreadable) this.pendingDeletes.add(durableSessionId);
    if (!this.identities.delete(durableSessionId) && !this.unreadable) return;
    this.mutationVersion += 1;
    await this.persist();
  }

  async flush(): Promise<void> {
    await this.operationTail;
    if (this.unreadable) {
      await this.initialize();
      // Still unreadable: the file stays as it is, and what this launch
      // learned is lost with it. The workspace checkpoint carries the same
      // provider identities.
      if (this.unreadable) return;
    }
    // A failed mutation remains dirty in memory. Normal launch/resume must not
    // be reported as failed after the provider process is already live, so the
    // shutdown checkpoint gets one authoritative retry.
    if (this.persistedVersion < this.mutationVersion) await this.persist();
  }

  private persist(): Promise<void> {
    // Never replace a file that could not be read. The change stays dirty in
    // memory and is written once a read succeeds.
    if (this.unreadable) return Promise.resolve();
    const version = this.mutationVersion;
    const snapshot: StoredSessionIdentitiesV1 = {
      v: 1,
      identities: this.list(),
    };
    const operation = this.operationTail.then(async () => {
      await fs.promises.mkdir(path.dirname(this.file), {
        recursive: true,
        mode: 0o700,
      });
      const temporary = `${this.file}.tmp-${process.pid}-${++this.temporarySequence}`;
      try {
        await fs.promises.writeFile(temporary, JSON.stringify(snapshot), {
          encoding: 'utf8',
          mode: 0o600,
        });
        await fs.promises.chmod(temporary, 0o600);
        await fs.promises.rename(temporary, this.file);
        await fs.promises.chmod(this.file, 0o600);
        this.persistedVersion = Math.max(this.persistedVersion, version);
      } finally {
        await fs.promises.rm(temporary, { force: true });
      }
    });
    this.operationTail = operation.catch(() => undefined);
    return operation;
  }
}
