/**
 * Read another program's SQLite database without writing a byte of its
 * store (BUG-287), and without holding up the main thread to do it.
 *
 * Opening a WAL-mode database with `readOnly: true` is not read-only on
 * disk: when the owner is not running, SQLite creates `-shm` and `-wal`
 * beside the database and leaves them there; when the owner is running, a
 * reader marks its slot inside the owner's `-shm`. Codex's `state_5.sqlite`
 * and Antigravity's `conversation_summaries.db` are both WAL databases, and
 * ENG-046's invariant is that no harness store is ever written. So the read
 * runs against a private copy of the database and its write-ahead log.
 *
 * The copy is asynchronous, so a large store never blocks every window
 * while it is copied. It asks for a clone (`COPYFILE_FICLONE`), which a
 * copy-on-write filesystem libuv can clone on honours; measured 2026-10-16,
 * Node's libuv answers `COPYFILE_FICLONE_FORCE` with ENOSYS on macOS, so on
 * APFS this is an ordinary copy on the thread pool. The copy is kept, keyed
 * by the identity, size and modification time of the database and of its
 * log, each on its own: a read while the owner has written nothing reuses
 * it; a write the owner has not checkpointed changes only the log, and only
 * the log is copied again; a checkpoint changes the database and takes a
 * whole new copy. The copy is opened read-only, so it stays byte-identical
 * to the database it was copied from and a newer log can be laid over it.
 * Reads of one store run one at a time, so a copy never changes under a
 * read.
 *
 * A copy taken while the owner checkpoints can be torn; the read then fails
 * like any unreadable store, the copy is dropped, and the next read takes a
 * fresh one.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';

interface Snapshot {
  directory: string;
  copy: string;
  /** The source database's and its log's state when each was copied. */
  databaseState: string;
  logState: string;
}

const snapshots = new Map<string, Snapshot>();
const queues = new Map<string, Promise<void>>();
let cleanupRegistered = false;

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === 'ENOENT';
}

async function fileState(file: string, optional: boolean): Promise<string> {
  try {
    const stat = await fs.promises.stat(file);
    return `${stat.ino}:${stat.size}:${stat.mtimeMs}`;
  } catch (error) {
    if (optional && isMissing(error)) return 'none';
    throw error;
  }
}

/** The database and its log, as of now. Taken before copying, so a change
 *  during the copy only makes the next read copy again. */
async function sourceState(
  file: string
): Promise<{ databaseState: string; logState: string }> {
  const [databaseState, logState] = await Promise.all([
    fileState(file, false),
    fileState(`${file}-wal`, true),
  ]);
  return { databaseState, logState };
}

/** The log holds every transaction the owner has not checkpointed yet. The
 *  shared-memory index is rebuilt from it, so it is never copied, and a
 *  replaced log drops the copy's stale index. */
async function copyLog(file: string, copy: string): Promise<void> {
  await Promise.all([
    fs.promises.rm(`${copy}-wal`, { force: true }),
    fs.promises.rm(`${copy}-shm`, { force: true }),
  ]);
  try {
    await fs.promises.copyFile(
      `${file}-wal`,
      `${copy}-wal`,
      fs.constants.COPYFILE_FICLONE
    );
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
}

function discard(snapshot: Snapshot): void {
  void fs.promises
    .rm(snapshot.directory, { recursive: true, force: true })
    .catch(() => undefined);
}

function registerCleanup(): void {
  if (cleanupRegistered) return;
  cleanupRegistered = true;
  process.once('exit', () => {
    for (const snapshot of snapshots.values()) {
      fs.rmSync(snapshot.directory, { recursive: true, force: true });
    }
  });
}

async function takeSnapshot(
  file: string,
  state: { databaseState: string; logState: string }
): Promise<Snapshot> {
  const directory = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), 'exawatt-sqlite-')
  );
  try {
    const copy = path.join(directory, path.basename(file));
    await fs.promises.copyFile(file, copy, fs.constants.COPYFILE_FICLONE);
    await copyLog(file, copy);
    registerCleanup();
    return { directory, copy, ...state };
  } catch (error) {
    await fs.promises.rm(directory, { recursive: true, force: true });
    throw error;
  }
}

function forget(file: string): void {
  const snapshot = snapshots.get(file);
  if (!snapshot) return;
  snapshots.delete(file);
  discard(snapshot);
}

async function readOnce<T>(
  file: string,
  read: (database: DatabaseSync) => T
): Promise<T> {
  let state: Awaited<ReturnType<typeof sourceState>>;
  let snapshot = snapshots.get(file);
  try {
    state = await sourceState(file);
    if (!snapshot || snapshot.databaseState !== state.databaseState) {
      forget(file);
      snapshot = await takeSnapshot(file, state);
      snapshots.set(file, snapshot);
    } else if (snapshot.logState !== state.logState) {
      await copyLog(file, snapshot.copy);
      snapshot.logState = state.logState;
    }
  } catch (error) {
    forget(file);
    throw error;
  }
  try {
    // Read-only, so the copy never folds the log into itself and stays the
    // database it was copied from (its `-shm` lands in our directory).
    const database = new DatabaseSync(snapshot.copy, { readOnly: true });
    try {
      return read(database);
    } finally {
      database.close();
    }
  } catch (error) {
    forget(file);
    throw error;
  }
}

export function readSqliteSnapshot<T>(
  file: string,
  read: (database: DatabaseSync) => T
): Promise<T> {
  const previous = queues.get(file) ?? Promise.resolve();
  const result = previous.then(() => readOnce(file, read));
  const settled = result.then(
    () => undefined,
    () => undefined
  );
  queues.set(file, settled);
  void settled.then(() => {
    if (queues.get(file) === settled) queues.delete(file);
  });
  return result;
}

/** Test seam: drop every kept copy. */
export function __resetSqliteSnapshotsForTests(): void {
  for (const snapshot of snapshots.values()) {
    fs.rmSync(snapshot.directory, { recursive: true, force: true });
  }
  snapshots.clear();
  queues.clear();
}
