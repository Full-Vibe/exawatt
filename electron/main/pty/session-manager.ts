import { EventEmitter } from 'events';
import * as os from 'os';
import * as pty from 'node-pty';

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
  /** initiative label this session belongs to (workspace grouping) */
  initiative?: string;
}

export interface PtySessionInfo {
  id: string;
  harness: PtyHarness;
  title: string;
  initiative: string | null;
  cwd: string;
  cols: number;
  rows: number;
  startedAt: number;
  exited: boolean;
  exitCode: number | null;
}

/** harness -> command line run inside the user's login shell */
const HARNESS_COMMAND: Record<Exclude<PtyHarness, 'shell'>, string> = {
  claude: 'claude',
  codex: 'codex',
};

interface Session {
  proc: pty.IPty;
  info: PtySessionInfo;
}

/** per-session scrollback kept in main so late-attaching panes (tab switch,
 *  renderer reload) can replay output; ~200 KB ≈ a few thousand lines */
const BUFFER_LIMIT = 200_000;

export class PtySessionManager extends EventEmitter {
  private sessions = new Map<string, Session>();
  private buffers = new Map<string, string>();
  private nextId = 1;

  create(options: PtyCreateOptions): PtySessionInfo {
    const id = `pty-${this.nextId++}`;
    const cwd = options.cwd || os.homedir();
    const cols = options.cols ?? 80;
    const rows = options.rows ?? 24;
    const shell = process.env.SHELL || '/bin/zsh';

    // plain shell: interactive login shell. Harness: run its CLI through the
    // login shell so PATH (homebrew, nvm, ...) resolves like the user's
    // terminal; when the CLI exits the session ends.
    const args =
      options.harness === 'shell'
        ? ['-l']
        : ['-l', '-c', HARNESS_COMMAND[options.harness]];

    const proc = pty.spawn(shell, args, {
      name: 'xterm-256color',
      cols,
      rows,
      cwd,
      env: { ...process.env, TERM_PROGRAM: 'Exawatt' } as Record<string, string>,
    });

    const info: PtySessionInfo = {
      id,
      harness: options.harness,
      title: options.title || options.harness,
      initiative: options.initiative ?? null,
      cwd,
      cols,
      rows,
      startedAt: Date.now(),
      exited: false,
      exitCode: null,
    };

    proc.onData((data) => {
      const buf = (this.buffers.get(id) ?? '') + data;
      this.buffers.set(id, buf.length > BUFFER_LIMIT ? buf.slice(-BUFFER_LIMIT) : buf);
      this.emit('data', id, data);
    });
    proc.onExit(({ exitCode }) => {
      info.exited = true;
      info.exitCode = exitCode;
      this.emit('exit', id, exitCode);
    });

    this.sessions.set(id, { proc, info });
    return { ...info };
  }

  write(id: string, data: string): void {
    const s = this.sessions.get(id);
    if (s && !s.info.exited) s.proc.write(data);
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
    this.buffers.delete(id);
  }

  /** replayable scrollback for a session (empty string if unknown) */
  buffer(id: string): string {
    return this.buffers.get(id) ?? '';
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
