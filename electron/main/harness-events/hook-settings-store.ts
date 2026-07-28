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

function fileName(sessionId: string): string | null {
  // Session ids are Exawatt-generated (`pty-3`), but this value ends up in a
  // filesystem path, so it is validated rather than trusted.
  return /^[A-Za-z0-9_-]{1,64}$/.test(sessionId) ? `${sessionId}.json` : null;
}

export class HookSettingsStore {
  constructor(private readonly directory: string) {}

  /** Creates the directory and clears residue from previous runs. */
  async initialize(): Promise<void> {
    await fs.promises.mkdir(this.directory, { recursive: true, mode: 0o700 });
    let entries: string[];
    try {
      entries = await fs.promises.readdir(this.directory);
    } catch {
      return;
    }
    await Promise.all(
      entries
        .filter(entry => entry.endsWith('.json'))
        .map(entry =>
          fs.promises
            .rm(path.join(this.directory, entry), { force: true })
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

  async remove(sessionId: string): Promise<void> {
    const name = fileName(sessionId);
    if (!name) return;
    await fs.promises
      .rm(path.join(this.directory, name), { force: true })
      .catch(() => {});
  }
}
