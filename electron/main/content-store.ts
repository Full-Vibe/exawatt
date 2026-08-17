import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Content-addressed side store for large per-Session artifacts (BUG-031).
 *
 * The shape this exists to break: a small-object record — ids, titles,
 * lifecycle, a draft the operator is typing — given one unbounded field, on an
 * all-or-nothing write path. `workspace.json` was 4.84 MB, of which 4.81 MB
 * was nineteen inline `data:image/jpeg;base64,…` goal visuals at ~265 KB each,
 * and the whole file was re-serialized, structured-cloned across IPC, written,
 * and echoed BACK to the renderer 400 ms after every composer keystroke burst
 * and on every tab switch. A 265 KB image sat on the same write path as a
 * one-character draft edit.
 *
 * A large artifact belongs beside the layout, not in it: written once under
 * its own id, read on demand, and evicted by an owner. The layout goes back to
 * being small and cheap to rewrite.
 *
 * Every store declares a size class. There is no unbounded constructor:
 * `maxEntries` and `maxBytes` are required, `sweep` is the eviction owner, and
 * it runs where content is WRITTEN rather than where it is read.
 */
export interface ContentStoreOptions {
  /** Directory the store owns outright. Nothing else may write here. */
  directory: () => string;
  /** Hard cap on retained entries. Oldest-written are evicted first. */
  maxEntries: number;
  /** Hard cap on retained bytes. Oldest-written are evicted first. */
  maxBytes: number;
  /**
   * An entry younger than this is never swept as unreferenced. Closes the
   * race between "an artifact was just generated" and "the layout naming it
   * has not been persisted yet".
   */
  orphanGraceMs?: number;
  now?: () => number;
}

const DEFAULT_ORPHAN_GRACE_MS = 10 * 60_000;

interface StoredEntry {
  file: string;
  bytes: number;
  writtenAtMs: number;
}

export class ContentStore {
  private readonly maxEntries: number;
  private readonly maxBytes: number;
  private readonly orphanGraceMs: number;
  private readonly now: () => number;
  private readonly directory: () => string;
  private tail: Promise<void> = Promise.resolve();

  constructor(options: ContentStoreOptions) {
    this.directory = options.directory;
    this.maxEntries = options.maxEntries;
    this.maxBytes = options.maxBytes;
    this.orphanGraceMs = options.orphanGraceMs ?? DEFAULT_ORPHAN_GRACE_MS;
    this.now = options.now ?? (() => Date.now());
  }

  /**
   * A filesystem-safe id for a caller's content key. The caller's key is
   * already a content address in every current tenant, so this only makes it
   * safe to use as a filename — it is not a second hash of the bytes.
   */
  static idFor(key: string): string {
    return crypto.createHash('sha256').update(key, 'utf8').digest('hex');
  }

  private fileFor(key: string): string {
    return path.join(this.directory(), `${ContentStore.idFor(key)}.bin`);
  }

  /** Read one artifact. Absent, unreadable, and evicted are all `null`. */
  async read(key: string): Promise<string | null> {
    try {
      return await fs.promises.readFile(this.fileFor(key), 'utf8');
    } catch {
      return null;
    }
  }

  /**
   * Write once. A key that already holds identical bytes is left alone — the
   * point of a content-addressed store is that the same content is the same
   * file, so a re-render of the same goal costs no disk write.
   */
  async write(key: string, content: string): Promise<void> {
    const target = this.fileFor(key);
    this.tail = this.tail.then(async () => {
      try {
        const existing = await fs.promises
          .readFile(target, 'utf8')
          .catch(() => null);
        if (existing === content) return;
        await fs.promises.mkdir(path.dirname(target), {
          recursive: true,
          mode: 0o700,
        });
        const temporary = `${target}.tmp-${process.pid}`;
        try {
          await fs.promises.writeFile(temporary, content, { mode: 0o600 });
          await fs.promises.rename(temporary, target);
        } finally {
          await fs.promises.rm(temporary, { force: true });
        }
        await this.enforceBound();
      } catch {
        // A side store that cannot be written costs a re-render, never the
        // layout. The layout's reference simply resolves to nothing.
      }
    });
    await this.tail;
  }

  /**
   * The eviction owner. Retains every referenced key, plus anything written
   * within the grace window, then enforces the count and byte bounds
   * oldest-first. Returns the number of files removed.
   */
  async sweep(referenced: Iterable<string>): Promise<number> {
    const keep = new Set<string>();
    for (const key of referenced) keep.add(ContentStore.idFor(key));
    const entries = await this.list();
    const cutoff = this.now() - this.orphanGraceMs;
    let removed = 0;
    const survivors: StoredEntry[] = [];
    for (const entry of entries) {
      const id = path.basename(entry.file, '.bin');
      if (keep.has(id) || entry.writtenAtMs >= cutoff) {
        survivors.push(entry);
        continue;
      }
      if (await this.remove(entry.file)) removed += 1;
    }
    removed += await this.trim(survivors);
    return removed;
  }

  /** Bytes currently retained. Diagnostics and tests. */
  async bytes(): Promise<number> {
    return (await this.list()).reduce((total, entry) => total + entry.bytes, 0);
  }

  private async enforceBound(): Promise<void> {
    await this.trim(await this.list());
  }

  private async trim(entries: StoredEntry[]): Promise<number> {
    const newestFirst = [...entries].sort(
      (left, right) => right.writtenAtMs - left.writtenAtMs
    );
    let bytes = 0;
    let removed = 0;
    for (let index = 0; index < newestFirst.length; index += 1) {
      const entry = newestFirst[index];
      bytes += entry.bytes;
      if (index < this.maxEntries && bytes <= this.maxBytes) continue;
      if (await this.remove(entry.file)) removed += 1;
    }
    return removed;
  }

  private async remove(file: string): Promise<boolean> {
    try {
      await fs.promises.rm(file, { force: true });
      return true;
    } catch {
      return false;
    }
  }

  private async list(): Promise<StoredEntry[]> {
    let names: string[];
    try {
      names = await fs.promises.readdir(this.directory());
    } catch {
      return [];
    }
    const out: StoredEntry[] = [];
    for (const name of names) {
      if (!name.endsWith('.bin')) continue;
      const file = path.join(this.directory(), name);
      try {
        const stat = await fs.promises.stat(file);
        out.push({ file, bytes: stat.size, writtenAtMs: stat.mtimeMs });
      } catch {
        // Raced with an eviction. Nothing to account for.
      }
    }
    return out;
  }
}
