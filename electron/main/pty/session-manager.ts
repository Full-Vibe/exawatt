import { EventEmitter } from 'events';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as pty from 'node-pty';
import { expandTilde, resolveProject } from './project-resolve';
import { ScrollbackStore } from './scrollback-store';
import { randomUUID } from 'crypto';
import { buildHarnessCommand } from './harness-command';
import {
  SessionHistoryStore,
  type SessionHistorySnapshot,
} from './session-history-store';
import { stopProcessGroups } from './process-groups';
import { listResumeCandidates } from './resume-candidates';
import { ownerOfCodexCandidate } from './codex-identity-match';
import { OrderedWriteBuffer } from './ordered-write-buffer';

const execFileAsync = promisify(execFile);

/**
 * PTY session manager — the terminal-hosting boundary (decision 0005).
 *
 * Owns one real pseudo-terminal per session in the Electron main process.
 * The product gesture upstream is "launch an agent" of a harness type; here
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
  /** Exact provider conversation ID. Presence means resume that ID. */
  resumeSessionId?: string;
  /** Stable Exawatt Session identity; survives PTY process replacement. */
  durableSessionId?: string;
}

export interface PtySessionInfo {
  id: string;
  durableSessionId: string;
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
  /** Durable provider identity; unlike `id`, survives a new PTY process. */
  harnessSessionId: string | null;
}

/**
 * The USER'S default (login) shell — fish/zsh/bash/... — not a hardcoded one.
 * Directory services is the source of truth (the SHELL env var lies whenever
 * the app was launched from a different shell or a harness), but every
 * candidate is VALIDATED for executability — a stale UserShell (uninstalled
 * brew shell, Intel-path leftover) must degrade to the next candidate, not
 * brick every launch. Async: no subprocess/fs waits on the main event loop.
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
  codexTrustAccepted: boolean;
  codexIdentityStarted: boolean;
  codexInput: OrderedWriteBuffer;
}

export class PtySessionManager extends EventEmitter {
  private sessions = new Map<string, Session>();
  /** Bounded 4 MB per session; late panes replay text and S4 reads visit deltas. */
  private scrollback = new ScrollbackStore();
  private history: SessionHistoryStore | null = null;
  private nextId = 1;
  private acceptingCreates = true;
  private creating = 0;
  private creatingDurableIds = new Set<string>();
  private claimedCodexIds = new Set<string>();
  private pendingCodexIdentities = new Set<Promise<void>>();

  async configurePersistence(root: string): Promise<void> {
    this.history = new SessionHistoryStore(root);
    await this.history.initialize();
  }

  pauseCreates(): void {
    this.acceptingCreates = false;
  }

  resumeCreates(): void {
    this.acceptingCreates = true;
  }

  async create(options: PtyCreateOptions): Promise<PtySessionInfo> {
    if (!this.acceptingCreates) throw new Error('Exawatt is stopping Sessions');
    const durableSessionId =
      options.durableSessionId ?? `session-${randomUUID()}`;
    if (this.creatingDurableIds.has(durableSessionId)) {
      throw new Error('This Session is already starting');
    }
    this.creating += 1;
    this.creatingDurableIds.add(durableSessionId);
    try {
      return await this.createUnlocked(options, durableSessionId);
    } finally {
      this.creating -= 1;
      this.creatingDurableIds.delete(durableSessionId);
    }
  }

  // async: cwd validation and shell resolution do I/O — a stat on a dead
  // network mount must hang a threadpool worker, never the main event loop
  private async createUnlocked(
    options: PtyCreateOptions,
    durableSessionId: string
  ): Promise<PtySessionInfo> {
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
    const existing = Array.from(this.sessions.entries()).find(
      ([, session]) => session.info.durableSessionId === durableSessionId
    );
    if (existing && !existing[1].info.exited) {
      throw new Error('This Session already has a running process');
    }
    if (existing) this.sessions.delete(existing[0]);
    const retained = this.history
      ? await this.history.load(durableSessionId)
      : { text: '', cursor: 0, updatedAt: 0, corrupt: false };
    this.scrollback.seed(durableSessionId, retained.text, retained.cursor);
    const harnessSessionId =
      options.harness === 'claude'
        ? (options.resumeSessionId ?? randomUUID())
        : (options.resumeSessionId ?? null);
    const testHarnessExecutable =
      process.env.EXAWATT_TEST === '1' &&
      process.env.EXAWATT_TEST_HARNESS_BIN &&
      path.isAbsolute(process.env.EXAWATT_TEST_HARNESS_BIN)
        ? path.join(process.env.EXAWATT_TEST_HARNESS_BIN, options.harness)
        : undefined;

    // plain shell: interactive login shell. Harness: run its CLI through the
    // login shell so PATH (homebrew, nvm, ...) resolves like the user's
    // terminal; when the CLI exits the session ends. A resume command always
    // names one exact provider conversation; recency is never identity.
    const args =
      options.harness === 'shell'
        ? ['-l']
        : [
            '-l',
            '-c',
            buildHarnessCommand(
              options.harness,
              harnessSessionId,
              !!options.resumeSessionId,
              testHarnessExecutable
            ),
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
      durableSessionId,
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
      harnessSessionId,
    };

    this.sessions.set(id, {
      proc,
      info,
      codexTrustAccepted: false,
      codexIdentityStarted: false,
      codexInput: new OrderedWriteBuffer(),
    });

    if (options.resumeSessionId && options.harness !== 'shell') {
      this.appendBuffer(
        id,
        `\x1b[38;5;244m[exawatt] resuming exact ${options.harness} ` +
          `conversation ${options.resumeSessionId}\x1b[0m\r\n\r\n`
      );
    }

    proc.onData(data => {
      info.lastDataAt = Date.now();
      this.appendBuffer(id, data);
      this.emit(
        'data',
        id,
        data,
        this.scrollback.cursor(durableSessionId),
        durableSessionId
      );
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
      this.emit(
        'data',
        id,
        marker,
        this.scrollback.cursor(durableSessionId),
        durableSessionId
      );
      this.emit('exit', id, exitCode, durableSessionId);
    });

    return { ...info };
  }

  private async captureCodexIdentity(
    info: PtySessionInfo,
    before: Set<string>,
    submittedAt = info.startedAt
  ): Promise<void> {
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline && !info.exited && !info.harnessSessionId) {
      const candidates = await listResumeCandidates('codex', info.cwd);
      const pending = Array.from(this.sessions.values())
        .filter(
          session =>
            session.info.harness === 'codex' &&
            session.codexIdentityStarted &&
            !session.info.harnessSessionId &&
            !session.info.exited
        )
        .map(session => ({
          id: session.info.id,
          cwd: session.info.cwd,
          startedAt: session.info.startedAt,
        }));
      const match = candidates
        .filter(
          candidate =>
            !before.has(candidate.id) &&
            !this.claimedCodexIds.has(candidate.id) &&
            candidate.updatedAt >= submittedAt - 2_000 &&
            Math.abs(candidate.startedAt - info.startedAt) <= 30_000 &&
            ownerOfCodexCandidate(pending, candidate) === info.id
        )
        .sort(
          (a, b) =>
            Math.abs(a.startedAt - info.startedAt) -
              Math.abs(b.startedAt - info.startedAt) ||
            b.updatedAt - a.updatedAt
        )[0];
      if (match) {
        this.claimedCodexIds.add(match.id);
        info.harnessSessionId = match.id;
        this.emit(
          'identity',
          info.id,
          info.durableSessionId,
          info.harnessSessionId
        );
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }

  write(id: string, data: string): void {
    const s = this.sessions.get(id);
    if (!s || s.info.exited) return;
    if (s.codexInput.hold(data)) return;
    if (
      s.info.harness === 'codex' &&
      !s.info.harnessSessionId &&
      !s.codexIdentityStarted &&
      /[\r\n]/.test(data)
    ) {
      const output = this.scrollback
        .text(s.info.durableSessionId)
        .toLowerCase();
      if (
        !s.codexTrustAccepted &&
        output.includes('trust') &&
        output.includes('press')
      ) {
        s.codexTrustAccepted = true;
        s.proc.write(data);
        return;
      }
      s.codexIdentityStarted = true;
      s.codexInput.begin(data);
      this.beginCodexIdentityCapture(s);
      return;
    }
    s.proc.write(data);
  }

  private beginCodexIdentityCapture(session: Session): void {
    let task!: Promise<void>;
    task = (async () => {
      let before = new Set<string>();
      try {
        before = new Set(
          (await listResumeCandidates('codex', session.info.cwd)).map(
            candidate => candidate.id
          )
        );
      } catch (error) {
        console.warn('Codex identity baseline unavailable', error);
      } finally {
        session.codexInput.release(data => {
          if (!session.info.exited && this.sessions.has(session.info.id)) {
            session.proc.write(data);
          }
        });
      }
      if (
        session.info.exited ||
        !this.sessions.has(session.info.id) ||
        session.info.harnessSessionId
      ) {
        return;
      }
      try {
        const submittedAt = Date.now();
        await this.captureCodexIdentity(session.info, before, submittedAt);
      } catch (error) {
        console.warn('Codex identity capture failed', error);
      }
      if (!session.info.harnessSessionId) session.codexIdentityStarted = false;
    })()
      .catch(error => {
        // Never let catalog I/O turn a terminal write into an unhandled rejection.
        session.codexIdentityStarted = false;
        console.error('Codex submission setup failed', error);
      })
      .finally(() => this.pendingCodexIdentities.delete(task));
    this.pendingCodexIdentities.add(task);
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
    if (
      cols > 0 &&
      rows > 0 &&
      Number.isFinite(cols) &&
      Number.isFinite(rows)
    ) {
      s.proc.resize(cols, rows);
      s.info.cols = cols;
      s.info.rows = rows;
    }
  }

  async kill(id: string): Promise<void> {
    const s = this.sessions.get(id);
    if (!s) return;
    if (!s.info.exited) {
      await stopProcessGroups([s.proc.pid], (_pid, signal) =>
        s.proc.kill(signal)
      );
    }
    this.sessions.delete(id);
    this.scrollback.delete(s.info.durableSessionId);
    await this.history?.delete(s.info.durableSessionId);
  }

  async deleteSession(durableSessionId: string): Promise<void> {
    const runtime = Array.from(this.sessions.entries()).find(
      ([, session]) => session.info.durableSessionId === durableSessionId
    );
    if (runtime) {
      await this.kill(runtime[0]);
      return;
    }
    this.scrollback.delete(durableSessionId);
    await this.history?.delete(durableSessionId);
  }

  /** replayable scrollback for a session (empty string if unknown) */
  buffer(id: string): string {
    const durableId = this.sessions.get(id)?.info.durableSessionId;
    return durableId ? this.scrollback.text(durableId) : '';
  }

  bufferSnapshot(id: string): { text: string; cursor: number } {
    const durableId = this.sessions.get(id)?.info.durableSessionId;
    return {
      text: durableId ? this.scrollback.text(durableId) : '',
      cursor: durableId ? this.scrollback.cursor(durableId) : 0,
    };
  }

  /** Absolute scrollback position used as a last-visited checkpoint. */
  bufferCursor(id: string): number {
    const durableId = this.sessions.get(id)?.info.durableSessionId;
    return durableId ? this.scrollback.cursor(durableId) : 0;
  }

  /** Output produced after a last-visited checkpoint. */
  bufferSince(
    id: string,
    cursor: number
  ): { text: string; truncated: boolean } {
    const durableId = this.sessions.get(id)?.info.durableSessionId;
    return durableId
      ? this.scrollback.since(durableId, cursor)
      : { text: '', truncated: false };
  }

  /** single append path: trims to BUFFER_LIMIT, then resyncs at a line
   *  boundary — a raw slice can land mid-escape-sequence or mid-surrogate,
   *  which garbles the top of every replay */
  private appendBuffer(id: string, data: string): void {
    const durableId = this.sessions.get(id)?.info.durableSessionId;
    if (!durableId) return;
    this.scrollback.append(durableId, data);
    this.history?.queue(durableId, {
      text: this.scrollback.text(durableId),
      cursor: this.scrollback.cursor(durableId),
      updatedAt: Date.now(),
    });
  }

  list(): PtySessionInfo[] {
    return Array.from(this.sessions.values(), s => ({ ...s.info }));
  }

  /** layout persistence source (W0.2): everything EXCEPT the live process */
  serialize(): PtySessionInfo[] {
    return this.list();
  }

  async retainedHistory(
    durableSessionId: string
  ): Promise<SessionHistorySnapshot> {
    const runtime = Array.from(this.sessions.values()).find(
      session => session.info.durableSessionId === durableSessionId
    );
    if (runtime) {
      return {
        text: this.scrollback.text(durableSessionId),
        cursor: this.scrollback.cursor(durableSessionId),
        updatedAt: runtime.info.lastDataAt,
        corrupt: false,
      };
    }
    return (
      this.history?.load(durableSessionId) ?? {
        text: '',
        cursor: 0,
        updatedAt: 0,
        corrupt: false,
      }
    );
  }

  async flushHistory(): Promise<void> {
    await this.history?.flush();
  }

  async settleProviderIdentities(timeoutMs = 2_000): Promise<void> {
    if (this.pendingCodexIdentities.size === 0) return;
    await Promise.race([
      Promise.allSettled(Array.from(this.pendingCodexIdentities)),
      new Promise(resolve => setTimeout(resolve, timeoutMs)),
    ]);
  }

  async stopAll(): Promise<void> {
    this.pauseCreates();
    while (this.creating > 0) {
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    const active = Array.from(this.sessions.entries()).filter(
      ([, session]) => !session.info.exited
    );
    await stopProcessGroups(
      active.map(([, session]) => session.proc.pid),
      (pid, signal) => {
        const target = active.find(([, session]) => session.proc.pid === pid);
        target?.[1].proc.kill(signal);
      }
    );
    for (const id of Array.from(this.sessions.keys())) this.sessions.delete(id);
    await this.flushHistory();
  }

  async killAll(): Promise<void> {
    for (const id of Array.from(this.sessions.keys())) await this.kill(id);
  }
}

export const ptySessions = new PtySessionManager();
