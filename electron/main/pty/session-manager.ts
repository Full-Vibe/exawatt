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
import type { HarnessLaunchWiring } from './harness-command';
import { harnessEventChannel } from '../harness-events/channel';
import { HookSettingsStore } from '../harness-events/hook-settings-store';
import {
  SessionHistoryStore,
  type SessionHistorySnapshot,
} from './session-history-store';
import { stopProcessGroups } from './process-groups';
import {
  invalidateResumeCandidates,
  listResumeCandidates,
  reconcileResumeIdentities as reconcilePersistedResumeIdentities,
  opencodeSessionAgent,
  type ReconciledResumeIdentity,
  type ResumeIdentityHint,
} from './resume-candidates';
import { ownerOfCodexCandidate } from './codex-identity-match';
import { planLoginShell } from './login-shell';
import { OrderedWriteBuffer } from './ordered-write-buffer';
import {
  type AgentHarness,
  type AgentPermissionMode,
  type PtyHarness,
} from './harness-types';
import { harnessDescriptor } from './harness-registry';
import { transcriptLines } from './transcript-lines';
import {
  SessionIdentityStore,
  type SessionIdentityRecord,
} from './session-identity-store';

const execFileAsync = promisify(execFile);
const OPENCODE_IDENTITY_TIMEOUT_MS = 20_000;

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

export type { AgentHarness, AgentPermissionMode, PtyHarness };

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
  /** Optional first user task for a newly-created interactive agent. */
  initialPrompt?: string;
  /** Goal statement carried across a resume for context summaries (D21).
   *  Metadata only — never written to the process; a fresh create's
   *  initialPrompt already doubles as the stated task. */
  statedTask?: string;
  /** Persisted goal subtitle re-seeded into the summarizer on resume (D21).
   *  Metadata only — transported to the context summarizer, never here. */
  restoredSubtitle?: string;
  /** Source-agnostic launch policy translated to provider CLI flags. */
  permissionMode?: AgentPermissionMode;
  /** Model choice resolved by the source catalog and pinned for this launch. */
  model?: string;
  /** Reasoning effort resolved beside the model and pinned for this launch. */
  effort?: string;
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
  /** Real path used only for provider identity matching. Keep info.cwd as the
   * operator-entered path for display/persistence, but do not let macOS's
   * /var → /private/var alias make one launch look like two directories. */
  codexIdentityCwd: string;
  codexTrustAccepted: boolean;
  codexIdentityStarted: boolean;
  /** Provider catalog snapshot taken before Codex starts. Reusing this
   * launch boundary is what makes later identity attachment deterministic. */
  codexIdentityBaseline: Set<string> | null;
  /** When the provider was asked to establish this conversation. A delayed
   * first prompt must not be compared with the older PTY process timestamp. */
  codexIdentityBoundaryAt: number;
  codexInput: OrderedWriteBuffer;
  /** OpenCode creates identity on the first submitted turn, not TUI launch. */
  opencodeIdentityStarted: boolean;
  opencodeIdentityBaseline: Set<string> | null;
  opencodeIdentityBoundaryAt: number;
  opencodeInput: OrderedWriteBuffer;
  /** Collision-resistant source-owned marker persisted on the first OpenCode
   * user message and used to prove the provider session belongs to this PTY. */
  opencodeLaunchAgentName: string | null;
  identityShell: string;
  /** The composer's first task, kept for goal-oriented context summaries
   *  (D18): the operator's own words are the best statement of the goal. */
  initialTask?: string;
}

export class PtySessionManager extends EventEmitter {
  private sessions = new Map<string, Session>();
  /** Bounded 4 MB per session; late panes replay text and S4 reads visit deltas. */
  private scrollback = new ScrollbackStore();
  private history: SessionHistoryStore | null = null;
  private identities: SessionIdentityStore | null = null;
  private hookSettings: HookSettingsStore | null = null;
  private nextId = 1;
  private acceptingCreates = true;
  private creating = 0;
  private creatingDurableIds = new Set<string>();
  private claimedCodexIds = new Set<string>();
  private claimedOpencodeIds = new Set<string>();
  private pendingProviderIdentities = new Set<Promise<void>>();
  private pendingProviderIdentityBySession = new Map<string, Promise<void>>();

  async configurePersistence(root: string): Promise<void> {
    this.history = new SessionHistoryStore(root);
    this.identities = new SessionIdentityStore(
      path.join(path.dirname(root), 'session-identities.json')
    );
    this.hookSettings = new HookSettingsStore(
      path.join(path.dirname(root), 'harness-events')
    );
    await Promise.all([
      this.history.initialize(),
      this.identities.initialize(),
      this.hookSettings.initialize(),
    ]);
  }

  /**
   * Subscribe one launch to the harness event channel (ENG-023).
   *
   * Every failure here is silent by design: an unbindable port, an unwritable
   * settings file, or a source with no push mechanism all mean the Session
   * launches normally and simply reports no delegation. A Session must never
   * fail to start because Exawatt wanted to watch it.
   */
  private async subscribeToEventChannel(
    id: string,
    harness: PtyHarness
  ): Promise<HarnessLaunchWiring> {
    if (harness === 'shell') return {};
    const descriptor = harnessDescriptor(harness);
    const channel = descriptor.eventChannel;
    if (!channel || !this.hookSettings) return {};
    if (!(await harnessEventChannel.start())) return {};
    const registration = harnessEventChannel.register(id, channel.normalize);
    if (!registration) return {};
    const settingsPath = await this.hookSettings.write(
      id,
      channel.settings(registration.port, registration.token)
    );
    if (!settingsPath) {
      harnessEventChannel.release(id);
      return {};
    }
    return { eventChannelSettingsPath: settingsPath };
  }

  /** Drop one Session's ephemeral event configuration files. */
  private cleanupHarnessWiring(id: string): void {
    harnessEventChannel.release(id);
    void this.hookSettings?.remove(id);
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
    const canonicalCwd = await fs.promises
      .realpath(cwd)
      .catch(() => path.resolve(cwd));
    const cols = options.cols ?? 80;
    const rows = options.rows ?? 24;
    const shell = await defaultShell();
    const project = await resolveProject(cwd);
    let codexIdentityBaseline: Set<string> | null = null;
    if (options.harness === 'codex' && !options.resumeSessionId) {
      try {
        invalidateResumeCandidates('codex', cwd);
        codexIdentityBaseline = new Set(
          (await listResumeCandidates('codex', cwd)).map(
            candidate => candidate.id
          )
        );
      } catch (error) {
        console.warn('Codex pre-launch identity baseline unavailable', error);
        // The launch-time and nearest-owner constraints below still provide a
        // conservative boundary if the preflight scan was temporarily
        // unavailable. An empty baseline is safer than abandoning identity
        // capture for a composer-launched task that may receive no later input.
        codexIdentityBaseline = new Set();
      }
    }
    let opencodeIdentityBaseline: Set<string> | null = null;
    if (
      options.harness === 'opencode' &&
      !options.resumeSessionId &&
      options.initialPrompt
    ) {
      try {
        opencodeIdentityBaseline = new Set(
          (await listResumeCandidates('opencode', cwd, undefined, shell)).map(
            candidate => candidate.id
          )
        );
      } catch (error) {
        console.warn(
          'OpenCode pre-launch identity baseline unavailable',
          error
        );
        throw new Error(
          `OpenCode launch requires an exact pre-turn session snapshot: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }
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
      options.harness !== 'shell' &&
      harnessDescriptor(options.harness).allocatesFreshSessionId
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
    // Subscribing before spawn is what makes the very first delegated child
    // observable; a channel joined after launch would miss it.
    const opencodeLaunchAgentName =
      options.harness === 'opencode' ? `exawatt-${randomUUID()}` : null;
    const wiring = {
      ...(await this.subscribeToEventChannel(id, options.harness)),
      ...(opencodeLaunchAgentName
        ? { launchAgentName: opencodeLaunchAgentName }
        : {}),
      // Resolved, not realpath'd: the operator-entered path is what the
      // Session displays and what a source keys its own record on, but a
      // relative entry must never reach an argv.
      cwd: path.resolve(cwd),
    };
    let proc: pty.IPty;
    try {
      // `login-shell.ts` owns both halves of this: the per-shell login argv,
      // and the rule that startup files never execute inside the Project (the
      // structural cause of incident `0006`). The Project is entered after
      // startup — as a `cd` prefix here, as fish's `-C` for a plain shell.
      const plan = planLoginShell(shell, {
        command:
          options.harness === 'shell'
            ? null
            : buildHarnessCommand(
                options.harness,
                harnessSessionId,
                !!options.resumeSessionId,
                testHarnessExecutable,
                options.initialPrompt,
                options.permissionMode,
                options.model,
                options.effort,
                wiring
              ),
        directory: cwd,
      });

      proc = pty.spawn(shell, plan.args, {
        name: 'xterm-256color',
        cols,
        rows,
        cwd: plan.cwd,
        env: {
          ...process.env,
          // programs in the session must see the RESOLVED shell, not whatever
          // environment the app was launched from
          SHELL: shell,
          TERM_PROGRAM: 'Exawatt',
        } as Record<string, string>,
      });
    } catch (error) {
      this.cleanupHarnessWiring(id);
      throw error;
    }

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

    const statedTask =
      options.initialPrompt?.trim() || options.statedTask?.trim();
    this.sessions.set(id, {
      proc,
      info,
      codexIdentityCwd: canonicalCwd,
      codexTrustAccepted: false,
      codexIdentityStarted: false,
      codexIdentityBaseline,
      codexIdentityBoundaryAt: info.startedAt,
      codexInput: new OrderedWriteBuffer(),
      opencodeIdentityStarted: false,
      opencodeIdentityBaseline,
      opencodeIdentityBoundaryAt: info.startedAt,
      opencodeInput: new OrderedWriteBuffer(),
      opencodeLaunchAgentName,
      identityShell: shell,
      ...(statedTask ? { initialTask: statedTask } : {}),
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
      // A dead process cannot report anything else, and its token is now
      // worthless — retire both before anyone can reuse the id.
      this.cleanupHarnessWiring(id);
      this.emit('exit', id, exitCode, durableSessionId);
    });

    const session = this.sessions.get(id)!;
    if (harnessSessionId && options.harness !== 'shell') {
      await this.rememberIdentity(info);
    } else if (options.harness === 'codex') {
      // Codex creates its provider identity at launch. Capture from the
      // pre-spawn catalog boundary even when the composer supplied the first
      // task as a CLI argument and no later terminal write ever occurs.
      session.codexIdentityStarted = true;
      invalidateResumeCandidates('codex', cwd);
      this.beginCodexIdentityCapture(session);
    } else if (options.harness === 'opencode' && options.initialPrompt) {
      // `--prompt` submits before the PTY can receive a later write. Capture
      // against the pre-spawn baseline so the exact source id is not lost.
      session.opencodeIdentityStarted = true;
      session.opencodeIdentityBoundaryAt = info.startedAt;
      this.beginOpencodeIdentityCapture(session);
    }

    return { ...info };
  }

  private async rememberIdentity(info: PtySessionInfo): Promise<void> {
    if (info.harness === 'shell' || !info.harnessSessionId) return;
    try {
      await this.identities?.remember({
        durableSessionId: info.durableSessionId,
        harness: info.harness,
        harnessSessionId: info.harnessSessionId,
        cwd: info.cwd,
      });
    } catch (error) {
      // The provider process is already live. Do not turn a transient disk
      // error into a false launch failure (and an orphaned, invisible Agent);
      // the identity store remains dirty and the shutdown checkpoint retries.
      console.error('Session identity checkpoint failed', error);
    }
  }

  private async captureCodexIdentity(
    info: PtySessionInfo,
    before: Set<string>,
    submittedAt = info.startedAt
  ): Promise<void> {
    const deadline = Date.now() + 15_000;
    let retryDelayMs = 100;
    while (
      Date.now() < deadline &&
      this.sessions.has(info.id) &&
      !info.harnessSessionId
    ) {
      invalidateResumeCandidates('codex', info.cwd);
      const candidates = await listResumeCandidates('codex', info.cwd);
      const pending = Array.from(this.sessions.values())
        .filter(
          session =>
            session.info.harness === 'codex' &&
            session.codexIdentityStarted &&
            !session.info.harnessSessionId
        )
        .map(session => ({
          id: session.info.id,
          cwd: session.codexIdentityCwd,
          startedAt: session.codexIdentityBoundaryAt,
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
        await this.rememberIdentity(info);
        this.emit(
          'identity',
          info.id,
          info.durableSessionId,
          info.harnessSessionId
        );
        return;
      }
      await new Promise(resolve => setTimeout(resolve, retryDelayMs));
      retryDelayMs = Math.min(1_600, retryDelayMs * 2);
    }
  }

  write(id: string, data: string): void {
    const s = this.sessions.get(id);
    if (!s || s.info.exited) return;
    if (s.codexInput.hold(data)) return;
    if (s.opencodeInput.hold(data)) return;
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
      s.codexIdentityBoundaryAt = Date.now();
      s.codexInput.begin(data);
      this.beginCodexIdentityCapture(s);
      return;
    }
    if (
      s.info.harness === 'opencode' &&
      !s.info.harnessSessionId &&
      !s.opencodeIdentityStarted &&
      /[\r\n]/.test(data)
    ) {
      s.opencodeIdentityStarted = true;
      s.opencodeIdentityBoundaryAt = Date.now();
      s.opencodeInput.begin(data);
      this.beginOpencodeIdentityCapture(s);
      return;
    }
    s.proc.write(data);
  }

  private beginCodexIdentityCapture(session: Session): void {
    let task!: Promise<void>;
    task = (async () => {
      let before = session.codexIdentityBaseline;
      try {
        if (!before) {
          invalidateResumeCandidates('codex', session.info.cwd);
          before = new Set(
            (await listResumeCandidates('codex', session.info.cwd)).map(
              candidate => candidate.id
            )
          );
          session.codexIdentityBaseline = before;
        }
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
        !this.sessions.has(session.info.id) ||
        session.info.harnessSessionId
      ) {
        return;
      }
      try {
        await this.captureCodexIdentity(
          session.info,
          before ?? new Set<string>(),
          session.codexIdentityBoundaryAt
        );
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
      .finally(() => {
        this.pendingProviderIdentities.delete(task);
        if (
          this.pendingProviderIdentityBySession.get(session.info.id) === task
        ) {
          this.pendingProviderIdentityBySession.delete(session.info.id);
        }
      });
    this.pendingProviderIdentities.add(task);
    this.pendingProviderIdentityBySession.set(session.info.id, task);
  }

  private async captureOpencodeIdentity(
    session: Session,
    before: Set<string>,
    submittedAt = session.info.startedAt,
    deadline = Date.now() + OPENCODE_IDENTITY_TIMEOUT_MS
  ): Promise<'captured' | 'ambiguous' | 'timeout' | 'session-gone'> {
    const info = session.info;
    const launchAgentName = session.opencodeLaunchAgentName;
    if (!launchAgentName) return 'ambiguous';
    let retryDelayMs = 100;
    while (
      Date.now() < deadline &&
      this.sessions.has(info.id) &&
      !info.harnessSessionId
    ) {
      const current = this.sessions.get(info.id);
      if (!current) return 'session-gone';
      let candidates;
      try {
        const remainingMs = deadline - Date.now();
        if (remainingMs <= 0) break;
        candidates = await listResumeCandidates(
          'opencode',
          info.cwd,
          undefined,
          current.identityShell,
          remainingMs
        );
      } catch {
        await new Promise(resolve => setTimeout(resolve, retryDelayMs));
        retryDelayMs = Math.min(1_600, retryDelayMs * 2);
        continue;
      }
      const plausible = candidates.filter(
        candidate =>
          !before.has(candidate.id) &&
          !this.claimedOpencodeIds.has(candidate.id) &&
          candidate.updatedAt >= submittedAt - 2_000 &&
          Math.abs(candidate.startedAt - submittedAt) <= 30_000
      );
      const causalMatches: typeof plausible = [];
      for (const candidate of plausible) {
        const remainingMs = deadline - Date.now();
        if (remainingMs <= 0) break;
        try {
          const agent = await opencodeSessionAgent(
            candidate.id,
            info.cwd,
            current.identityShell,
            remainingMs
          );
          if (agent === launchAgentName) causalMatches.push(candidate);
        } catch {
          // The first message can race the session-list row. Poll until the
          // one absolute deadline rather than weakening to a timing guess.
        }
      }
      if (causalMatches.length > 1) return 'ambiguous';
      const match = causalMatches[0];
      if (match) {
        this.claimedOpencodeIds.add(match.id);
        info.harnessSessionId = match.id;
        await this.rememberIdentity(info);
        this.emit(
          'identity',
          info.id,
          info.durableSessionId,
          info.harnessSessionId
        );
        return 'captured';
      }
      await new Promise(resolve => setTimeout(resolve, retryDelayMs));
      retryDelayMs = Math.min(1_600, retryDelayMs * 2);
    }
    return this.sessions.has(info.id) ? 'timeout' : 'session-gone';
  }

  private beginOpencodeIdentityCapture(session: Session): void {
    let task!: Promise<void>;
    task = (async () => {
      const deadline = Date.now() + OPENCODE_IDENTITY_TIMEOUT_MS;
      let before = session.opencodeIdentityBaseline;
      try {
        if (!before) {
          const remainingMs = deadline - Date.now();
          if (remainingMs <= 0) throw new Error('snapshot deadline elapsed');
          before = new Set(
            (
              await listResumeCandidates(
                'opencode',
                session.info.cwd,
                undefined,
                session.identityShell,
                remainingMs
              )
            ).map(candidate => candidate.id)
          );
          session.opencodeIdentityBaseline = before;
        }
      } catch (error) {
        console.warn('OpenCode identity baseline unavailable', error);
        session.opencodeInput.discard();
        session.opencodeIdentityStarted = false;
        const marker =
          '\r\n\x1b[38;5;214m[exawatt] OpenCode session snapshot failed; your task was not submitted. Try again.\x1b[0m\r\n';
        this.appendBuffer(session.info.id, marker);
        this.emit(
          'data',
          session.info.id,
          marker,
          this.scrollback.cursor(session.info.durableSessionId),
          session.info.durableSessionId
        );
        return;
      }
      session.opencodeInput.release(data => {
        if (!session.info.exited && this.sessions.has(session.info.id)) {
          session.proc.write(data);
        }
      });
      if (
        !this.sessions.has(session.info.id) ||
        session.info.harnessSessionId
      ) {
        return;
      }
      try {
        const result = await this.captureOpencodeIdentity(
          session,
          before ?? new Set<string>(),
          session.opencodeIdentityBoundaryAt,
          deadline
        );
        if (
          result !== 'captured' &&
          result !== 'session-gone' &&
          this.sessions.has(session.info.id) &&
          !session.info.harnessSessionId
        ) {
          const reason =
            result === 'ambiguous'
              ? 'multiple new sessions matched this turn'
              : 'the provider session did not appear before the verification deadline';
          const marker =
            `\r\n\x1b[38;5;214m[exawatt] OpenCode identity was not verified: ${reason}. ` +
            'This Session will not be offered as an exact resume target.\x1b[0m\r\n';
          this.appendBuffer(session.info.id, marker);
          this.emit(
            'data',
            session.info.id,
            marker,
            this.scrollback.cursor(session.info.durableSessionId),
            session.info.durableSessionId
          );
        }
      } catch (error) {
        console.warn('OpenCode identity capture failed', error);
        if (this.sessions.has(session.info.id)) {
          const marker =
            '\r\n\x1b[38;5;214m[exawatt] OpenCode identity verification failed. ' +
            'This Session will not be offered as an exact resume target.\x1b[0m\r\n';
          this.appendBuffer(session.info.id, marker);
          this.emit(
            'data',
            session.info.id,
            marker,
            this.scrollback.cursor(session.info.durableSessionId),
            session.info.durableSessionId
          );
        }
      }
    })()
      .catch(error => {
        session.opencodeIdentityStarted = false;
        console.error('OpenCode submission setup failed', error);
      })
      .finally(() => {
        this.pendingProviderIdentities.delete(task);
        if (
          this.pendingProviderIdentityBySession.get(session.info.id) === task
        ) {
          this.pendingProviderIdentityBySession.delete(session.info.id);
        }
      });
    this.pendingProviderIdentities.add(task);
    this.pendingProviderIdentityBySession.set(session.info.id, task);
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

  /** Stop the process but RETAIN scrollback and history (D23 park) — the
   *  single-session form of stopAll(). The normal onExit path marks the
   *  session exited and appends the exit marker, so adopters and the tab
   *  see honest stopped state; resume works exactly like after app-quit. */
  async stop(id: string): Promise<void> {
    const s = this.sessions.get(id);
    if (!s || s.info.exited) return;
    await stopProcessGroups([s.proc.pid], (_pid, signal) =>
      s.proc.kill(signal)
    );
    await this.flushHistory();
  }

  /** Drop an EXITED session's runtime record (D23 archive): without this,
   *  rehydration would reconstruct the deliberately-closed tab from the
   *  leftover record. Disk history is untouched — the ledger owns it. */
  forgetExited(durableSessionId: string): void {
    const found = Array.from(this.sessions.entries()).find(
      ([, session]) =>
        session.info.durableSessionId === durableSessionId &&
        session.info.exited
    );
    if (!found) return;
    this.sessions.delete(found[0]);
    this.scrollback.delete(durableSessionId);
  }

  /** Delete a session's retained data (D23 ledger reap) — never a live one. */
  async purgeHistory(durableSessionId: string): Promise<void> {
    const live = Array.from(this.sessions.values()).some(
      session =>
        session.info.durableSessionId === durableSessionId &&
        !session.info.exited
    );
    if (live) return;
    this.scrollback.delete(durableSessionId);
    await Promise.all([
      this.history?.delete(durableSessionId),
      this.identities?.delete(durableSessionId),
    ]);
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
    this.cleanupHarnessWiring(id);
    this.scrollback.delete(s.info.durableSessionId);
    await Promise.all([
      this.history?.delete(s.info.durableSessionId),
      this.identities?.delete(s.info.durableSessionId),
    ]);
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
    await Promise.all([
      this.history?.delete(durableSessionId),
      this.identities?.delete(durableSessionId),
    ]);
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

  /** The composer's first task for this session, if one was given (D18). */
  initialTask(id: string): string | null {
    return this.sessions.get(id)?.initialTask ?? null;
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

  /**
   * What a paused Agent needs to describe itself. Deliberately does NOT read
   * the transcript (ENG-016 BUG-012, incident 0008): opening a paused Agent
   * used to JSON-parse megabytes on this process, which is a frozen app, and
   * a record only needs its size and when it stopped.
   */
  async retainedHistoryMeta(
    durableSessionId: string
  ): Promise<{ bytes: number; updatedAt: number; exists: boolean }> {
    const runtime = Array.from(this.sessions.values()).find(
      session => session.info.durableSessionId === durableSessionId
    );
    if (runtime) {
      const text = this.scrollback.text(durableSessionId);
      return {
        bytes: text.length,
        updatedAt: runtime.info.lastDataAt,
        exists: text.length > 0,
      };
    }
    return (
      this.history?.meta(durableSessionId) ?? {
        bytes: 0,
        updatedAt: 0,
        exists: false,
      }
    );
  }

  /**
   * The transcript as readable lines, bounded, and only when the operator
   * asks for it. Rendering happens HERE so megabytes never cross IPC.
   */
  async retainedTranscript(
    durableSessionId: string,
    maxLines = 2_000
  ): Promise<{ lines: string[]; truncated: number; corrupt: boolean }> {
    const history = await this.retainedHistory(durableSessionId);
    const rendered = transcriptLines(history.text, { maxLines });
    return { ...rendered, corrupt: history.corrupt };
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
    await Promise.all([this.history?.flush(), this.identities?.flush()]);
  }

  async reconcileResumeIdentities(
    hints: ResumeIdentityHint[]
  ): Promise<ReconciledResumeIdentity[]> {
    const durable = new Map(
      (this.identities?.list() ?? []).map(record => [
        record.durableSessionId,
        record,
      ])
    );
    const repaired = await reconcilePersistedResumeIdentities(hints, durable);
    for (const identity of repaired) {
      try {
        await this.identities?.remember({
          durableSessionId: identity.durableSessionId,
          harness: identity.harness,
          harnessSessionId: identity.harnessSessionId,
          cwd: identity.cwd,
        });
      } catch (error) {
        // The repaired identity is still returned to the renderer and its
        // normal workspace checkpoint. Keep the main-owned copy dirty for the
        // coordinated shutdown retry rather than losing a valid repair.
        console.error('Reconciled Session identity checkpoint failed', error);
      }
    }
    return repaired;
  }

  /**
   * The whole durable-Session ↔ provider-conversation index, read-only.
   * The E5 consumption snapshot exposes it so the renderer can roll provider
   * conversations up into Exawatt Sessions without re-deriving main's state.
   */
  listProviderIdentities(): SessionIdentityRecord[] {
    return this.identities?.list() ?? [];
  }

  durableProviderIdentity(
    durableSessionId: string,
    harness: string
  ): string | null {
    const identity = this.identities?.get(durableSessionId);
    return identity?.harness === harness ? identity.harnessSessionId : null;
  }

  async settleProviderIdentities(
    timeoutMs = OPENCODE_IDENTITY_TIMEOUT_MS + 2_000
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (this.pendingProviderIdentities.size > 0) {
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) return;
      await Promise.race([
        Promise.allSettled(Array.from(this.pendingProviderIdentities)),
        new Promise(resolve => setTimeout(resolve, remainingMs)),
      ]);
    }
  }

  async settleProviderIdentity(
    sessionId: string,
    timeoutMs = OPENCODE_IDENTITY_TIMEOUT_MS + 2_000
  ): Promise<void> {
    const task = this.pendingProviderIdentityBySession.get(sessionId);
    if (!task) return;
    await Promise.race([
      task,
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
    for (const id of Array.from(this.sessions.keys())) {
      this.cleanupHarnessWiring(id);
      this.sessions.delete(id);
    }
    await this.flushHistory();
  }

  async killAll(): Promise<void> {
    for (const id of Array.from(this.sessions.keys())) await this.kill(id);
  }
}

export const ptySessions = new PtySessionManager();
