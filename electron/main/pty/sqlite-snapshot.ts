/**
 * Read another program's SQLite database without writing a byte of its
 * store (BUG-287).
 *
 * Opening a WAL-mode database with `readOnly: true` is not read-only on
 * disk: when the owner is not running, SQLite creates `-shm` and `-wal`
 * beside the database and leaves them there; when the owner is running, a
 * reader marks its slot inside the owner's `-shm`. Codex's `state_5.sqlite`
 * and Antigravity's `conversation_summaries.db` are both WAL databases, and
 * ENG-046's invariant is that no harness store is ever written. So the read
 * runs against a private copy of the database and its write-ahead log in a
 * temporary directory that is removed afterwards.
 *
 * A copy taken while the owner checkpoints can be torn; the read then fails
 * like any unreadable store, and the next read takes a fresh copy.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';

export function readSqliteSnapshot<T>(
  file: string,
  read: (database: DatabaseSync) => T
): T {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'exawatt-sqlite-'));
  try {
    const copy = path.join(directory, path.basename(file));
    fs.copyFileSync(file, copy);
    // The log holds every transaction the owner has not checkpointed yet;
    // the shared-memory index is rebuilt from it, so it is never copied.
    try {
      fs.copyFileSync(`${file}-wal`, `${copy}-wal`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const database = new DatabaseSync(copy);
    try {
      return read(database);
    } finally {
      database.close();
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}
