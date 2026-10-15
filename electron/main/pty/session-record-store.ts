import * as fs from 'fs';
import * as path from 'path';

import type {
  ConfigFileGrammar,
  ConfigFileUnreadableCause,
} from '@exawatt/core/server';

import {
  UnreadableStateWatch,
  jsonStateGrammar,
  readPersistedState,
} from '../persisted-state-file';

/** A record main keeps per durable Session. */
export interface SessionKeyedRecord {
  durableSessionId: string;
  updatedAt: number;
}

export interface SessionRecordStoreOptions<R> {
  /** What the operator knows this state as, for the unreadable notice. */
  label: string;
  /** The array's key in `{ v: 1, [collection]: R[] }`. */
  collection: string;
  valid: (value: unknown) => value is R;
  maxBytes: number;
}

/**
 * A small main-owned index of one record per durable Session, persisted as
 * `{ v: 1, <collection>: [...] }` with an atomic, serialized replace.
 *
 * The whole file or nothing: one record this build cannot read sets the file
 * aside with its bytes, rather than being dropped by the next save (the rule
 * settings follow since 0.1.13). A file that exists and cannot be read is
 * never written over (BUG-247): changes stay in memory, deletions included,
 * and are merged over the file once a later read succeeds.
 *
 * Mutations are synchronous in memory and then persisted, so a caller that
 * computes from `list()` and commits without awaiting in between can never
 * interleave with another mutation (two launches cannot deal one name).
 */
export class SessionRecordStore<R extends SessionKeyedRecord> {
  private records = new Map<string, R>();
  private initializePromise: Promise<void> | null = null;
  private operationTail: Promise<void> = Promise.resolve();
  private temporarySequence = 0;
  private mutationVersion = 0;
  private persistedVersion = 0;
  private unreadable: ConfigFileUnreadableCause | null = null;
  private pendingDeletes = new Set<string>();
  private readonly watch: UnreadableStateWatch;
  private readonly grammar: ConfigFileGrammar<R[]>;

  constructor(
    private readonly file: string,
    private readonly options: SessionRecordStoreOptions<R>
  ) {
    this.watch = new UnreadableStateWatch(file, options.label);
    this.grammar = jsonStateGrammar<R[]>(value => {
      if (!value || typeof value !== 'object' || Array.isArray(value))
        return null;
      const stored = value as { v?: unknown } & Record<string, unknown>;
      const records = stored[options.collection];
      if (stored.v !== 1 || !Array.isArray(records)) return null;
      return records.every(options.valid) ? (records as R[]) : null;
    }, options.maxBytes);
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
    const read = await readPersistedState(this.file, this.grammar);
    if (read.status === 'unreadable') {
      this.unreadable = read.cause;
      this.watch.failed(read.cause);
      return;
    }
    // Missing, or damaged and set aside with its bytes: a fresh index.
    const disk = new Map<string, R>();
    if (read.status === 'ok') {
      for (const record of read.value)
        disk.set(record.durableSessionId, record);
    }
    const blocked = this.unreadable !== null;
    this.unreadable = null;
    this.watch.recovered();
    // Changes made while the file could not be read win over it.
    for (const id of this.pendingDeletes) disk.delete(id);
    for (const [id, record] of this.records) disk.set(id, record);
    this.pendingDeletes.clear();
    this.records = disk;
    if (blocked && this.persistedVersion < this.mutationVersion) {
      await this.persist().catch(error => {
        console.error(`${this.options.label} checkpoint failed`, error);
      });
    }
  }

  list(): R[] {
    return [...this.records.values()];
  }

  get(durableSessionId: string): R | null {
    return this.records.get(durableSessionId) ?? null;
  }

  /**
   * Set records in memory now and persist them. Callers validate first; an
   * invalid record would make the whole file unreadable to the next launch.
   */
  protected commit(records: readonly R[]): Promise<void> {
    if (records.length === 0) return Promise.resolve();
    for (const record of records) {
      if (!this.options.valid(record)) {
        throw new Error(`Invalid ${this.options.label} record`);
      }
    }
    for (const record of records) {
      this.records.set(record.durableSessionId, record);
    }
    this.mutationVersion += 1;
    return this.persist();
  }

  async delete(durableSessionId: string): Promise<void> {
    await this.initialize();
    if (this.unreadable) this.pendingDeletes.add(durableSessionId);
    if (!this.records.delete(durableSessionId) && !this.unreadable) return;
    this.mutationVersion += 1;
    await this.persist();
  }

  async flush(): Promise<void> {
    await this.operationTail;
    if (this.unreadable) {
      await this.initialize();
      // Still unreadable: the file stays as it is, and what this launch
      // learned is lost with it.
      if (this.unreadable) return;
    }
    // A failed mutation remains dirty in memory; the shutdown checkpoint
    // gets one authoritative retry.
    if (this.persistedVersion < this.mutationVersion) await this.persist();
  }

  private persist(): Promise<void> {
    // Never replace a file that could not be read. The change stays dirty in
    // memory and is written once a read succeeds.
    if (this.unreadable) return Promise.resolve();
    const version = this.mutationVersion;
    const snapshot = { v: 1, [this.options.collection]: this.list() };
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
