import * as fs from 'fs';
import * as path from 'path';

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
    (record.harness === 'claude' || record.harness === 'codex') &&
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
export class SessionIdentityStore {
  private identities = new Map<string, SessionIdentityRecord>();
  private initializePromise: Promise<void> | null = null;
  private operationTail: Promise<void> = Promise.resolve();
  private temporarySequence = 0;
  private mutationVersion = 0;
  private persistedVersion = 0;

  constructor(private readonly file: string) {}

  async initialize(): Promise<void> {
    if (!this.initializePromise) {
      this.initializePromise = (async () => {
        try {
          const parsed = JSON.parse(
            await fs.promises.readFile(this.file, 'utf8')
          ) as Partial<StoredSessionIdentitiesV1>;
          if (parsed.v !== 1 || !Array.isArray(parsed.identities)) return;
          for (const record of parsed.identities) {
            if (validRecord(record)) {
              this.identities.set(record.durableSessionId, record);
            }
          }
        } catch {
          // Missing or corrupt identity state is recoverable from provider
          // transcripts when and only when there is one unambiguous match.
        }
      })();
    }
    await this.initializePromise;
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
    if (!this.identities.delete(durableSessionId)) return;
    this.mutationVersion += 1;
    await this.persist();
  }

  async flush(): Promise<void> {
    await this.operationTail;
    // A failed mutation remains dirty in memory. Normal launch/resume must not
    // be reported as failed after the provider process is already live, so the
    // shutdown checkpoint gets one authoritative retry.
    if (this.persistedVersion < this.mutationVersion) await this.persist();
  }

  private persist(): Promise<void> {
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
