import * as fs from 'fs';
import * as path from 'path';
import {
  detach,
  TranscriptWindow,
  type TranscriptSource,
} from './transcript-window';

export interface SessionHistorySnapshot {
  text: string;
  cursor: number;
  updatedAt: number;
  corrupt: boolean;
}

interface StoredHistoryV1 {
  v: 1;
  text: string;
  cursor: number;
  updatedAt: number;
}

interface JournalRecordV1 {
  v: 1;
  fromCursor: number;
  cursor: number;
  retainedLength: number;
  text: string;
  updatedAt: number;
}

/**
 * What the store remembers about a Session it has already written. It holds
 * cursors and a short tail, never the transcript: the point of the journal is
 * that steady-state persistence costs the delta, and keeping a megabyte per
 * paused Session in this map to compare against would give that back.
 */
interface PersistedRecord {
  cursor: number;
  length: number;
  updatedAt: number;
  tail: string;
}

interface QueuedSource {
  source: TranscriptSource;
  updatedAt: number;
}

const EMPTY: SessionHistorySnapshot = {
  text: '',
  cursor: 0,
  updatedAt: 0,
  corrupt: false,
};
const COMPACT_JOURNAL_BYTES = 8 * 1024 * 1024;
/**
 * How much of the overlap between the persisted snapshot and the live window
 * is verified before a delta is journalled as a continuation. The structural
 * checks (monotone cursor, no gap) do the real work; this catches a window
 * that was replaced with different content behind the same cursor.
 */
const CONTINUITY_TAIL = 4096;

function validSessionId(id: string): boolean {
  return /^[A-Za-z0-9._-]{1,200}$/.test(id);
}

/**
 * Crash-safe, machine-local terminal history keyed by logical Session.
 *
 * Disk mutations are serialized. New output is appended to a journal and the
 * bounded snapshot is compacted periodically, so steady-state writes scale with
 * new output rather than rewriting the full retained terminal four times/sec.
 */
export class SessionHistoryStore {
  private readonly dirty = new Map<string, QueuedSource>();
  private readonly persisted = new Map<string, PersistedRecord>();
  private readonly journalBytes = new Map<string, number>();
  private readonly deleted = new Set<string>();
  private timer: NodeJS.Timeout | null = null;
  private readonly operationTails = new Map<string, Promise<void>>();
  private temporarySequence = 0;

  constructor(
    private readonly root: string,
    private readonly flushDelayMs = 250
  ) {}

  async initialize(): Promise<void> {
    await fs.promises.mkdir(this.root, { recursive: true, mode: 0o700 });
    await fs.promises.chmod(this.root, 0o700);
  }

  private file(id: string): string {
    if (!validSessionId(id)) throw new Error('Invalid durable Session ID');
    return path.join(this.root, `${id}.json`);
  }

  private journal(id: string): string {
    this.file(id);
    return path.join(this.root, `${id}.journal`);
  }

  /**
   * Serialized PER SESSION, not globally (ENG-016 BUG-012, incident 0008).
   * One shared tail meant a fleet of paused Agents queued every load and
   * every journal write behind each other, so one large transcript delayed
   * everyone — on the main process, where a queue is a frozen app. Disk
   * safety only ever needed ordering within a session's own files.
   */
  private serialize<T>(id: string, operation: () => Promise<T>): Promise<T> {
    const tail = this.operationTails.get(id) ?? Promise.resolve();
    const running = tail.then(operation, operation);
    const settled = running.then(
      () => undefined,
      () => undefined
    );
    this.operationTails.set(id, settled);
    // Drop a Session's tail once it is idle, so the map does not grow one
    // entry per Session for the life of the process.
    void settled.then(() => {
      if (this.operationTails.get(id) === settled) {
        this.operationTails.delete(id);
      }
    });
    return running;
  }

  /**
   * What a paused Agent needs to describe itself, WITHOUT reading the
   * transcript (ENG-016 BUG-013). `stat` is O(1); parsing the record is not,
   * because the transcript lives inside the JSON envelope and is retained to
   * megabytes. This is the call the interaction path makes.
   */
  async meta(id: string): Promise<{
    bytes: number;
    updatedAt: number;
    exists: boolean;
  }> {
    this.file(id);
    if (this.deleted.has(id)) return { bytes: 0, updatedAt: 0, exists: false };
    const queued = this.dirty.get(id);
    const pending = queued
      ? { length: queued.source.length, updatedAt: queued.updatedAt }
      : this.persisted.get(id);
    const [snapshot, journal] = await Promise.all([
      fs.promises.stat(this.file(id)).catch(() => null),
      fs.promises.stat(this.journal(id)).catch(() => null),
    ]);
    if (!snapshot && !journal) {
      return pending
        ? {
            bytes: pending.length,
            updatedAt: pending.updatedAt,
            exists: pending.length > 0,
          }
        : { bytes: 0, updatedAt: 0, exists: false };
    }
    // Bytes on disk include the JSON envelope; the in-memory record is exact
    // when we have one, and the file size is the honest estimate otherwise.
    const bytes = pending
      ? pending.length
      : (snapshot?.size ?? 0) + (journal?.size ?? 0);
    const updatedAt = Math.max(
      pending?.updatedAt ?? 0,
      snapshot?.mtimeMs ?? 0,
      journal?.mtimeMs ?? 0
    );
    return { bytes, updatedAt, exists: bytes > 0 };
  }

  async load(id: string): Promise<SessionHistorySnapshot> {
    this.file(id);
    if (this.deleted.has(id)) return { ...EMPTY };
    return this.serialize(id, () => this.loadUnlocked(id));
  }

  /**
   * Replay costs the journal's BYTES, not records x window (ENG-016 BUG-023).
   *
   * The window is unbounded here on purpose: each record states the exact
   * retained length the writer held, and `trimTo` reproduces it by advancing
   * a head offset. Rebuilding the window per record — `(text + delta).slice(
   * -retainedLength)` — is what made resuming one of the operator's real
   * Sessions ~10,000 rebuilds of a saturated 4 MB window.
   */
  private async loadUnlocked(id: string): Promise<SessionHistorySnapshot> {
    const window = new TranscriptWindow(Number.POSITIVE_INFINITY);
    let cursor = 0;
    let updatedAt = 0;
    try {
      const raw = JSON.parse(
        await fs.promises.readFile(this.file(id), 'utf8')
      ) as Partial<StoredHistoryV1>;
      if (
        raw.v !== 1 ||
        typeof raw.text !== 'string' ||
        typeof raw.cursor !== 'number' ||
        !Number.isFinite(raw.cursor) ||
        raw.cursor < raw.text.length ||
        typeof raw.updatedAt !== 'number'
      ) {
        return { ...EMPTY, corrupt: true };
      }
      window.seed(raw.text, raw.cursor);
      cursor = raw.cursor;
      updatedAt = raw.updatedAt;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        return { ...EMPTY, corrupt: true };
      }
    }

    try {
      const journal = await fs.promises.readFile(this.journal(id), 'utf8');
      const completeLines = journal.endsWith('\n')
        ? journal.slice(0, -1).split('\n')
        : journal.split('\n').slice(0, -1);
      for (const line of completeLines) {
        if (!line) continue;
        const record = JSON.parse(line) as Partial<JournalRecordV1>;
        if (
          record.v !== 1 ||
          typeof record.fromCursor !== 'number' ||
          typeof record.cursor !== 'number' ||
          typeof record.retainedLength !== 'number' ||
          typeof record.text !== 'string' ||
          typeof record.updatedAt !== 'number'
        ) {
          return { ...EMPTY, corrupt: true };
        }
        if (record.cursor <= cursor) continue;
        if (
          record.fromCursor !== cursor ||
          record.cursor - record.fromCursor !== record.text.length ||
          record.retainedLength < 0 ||
          record.retainedLength > window.length + record.text.length
        ) {
          return { ...EMPTY, corrupt: true };
        }
        window.append(record.text);
        window.trimTo(record.retainedLength);
        cursor = record.cursor;
        updatedAt = record.updatedAt;
      }
      this.journalBytes.set(id, Buffer.byteLength(journal));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        return { ...EMPTY, corrupt: true };
      }
      this.journalBytes.set(id, 0);
    }
    this.persisted.set(id, this.observe(window, updatedAt));
    return { text: window.text(), cursor, updatedAt, corrupt: false };
  }

  /**
   * Read a live window's position and its continuity tail in ONE synchronous
   * step. The source keeps growing while a write is in flight, so anything
   * read after an `await` describes a different moment than the record just
   * written — and recording a cursor ahead of what was journalled leaves a gap
   * the next record starts after, which replays as corrupt history.
   */
  private observe(
    source: TranscriptSource,
    updatedAt: number
  ): PersistedRecord {
    return {
      cursor: source.cursor,
      length: source.length,
      updatedAt,
      tail: source.tail(CONTINUITY_TAIL),
    };
  }

  /**
   * Register a Session's LIVE transcript for persistence.
   *
   * The caller hands over the window itself rather than a copy of its text
   * (ENG-016 BUG-024). The old contract took `{ text, cursor, updatedAt }` on
   * every PTY chunk, which meant joining the whole retained window once per
   * chunk and then slicing it twice more per flush to find the delta.
   */
  queue(id: string, source: TranscriptSource, updatedAt: number): void {
    this.file(id);
    if (this.deleted.has(id)) return;
    this.dirty.set(id, { source, updatedAt });
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush().catch(error =>
        console.error('Session history flush failed', error)
      );
    }, this.flushDelayMs);
    this.timer.unref?.();
  }

  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    await this.initialize();
    // Each Session persists on its own tail, so a fleet-wide flush costs the
    // slowest single Session instead of the sum of all of them.
    while (this.dirty.size > 0) {
      const batch = Array.from(this.dirty.entries());
      await Promise.all(
        batch.map(([id, entry]) => {
          if (this.dirty.get(id) === entry) this.dirty.delete(id);
          if (this.deleted.has(id)) return Promise.resolve();
          return this.serialize(id, () => this.persist(id, entry));
        })
      );
    }
  }

  async delete(id: string): Promise<void> {
    this.file(id);
    this.deleted.add(id);
    this.dirty.delete(id);
    await this.serialize(id, async () => {
      this.dirty.delete(id);
      await Promise.all([
        fs.promises.rm(this.file(id), { force: true }),
        fs.promises.rm(this.journal(id), { force: true }),
      ]);
      this.persisted.delete(id);
      this.journalBytes.delete(id);
    });
  }

  private async persist(id: string, entry: QueuedSource): Promise<void> {
    let previous = this.persisted.get(id);
    if (!previous) {
      const loaded = await this.loadUnlocked(id);
      if (loaded.corrupt) {
        await this.replace(id, entry);
        return;
      }
      previous = this.persisted.get(id);
    }

    // One synchronous observation of the live window. Everything below —
    // the continuation test, the delta, the record, and what is remembered
    // afterwards — describes THIS moment, never a later one.
    const { source } = entry;
    const observed = this.observe(source, entry.updatedAt);
    const cursor = observed.cursor;
    const length = observed.length;
    const nextStart = cursor - length;
    const previousStart = previous ? previous.cursor - previous.length : 0;
    const overlapStart = Math.max(previousStart, nextStart);
    const verify = previous
      ? Math.min(previous.cursor - overlapStart, CONTINUITY_TAIL)
      : 0;
    const continues =
      !!previous &&
      cursor >= previous.cursor &&
      nextStart <= previous.cursor &&
      (verify <= 0 ||
        previous.tail.slice(previous.tail.length - verify) ===
          source.range(previous.cursor - verify, verify));
    if (
      !continues ||
      !previous ||
      (previous.cursor === 0 && previous.length === 0)
    ) {
      await this.replace(id, entry);
      return;
    }

    const delta = source.range(previous.cursor, cursor - previous.cursor);
    if (delta.length === 0) {
      this.persisted.set(id, observed);
      return;
    }
    if (delta.length !== cursor - previous.cursor) {
      // The window trimmed past the persisted cursor between the checks and
      // the read; a partial delta would journal a lie, so rewrite instead.
      await this.replace(id, entry);
      return;
    }
    const record: JournalRecordV1 = {
      v: 1,
      fromCursor: previous.cursor,
      cursor: previous.cursor + delta.length,
      retainedLength: length,
      text: delta,
      updatedAt: entry.updatedAt,
    };
    const line = `${JSON.stringify(record)}\n`;
    await fs.promises.appendFile(this.journal(id), line, {
      encoding: 'utf8',
      mode: 0o600,
    });
    await fs.promises.chmod(this.journal(id), 0o600);
    const bytes = (this.journalBytes.get(id) ?? 0) + Buffer.byteLength(line);
    this.journalBytes.set(id, bytes);
    this.persisted.set(id, observed);
    if (bytes >= COMPACT_JOURNAL_BYTES) await this.replace(id, entry);
  }

  /**
   * Rewrite the whole snapshot and drop the journal. This is the one path that
   * materialises the transcript, and it runs on compaction and first write, not
   * per chunk.
   */
  private async replace(id: string, entry: QueuedSource): Promise<void> {
    const text = entry.source.text();
    const cursor = entry.source.cursor;
    const record: StoredHistoryV1 = {
      v: 1,
      text,
      cursor,
      updatedAt: entry.updatedAt,
    };
    const destination = this.file(id);
    const temporary = `${destination}.tmp-${process.pid}-${++this.temporarySequence}`;
    try {
      await fs.promises.writeFile(temporary, JSON.stringify(record), {
        encoding: 'utf8',
        mode: 0o600,
      });
      await fs.promises.chmod(temporary, 0o600);
      await fs.promises.rename(temporary, destination);
      await fs.promises.chmod(destination, 0o600);
      await fs.promises.rm(this.journal(id), { force: true });
      this.journalBytes.set(id, 0);
      this.persisted.set(id, {
        cursor,
        length: text.length,
        updatedAt: entry.updatedAt,
        tail: detach(text.slice(Math.max(0, text.length - CONTINUITY_TAIL))),
      });
    } finally {
      await fs.promises.rm(temporary, { force: true });
    }
  }
}
