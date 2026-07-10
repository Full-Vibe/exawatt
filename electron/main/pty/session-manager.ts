import { EventEmitter } from 'events';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as os from 'os';
import * as pty from 'node-pty';
import { expandTilde, resolveProject } from './project-resolve';
import { ScrollbackStore } from './scrollback-store';

const execFileAsync = promisify(execFile);

/**
 * PTY session manager — the terminal-hosting boundary (decision 0005).
 *
 * Owns one real pseudo-terminal per session in the Electron main process.
 * The product gesture upstream is "ignite an agent" of a harness type; here
 * that resolves to spawning the harness CLI through the user's login shell
 * (GUI apps get a minimal PATH — the login shell restores brew/nvm/etc.).
 *
 * This interface (create/write/resize/kill/list/serialize) is deliberately
 * the ONLY surface the UI sees, so a detachable backend (tmux-style or a
 * standalone daemon) can replace the in-process owner later without UI
 * changes.
 */

export type PtyHarness = 'shell' | 'claude' | 'codex';

export interface PtyCreateOptions {
  harness: PtyHarness;
  /** working directory (worktree) — defaults to the user's home */
  cwd?: string;
  cols?: number;
  rows?: number;
  /** display title; defaults to the harness name */
  title?: string;
  /** revive a previous session: harness resumes its last conversation in
   *  this directory (claude --continue / codex resume --last) */
  resume?: boolean;
}

export interface PtySessionInfo {
  id: string;
  harness: PtyHarness;
  title: string;
  cwd: string;
  /** directory-keyed Project/Project grouping (worktree-aware git root) */
  projectDir: string;
  projectName: string;
  cols: number;
  rows: number;
  startedAt: number;
  exited: boolean;
  exitCode: number | null;
  /** last output timestamp (ENG-015 S2: live status in the switcher) */
  lastDataAt: number;
}

/** harness -> command line run inside the user's login shell */
const HARNESS_COMMAND: Record<Exclude<PtyHarness, 'shell'>, string> = {
  claude: 'claude',
  codex: 'codex',
};

/** harness -> resume command (auto-revive after app restart) */
const HARNESS_RESUME_COMMAND: Record<Exclude<PtyHarness, 'shell'>, string> = {
  claude: 'claude --continue',
  codex: 'codex resume --last',
};

/**
 * The USER'S default (login) shell — fish/zsh/bash/... — not a hardcoded one.
 * Directory services is the source of truth (the SHELL env var lies whenever
 * the app was launched from a different shell or a harness), but every
 * candidate is VALIDATED for executability — a stale UserShell (uninstalled
 * brew shell, Intel-path leftover) must degrade to the next candidate, not
 * brick every ignite. Async: no subprocess/fs waits on the main event loop.
 */
let cachedShell: string | null = null;
async function isExecutable(p: string): Promise<boolean> {
  try {
    await fs.promises.access(p, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
export async function defaultShell(): Promise<string> {
  if (cachedShell) return cachedShell;
  const candidates: string[] = [];
  if (process.platform === 'darwin') {
    try {
      const { stdout } = await execFileAsync('/usr/bin/dscl', [
        '.',
        '-read',
        `/Users/${os.userInfo().username}`,
        'UserShell',
      ]);
      candidates.push(stdout.replace('UserShell:', '').trim());
    } catch {
      // directory services unavailable — fall through to env
    }
  }
  candidates.push((process.env.SHELL || '').trim(), '/bin/zsh');
  for (const c of candidates) {
    if (c && (await isExecutable(c))) {
      cachedShell = c;
      return c;
    }
  }
  cachedShell = '/bin/sh';
  return cachedShell;
}


interface Session {
  proc: pty.IPty;
  info: PtySessionInfo;
}

export class PtySessionManager extends EventEmitter {
  private sessions = new Map<string, Session>();
  /** ~200 KB per session; late panes replay text and S4 reads visit deltas. */
  private scrollback = new ScrollbackStore();
  private nextId = 1;

  // async: cwd validation and shell resolution do I/O — a stat on a dead
  // network mount must hang a threadpool worker, never the main event loop
  async create(options: PtyCreateOptions): Promise<PtySessionInfo> {
    const cwd = expandTilde((options.cwd || '').trim()) || os.homedir();
    // fail loudly BEFORE spawning: node-pty with a bad cwd dies instantly
    // with no output, which reads as "the harness is broken"
    let stat: fs.Stats;
    try {
      stat = await fs.promises.stat(cwd);
    } catch {
      throw new Error(`Working directory does not exist: ${cwd}`);
    }
    if (!stat.isDirectory()) {
      throw new Error(`Not a directory: ${cwd}`);
    }
    const cols = options.cols ?? 80;
    const rows = options.rows ?? 24;
    const shell = await defaultShell();
    const project = await resolveProject(cwd);
    const id = `pty-${this.nextId++}`;

    // plain shell: interactive login shell. Harness: run its CLI through the
    // login shell so PATH (homebrew, nvm, ...) resolves like the user's
    // terminal; when the CLI exits the session ends. Revived harness tabs
    // resume their previous conversation in this directory.
    const args =
      options.harness === 'shell'
        ? ['-l']
        : [
            '-l',
            '-c',
            options.resume
              ? HARNESS_RESUME_COMMAND[options.harness]
              : HARNESS_COMMAND[options.harness],
          ];

    const proc = pty.spawn(shell, args, {
      name: 'xterm-256color',
      cols,
      rows,
      cwd,
      env: {
        ...process.env,
        // programs in the session must see the RESOLVED shell, not whatever
        // environment the app was launched from
        SHELL: shell,
        TERM_PROGRAM: 'Exawatt',
      } as Record<string, string>,
    });

    const info: PtySessionInfo = {
      id,
      harness: options.harness,
      title: options.title || options.harness,
      projectDir: project.projectDir,
      projectName: project.projectName,
      cwd,
      cols,
      rows,
      startedAt: Date.now(),
      exited: false,
      exitCode: null,
      lastDataAt: Date.now(),
    };

    // revived tabs announce themselves: `--continue`/`resume --last` picks
    // the most recent conversation IN THIS DIRECTORY — which may have been
    // started outside Exawatt. Say so instead of looking like a haunting.
    if (options.resume && options.harness !== 'shell') {
      this.appendBuffer(
        id,
        `\x1b[38;5;244m[exawatt] tab revived — resuming the most recent ` +
          `conversation in this directory\x1b[0m\r\n\r\n`
      );
    }

    proc.onData((data) => {
      info.lastDataAt = Date.now();
      this.appendBuffer(id, data);
      this.emit('data', id, data);
    });
    proc.onExit(({ exitCode }) => {
      // kill() may have already removed the session (process death is
      // asynchronous) — never resurrect a deleted buffer or re-broadcast
      // exit state for a session the UI already closed
      if (!this.sessions.has(id)) return;
      info.exited = true;
      info.exitCode = exitCode;
      // the marker goes through the BUFFER (not just live listeners) so a
      // pane attaching after a fast death still shows what happened
      const marker = `\r\n\x1b[38;5;244m[session exited ${exitCode}]\x1b[0m\r\n`;
      this.appendBuffer(id, marker);
      this.emit('data', id, marker);
      this.emit('exit', id, exitCode);
    });

    this.sessions.set(id, { proc, info });
    return { ...info };
  }

  write(id: string, data: string): void {
    const s = this.sessions.get(id);
    if (s && !s.info.exited) s.proc.write(data);
  }

  /** operator rename (W0.4): keeps fleet/spatial names in step with the
   *  workspace tab — sessions are ONE identity across surfaces */
  rename(id: string, title: string): void {
    const s = this.sessions.get(id);
    const next = title.trim();
    if (s && next) s.info.title = next;
  }

  resize(id: string, cols: number, rows: number): void {
    const s = this.sessions.get(id);
    if (!s || s.info.exited) return;
    if (cols > 0 && rows > 0 && Number.isFinite(cols) && Number.isFinite(rows)) {
      s.proc.resize(cols, rows);
      s.info.cols = cols;
      s.info.rows = rows;
    }
  }

  kill(id: string): void {
    const s = this.sessions.get(id);
    if (!s) return;
    if (!s.info.exited) s.proc.kill();
    this.sessions.delete(id);
    this.scrollback.delete(id);
  }

  /** replayable scrollback for a session (empty string if unknown) */
  buffer(id: string): string {
    return this.scrollback.text(id);
  }

  /** Absolute scrollback position used as a last-visited checkpoint. */
  bufferCursor(id: string): number {
    return this.scrollback.cursor(id);
  }

  /** Output produced after a last-visited checkpoint. */
  bufferSince(id: string, cursor: number): { text: string; truncated: boolean } {
    return this.scrollback.since(id, cursor);
  }

  /** single append path: trims to BUFFER_LIMIT, then resyncs at a line
   *  boundary — a raw slice can land mid-escape-sequence or mid-surrogate,
   *  which garbles the top of every replay */
  private appendBuffer(id: string, data: string): void {
    this.scrollback.append(id, data);
  }

  list(): PtySessionInfo[] {
    return Array.from(this.sessions.values(), (s) => ({ ...s.info }));
  }

  /** layout persistence source (W0.2): everything EXCEPT the live process */
  serialize(): PtySessionInfo[] {
    return this.list();
  }

  killAll(): void {
    for (const id of Array.from(this.sessions.keys())) this.kill(id);
  }
}

export const ptySessions = new PtySessionManager();
