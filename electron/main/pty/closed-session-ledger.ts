import { readJsonDocument, writeJsonFileAtomic } from '../atomic-json-file';
import type { ClosedSessionEntry } from '@exawatt/core/desktop-bridge';

/**
 * Recently-closed Session ledger (ENG-016 D23).
 *
 * Closing a stopped tab is a soft delete: the Session's identity (title,
 * goal, provider conversation id, project, stated task) lands here while
 * its retained terminal history stays on disk. "Reopen closed Session"
 * takes the entry back and the tab resurrects whole. Entries past the
 * retention window are reaped — only then is retained history deleted,
 * making the reap the app's ONLY destroyer of session data.
 *
 * Pure Node (no Electron imports) so it unit-tests directly.
 */

export const CLOSED_SESSION_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;

interface StoredLedgerV1 {
  v: 1;
  entries: ClosedSessionEntry[];
}

function validEntry(e: unknown): e is ClosedSessionEntry {
  if (typeof e !== 'object' || e === null) return false;
  const entry = e as Record<string, unknown>;
  return (
    typeof entry.durableSessionId === 'string' &&
    entry.durableSessionId.length > 0 &&
    typeof entry.title === 'string' &&
    (entry.titleKind === undefined ||
      entry.titleKind === 'default' ||
      entry.titleKind === 'operator') &&
    typeof entry.harness === 'string' &&
    typeof entry.cwd === 'string' &&
    typeof entry.projectDir === 'string' &&
    typeof entry.projectName === 'string' &&
    typeof entry.closedAt === 'number' &&
    (entry.goal === null || typeof entry.goal === 'string') &&
    (entry.harnessSessionId === null ||
      typeof entry.harnessSessionId === 'string') &&
    (entry.initialTask === null || typeof entry.initialTask === 'string')
  );
}

function validLedger(value: unknown): boolean {
  const ledger = value as Partial<StoredLedgerV1> | null;
  return (
    ledger?.v === 1 &&
    Array.isArray(ledger.entries) &&
    ledger.entries.every(validEntry)
  );
}

export class ClosedSessionLedger {
  private entries: ClosedSessionEntry[] | null = null;

  constructor(
    private readonly file: string,
    /** deletes a session's retained history — called only at reap time */
    private readonly purgeHistory: (durableSessionId: string) => Promise<void>,
    private readonly now: () => number = () => Date.now(),
    private readonly retentionMs: number = CLOSED_SESSION_RETENTION_MS
  ) {}

  private load(): ClosedSessionEntry[] {
    if (this.entries) return this.entries;
    const raw = readJsonDocument(
      this.file,
      validLedger
    ) as StoredLedgerV1 | null;
    this.entries = raw?.entries ?? [];
    return this.entries;
  }

  private persist(entries: ClosedSessionEntry[]): void {
    const stored: StoredLedgerV1 = { v: 1, entries };
    writeJsonFileAtomic(this.file, stored);
    this.entries = entries;
  }

  /** newest first — the palette's listing order */
  list(): ClosedSessionEntry[] {
    return [...this.load()].sort((a, b) => b.closedAt - a.closedAt);
  }

  add(entry: Omit<ClosedSessionEntry, 'closedAt'>): ClosedSessionEntry {
    const stamped: ClosedSessionEntry = { ...entry, closedAt: this.now() };
    if (!validEntry(stamped)) {
      throw new Error('invalid closed-session entry');
    }
    readJsonDocument(this.file, validLedger);
    // re-closing the same durable Session replaces its older entry
    const next = this.load().filter(
      candidate => candidate.durableSessionId !== entry.durableSessionId
    );
    next.push(stamped);
    this.persist(next);
    return stamped;
  }

  /** remove and return an entry for reopen — history stays untouched */
  take(durableSessionId: string): ClosedSessionEntry | null {
    readJsonDocument(this.file, validLedger);
    const entries = this.load();
    const entry = entries.find(
      candidate => candidate.durableSessionId === durableSessionId
    );
    if (!entry) return null;
    this.persist(entries.filter(candidate => candidate !== entry));
    return entry;
  }

  /** delete expired entries AND their retained history */
  async reap(): Promise<number> {
    const cutoff = this.now() - this.retentionMs;
    readJsonDocument(this.file, validLedger);
    const entries = this.load();
    const expired = entries.filter(entry => entry.closedAt <= cutoff);
    if (expired.length === 0) return 0;
    this.persist(entries.filter(entry => entry.closedAt > cutoff));
    for (const entry of expired) {
      try {
        await this.purgeHistory(entry.durableSessionId);
      } catch {
        // a failed purge must not resurrect the entry or halt the reap;
        // the orphaned history file is retried implicitly if the session
        // id ever re-enters the ledger
      }
    }
    return expired.length;
  }
}
