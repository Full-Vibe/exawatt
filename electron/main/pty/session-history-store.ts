import * as fs from 'fs';
import * as path from 'path';

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

const EMPTY: SessionHistorySnapshot = {
  text: '',
  cursor: 0,
  updatedAt: 0,
  corrupt: false,
};
const COMPACT_JOURNAL_BYTES = 8 * 1024 * 1024;

function validSessionId(id: string): boolean {
  return /^[A-Za-z0-9._-]{1,200}$/.test(id);
}

function stored(
  snapshot: Omit<SessionHistorySnapshot, 'corrupt'>
): StoredHistoryV1 {
  return { v: 1, ...snapshot };
}

/**
 * Crash-safe, machine-local terminal history keyed by logical Session.
 *
 * Disk mutations are serialized. New output is appended to a journal and the
 * bounded snapshot is compacted periodically, so steady-state writes scale with
 * new output rather than rewriting the full retained terminal four times/sec.
 */
export class SessionHistoryStore {
  private readonly dirty = new Map<string, StoredHistoryV1>();
  private readonly persisted = new Map<string, StoredHistoryV1>();
  private readonly journalBytes = new Map<string, number>();
  private readonly deleted = new Set<string>();
  private timer: NodeJS.Timeout | null = null;
  private operationTail: Promise<void> = Promise.resolve();
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

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const running = this.operationTail.then(operation, operation);
    this.operationTail = running.then(
      () => undefined,
      () => undefined
    );
    return running;
  }

  async load(id: string): Promise<SessionHistorySnapshot> {
    this.file(id);
    if (this.deleted.has(id)) return { ...EMPTY };
    return this.serialize(() => this.loadUnlocked(id));
  }

  private async loadUnlocked(id: string): Promise<SessionHistorySnapshot> {
    let current: StoredHistoryV1 = { v: 1, ...EMPTY };
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
      current = raw as StoredHistoryV1;
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
        if (record.cursor <= current.cursor) continue;
        if (
          record.fromCursor !== current.cursor ||
          record.cursor - record.fromCursor !== record.text.length ||
          record.retainedLength < 0 ||
          record.retainedLength > current.text.length + record.text.length
        ) {
          return { ...EMPTY, corrupt: true };
        }
        const combined = current.text + record.text;
        current = {
          v: 1,
          text: combined.slice(combined.length - record.retainedLength),
          cursor: record.cursor,
          updatedAt: record.updatedAt,
        };
      }
      this.journalBytes.set(id, Buffer.byteLength(journal));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        return { ...EMPTY, corrupt: true };
      }
      this.journalBytes.set(id, 0);
    }
    this.persisted.set(id, current);
    return {
      text: current.text,
      cursor: current.cursor,
      updatedAt: current.updatedAt,
      corrupt: false,
    };
  }

  queue(id: string, snapshot: Omit<SessionHistorySnapshot, 'corrupt'>): void {
    this.file(id);
    if (this.deleted.has(id)) return;
    this.dirty.set(id, stored(snapshot));
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
    await this.serialize(async () => {
      while (this.dirty.size > 0) {
        const batch = Array.from(this.dirty.entries());
        for (const [id, record] of batch) {
          if (this.dirty.get(id) === record) this.dirty.delete(id);
          if (!this.deleted.has(id)) await this.persist(id, record);
        }
      }
    });
  }

  async delete(id: string): Promise<void> {
    this.file(id);
    this.deleted.add(id);
    this.dirty.delete(id);
    await this.serialize(async () => {
      this.dirty.delete(id);
      await Promise.all([
        fs.promises.rm(this.file(id), { force: true }),
        fs.promises.rm(this.journal(id), { force: true }),
      ]);
      this.persisted.delete(id);
      this.journalBytes.delete(id);
    });
  }

  private async persist(id: string, next: StoredHistoryV1): Promise<void> {
    let previous = this.persisted.get(id);
    if (!previous) {
      const loaded = await this.loadUnlocked(id);
      if (loaded.corrupt) {
        await this.replace(id, next);
        return;
      }
      previous = stored(loaded);
    }

    const previousStart = previous.cursor - previous.text.length;
    const nextStart = next.cursor - next.text.length;
    const overlapStart = Math.max(previousStart, nextStart);
    const appendOnly =
      next.cursor >= previous.cursor &&
      nextStart <= previous.cursor &&
      previous.text.slice(overlapStart - previousStart) ===
        next.text.slice(overlapStart - nextStart, previous.cursor - nextStart);
    if (!appendOnly || (previous.cursor === 0 && previous.text.length === 0)) {
      await this.replace(id, next);
      return;
    }

    const delta = next.text.slice(previous.cursor - nextStart);
    if (delta.length === 0) {
      this.persisted.set(id, next);
      return;
    }
    const record: JournalRecordV1 = {
      v: 1,
      fromCursor: previous.cursor,
      cursor: next.cursor,
      retainedLength: next.text.length,
      text: delta,
      updatedAt: next.updatedAt,
    };
    const line = `${JSON.stringify(record)}\n`;
    await fs.promises.appendFile(this.journal(id), line, {
      encoding: 'utf8',
      mode: 0o600,
    });
    await fs.promises.chmod(this.journal(id), 0o600);
    const bytes = (this.journalBytes.get(id) ?? 0) + Buffer.byteLength(line);
    this.journalBytes.set(id, bytes);
    this.persisted.set(id, next);
    if (bytes >= COMPACT_JOURNAL_BYTES) await this.replace(id, next);
  }

  private async replace(id: string, record: StoredHistoryV1): Promise<void> {
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
      this.persisted.set(id, record);
    } finally {
      await fs.promises.rm(temporary, { force: true });
    }
  }
}
