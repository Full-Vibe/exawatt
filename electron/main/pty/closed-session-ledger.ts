import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';

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

export interface ClosedSessionEntry {
  durableSessionId: string;
  title: string;
  /** Optional for v1 ledger compatibility; current writers preserve whether
   * the title was the default identity or an explicit operator rename. */
  titleKind?: 'default' | 'operator';
  /** goal subtitle at close time (D21 durable goal) */
  goal: string | null;
  harness: string;
  cwd: string;
  projectDir: string;
  projectName: string;
  /** provider conversation id — exact resume works after reopen */
  harnessSessionId: string | null;
  /** the composer's stated task (re-anchors the summarizer on resume) */
  initialTask: string | null;
  closedAt: number;
}

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
    try {
      const raw = JSON.parse(
        fs.readFileSync(this.file, 'utf8')
      ) as StoredLedgerV1;
      this.entries =
        raw?.v === 1 && Array.isArray(raw.entries)
          ? raw.entries.filter(validEntry)
          : [];
    } catch {
      // missing or corrupt ledger = empty; a broken file must never block
      // closing tabs
      this.entries = [];
    }
    return this.entries;
  }

  private persist(): void {
    const stored: StoredLedgerV1 = { v: 1, entries: this.load() };
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp-${process.pid}-${randomUUID()}`;
    try {
      fs.writeFileSync(tmp, JSON.stringify(stored), {
        mode: 0o600,
        flag: 'wx',
      });
      fs.renameSync(tmp, this.file);
    } finally {
      fs.rmSync(tmp, { force: true });
    }
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
    // re-closing the same durable Session replaces its older entry
    this.entries = this.load().filter(
      candidate => candidate.durableSessionId !== entry.durableSessionId
    );
    this.entries.push(stamped);
    this.persist();
    return stamped;
  }

  /** remove and return an entry for reopen — history stays untouched */
  take(durableSessionId: string): ClosedSessionEntry | null {
    const entries = this.load();
    const entry = entries.find(
      candidate => candidate.durableSessionId === durableSessionId
    );
    if (!entry) return null;
    this.entries = entries.filter(candidate => candidate !== entry);
    this.persist();
    return entry;
  }

  /** delete expired entries AND their retained history */
  async reap(): Promise<number> {
    const cutoff = this.now() - this.retentionMs;
    const entries = this.load();
    const expired = entries.filter(entry => entry.closedAt <= cutoff);
    if (expired.length === 0) return 0;
    this.entries = entries.filter(entry => entry.closedAt > cutoff);
    this.persist();
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
