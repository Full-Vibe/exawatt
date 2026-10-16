import { createHash } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  __resetSqliteSnapshotsForTests,
  readSqliteSnapshot,
} from './sqlite-snapshot';

const directories: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  __resetSqliteSnapshotsForTests();
  for (const directory of directories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

/** A WAL database its owner holds open, with rows only in the log. */
function liveStore() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'exawatt-snap-'));
  directories.push(directory);
  const file = path.join(directory, 'state.sqlite');
  const owner = new DatabaseSync(file);
  owner.exec(
    "PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; CREATE TABLE t (v TEXT); INSERT INTO t VALUES ('a')"
  );
  return { directory, file, owner };
}

function manifest(directory: string): string {
  return fs
    .readdirSync(directory)
    .sort()
    .map(name => {
      const bytes = fs.readFileSync(path.join(directory, name));
      return `${name} ${createHash('sha256').update(bytes).digest('hex')}`;
    })
    .join('\n');
}

const values = (file: string) =>
  readSqliteSnapshot(file, database =>
    (
      database.prepare('SELECT v FROM t ORDER BY v').all() as Array<{
        v: string;
      }>
    ).map(row => row.v)
  );

describe('readSqliteSnapshot', () => {
  it('reads the log, off the synchronous copy, and writes nothing to the store', async () => {
    const { directory, file, owner } = liveStore();
    try {
      const before = manifest(directory);
      expect(before).toContain('state.sqlite-wal');
      const copySync = vi.spyOn(fs, 'copyFileSync');
      const pending = values(file);
      expect(pending).toBeInstanceOf(Promise);
      expect(await pending).toEqual(['a']);
      expect(copySync).not.toHaveBeenCalled();
      expect(manifest(directory)).toBe(before);
    } finally {
      owner.close();
    }
  });

  it('reuses the snapshot while the database and its log are unchanged', async () => {
    const { file, owner } = liveStore();
    try {
      const copy = vi.spyOn(fs.promises, 'copyFile');
      expect(await values(file)).toEqual(['a']);
      const copiesForFirstRead = copy.mock.calls.length;
      expect(copiesForFirstRead).toBeGreaterThan(0);
      expect(await values(file)).toEqual(['a']);
      expect(copy.mock.calls.length).toBe(copiesForFirstRead);

      // A write the owner has not checkpointed changes only the log: only
      // the log is copied again.
      owner.exec("INSERT INTO t VALUES ('b')");
      expect(await values(file)).toEqual(['a', 'b']);
      const logOnly = copy.mock.calls.slice(copiesForFirstRead);
      expect(logOnly.map(([source]) => String(source))).toEqual([
        `${file}-wal`,
      ]);

      // A checkpoint changes the database itself: a whole new copy.
      owner.exec("INSERT INTO t VALUES ('c'); PRAGMA wal_checkpoint(TRUNCATE)");
      const beforeCheckpointRead = copy.mock.calls.length;
      expect(await values(file)).toEqual(['a', 'b', 'c']);
      expect(
        copy.mock.calls
          .slice(beforeCheckpointRead)
          .map(([source]) => String(source))
      ).toContain(file);
    } finally {
      owner.close();
    }
  });

  it('takes a fresh copy after a read of the snapshot fails', async () => {
    const { file, owner } = liveStore();
    try {
      const copy = vi.spyOn(fs.promises, 'copyFile');
      await expect(
        readSqliteSnapshot(file, () => {
          throw new Error('torn');
        })
      ).rejects.toThrow('torn');
      const afterFailure = copy.mock.calls.length;
      expect(await values(file)).toEqual(['a']);
      expect(copy.mock.calls.length).toBeGreaterThan(afterFailure);
    } finally {
      owner.close();
    }
  });
});
