/**
 * Per-launch harness settings files (ENG-023 D1).
 *
 * The injected document carries a bearer token, so it is written inside
 * Exawatt's own state directory with owner-only permissions — never into the
 * user's harness configuration, which Exawatt does not modify.
 *
 * Files are per launch and swept on startup: a token from a previous run is
 * already meaningless (the channel mints fresh ones and binds a fresh port),
 * so leaving one on disk is pure residue.
 */
import fs from 'fs';
import path from 'path';

/** Owner read/write only — the file contains a live channel token. */
const FILE_MODE = 0o600;

const SESSION_ID = /^[A-Za-z0-9_-]{1,64}$/;

function fileName(sessionId: string): string | null {
  // Session ids are Exawatt-generated (`pty-3`), but this value ends up in a
  // filesystem path, so it is validated rather than trusted.
  return SESSION_ID.test(sessionId) ? `${sessionId}.json` : null;
}

/** A launch's directory, for sources that scan a workspace directory for
 *  their document instead of taking a file path. */
function directoryName(sessionId: string): string | null {
  return SESSION_ID.test(sessionId) ? sessionId : null;
}

export class HookSettingsStore {
  constructor(private readonly directory: string) {}

  /** Creates the directory and clears residue from previous runs. */
  async initialize(): Promise<void> {
    await fs.promises.mkdir(this.directory, { recursive: true, mode: 0o700 });
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(this.directory, {
        withFileTypes: true,
      });
    } catch {
      return;
    }
    await Promise.all(
      entries
        .filter(
          entry =>
            (entry.isFile() && entry.name.endsWith('.json')) ||
            (entry.isDirectory() && SESSION_ID.test(entry.name))
        )
        .map(entry =>
          fs.promises
            .rm(path.join(this.directory, entry.name), {
              force: true,
              recursive: true,
            })
            .catch(() => {})
        )
    );
  }

  /**
   * Write one launch's settings. Returns the path to pass to the harness, or
   * null when it could not be written — the launch then simply reports no
   * delegation instead of failing.
   */
  async write(sessionId: string, contents: string): Promise<string | null> {
    const name = fileName(sessionId);
    if (!name) return null;
    const target = path.join(this.directory, name);
    try {
      await fs.promises.writeFile(target, contents, {
        encoding: 'utf8',
        mode: FILE_MODE,
      });
      // writeFile's mode applies only on creation; an existing file from an
      // earlier launch of the same id keeps its old permissions otherwise.
      await fs.promises.chmod(target, FILE_MODE);
      return target;
    } catch {
      return null;
    }
  }

  /**
   * Write one launch's document inside a directory of its own, for a source
   * that scans a workspace directory for `relativeFile` (Antigravity's
   * `.agents/hooks.json`, handed over with `--add-dir`). Returns the
   * DIRECTORY to pass to the harness, or null when it could not be written.
   * Same custody as `write`: owner-only, inside Exawatt's state.
   */
  async writeDirectory(
    sessionId: string,
    relativeFile: string,
    contents: string
  ): Promise<string | null> {
    const name = directoryName(sessionId);
    if (!name) return null;
    const directory = path.join(this.directory, name);
    const target = path.resolve(directory, relativeFile);
    // The relative file is adapter code, not input, but a path that escaped
    // the launch directory would write outside Exawatt's state.
    if (!target.startsWith(directory + path.sep)) return null;
    try {
      await fs.promises.mkdir(path.dirname(target), {
        recursive: true,
        mode: 0o700,
      });
      await fs.promises.writeFile(target, contents, {
        encoding: 'utf8',
        mode: FILE_MODE,
      });
      await fs.promises.chmod(target, FILE_MODE);
      return directory;
    } catch {
      return null;
    }
  }

  async remove(sessionId: string): Promise<void> {
    const name = fileName(sessionId);
    if (!name) return;
    await Promise.all([
      fs.promises
        .rm(path.join(this.directory, name), { force: true })
        .catch(() => {}),
      fs.promises
        .rm(path.join(this.directory, sessionId), {
          force: true,
          recursive: true,
        })
        .catch(() => {}),
    ]);
  }
}
