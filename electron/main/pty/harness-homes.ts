import * as os from 'os';
import * as path from 'path';
import { LOGIN_ENVIRONMENT_KEYS } from './harness-state-variables';
import { defaultShell, loginShellFamily, runLoginShell } from './login-shell';

/**
 * Where each harness keeps its state, resolved the way the operator's
 * terminal resolves it (BUG-297).
 *
 * A harness reads its home from variables its user typically sets in a
 * shell startup file (`CODEX_HOME`, `CLAUDE_CONFIG_DIR`, `GROK_HOME`,
 * `QWEN_HOME`). A Finder-launched app inherits none of them, so a reader
 * that consults `process.env` (or, worse, fixes a path when its module
 * loads) reads `~/.codex` while Codex writes somewhere else. Every reader
 * of a harness's own store therefore takes an environment, and the default
 * one is `harnessEnvironment()`: the login shell's, shared and reused
 * briefly. The path rules below are each harness's own, in one place.
 */

/** What the login shell said about each key: a value, or unset. */
type LoginVariables = ReadonlyMap<string, string | null>;

/** Why a probe produced no answer. Each is a failure, never "nothing set". */
type LoginEnvironmentFailure =
  | 'timed-out'
  | 'no-answer'
  | 'exit-status'
  | 'overflowed';

type LoginRead =
  | { ok: true; variables: LoginVariables }
  | { ok: false; failure: LoginEnvironmentFailure; exitCode: number | null };

/**
 * Where the environment starts in the probe's output. Shell startup may print
 * to stdout first; it cannot print a NUL.
 */
const ENVIRONMENT_MARK = '\0EXAWATT_LOGIN_ENVIRONMENT\0';

/**
 * The probe asks the shell to run two executables and expand nothing. Every
 * family parses this line alike: fish, csh and PowerShell reject POSIX
 * `${KEY-}` at parse time, and that probe printed nothing for a fish user
 * (BUG-297's fix did nothing on the operator's Mac). `env -0` separates
 * entries with NUL, so a value with a newline in it survives.
 */
const ENVIRONMENT_PROBE =
  "/usr/bin/printf '\\0EXAWATT_LOGIN_ENVIRONMENT\\0'; /usr/bin/env -0";

const PROBE_MAX_BYTES = 1024 * 1024;

/** The declared keys out of `env -0` output; `null` when the output does not
 *  hold a complete environment. */
function parseLoginEnvironment(stdout: string): LoginVariables | null {
  const start = stdout.indexOf(ENVIRONMENT_MARK);
  if (start < 0) return null;
  const entries = stdout.slice(start + ENVIRONMENT_MARK.length).split('\0');
  // The last piece is not NUL-terminated: empty, or whatever a logout file
  // printed after the environment.
  entries.pop();
  if (entries.length === 0) return null;
  const found = new Map<string, string>();
  for (const entry of entries) {
    const separator = entry.indexOf('=');
    if (separator < 1) continue;
    found.set(entry.slice(0, separator), entry.slice(separator + 1));
  }
  return new Map(
    LOGIN_ENVIRONMENT_KEYS.map(key => [key, found.get(key) || null])
  );
}

async function readLoginVariables(
  shell: string,
  cwd: string,
  timeoutMs: number
): Promise<LoginRead> {
  let result: Awaited<ReturnType<typeof runLoginShell>>;
  try {
    result = await runLoginShell(shell, ENVIRONMENT_PROBE, {
      cwd,
      timeout: timeoutMs,
      maxBuffer: PROBE_MAX_BYTES,
    });
  } catch {
    // A shell that could not even be spawned answered nothing.
    return { ok: false, failure: 'no-answer', exitCode: null };
  }
  const failed = (failure: LoginEnvironmentFailure): LoginRead => ({
    ok: false,
    failure,
    exitCode: result.exitCode,
  });
  if (result.timedOut) return failed('timed-out');
  if (result.overflowed) return failed('overflowed');
  const variables = parseLoginEnvironment(result.stdout);
  if (!variables) return failed('no-answer');
  if (result.exitCode !== 0) return failed('exit-status');
  return { ok: true, variables };
}

/** This process's environment now, with the login shell's answers over it.
 *  A key the shell leaves unset is unset here too: the shell is the
 *  authority on what the operator's harness will see. */
function overProcessEnvironment(
  variables: LoginVariables | null
): NodeJS.ProcessEnv {
  const resolved: NodeJS.ProcessEnv = { ...process.env };
  for (const [key, value] of variables ?? []) {
    if (value) resolved[key] = value;
    else delete resolved[key];
  }
  return resolved;
}

/** Long enough that a burst of reads spawns one shell, short enough that an
 *  edited startup file is followed without a relaunch. */
const LOGIN_ENVIRONMENT_TTL_MS = 60_000;
/** After a failed probe with no earlier answer, how long reads use this
 *  process's environment before a shell is asked again. */
const LOGIN_ENVIRONMENT_RETRY_MS = 10_000;
const LOGIN_ENVIRONMENT_TIMEOUT_MS = 2_000;
const LOGIN_ENVIRONMENT_MAX_CONTEXTS = 64;

interface LoginEnvironmentEntry {
  answer: { variables: LoginVariables; at: number } | null;
  probe: Promise<void> | null;
  failedAt: number | null;
  /** The current run of failures has been logged. */
  reported: boolean;
}

type LoginEnvironmentRecorder = (
  event: string,
  fields?: Record<string, unknown>
) => void;

/** The entry's answer over this process's environment; read after a probe
 *  settles, so not narrowed by what was true before it. */
function environmentOf(entry: LoginEnvironmentEntry): NodeJS.ProcessEnv {
  return overProcessEnvironment(entry.answer?.variables ?? null);
}

const consoleRecorder: LoginEnvironmentRecorder = (event, fields) =>
  console.warn(`[${event}]`, fields);

/**
 * The one owner of "what does the operator's login shell set", per shell and
 * directory.
 *
 * A probe has three outcomes and they never blur: an answer (cached for a
 * minute); a failure (timed out, exit status, output with no environment),
 * which is logged once per run of failures and never stored as an answer;
 * and, while a failure stands, the previous answer when there is one, else
 * this process's environment, with which of the two was used in the log.
 *
 * `current` is stale-while-revalidate: once there is an answer, a read never
 * waits on a shell. Only the very first read of a context waits, and the app
 * warms its home context at start (`warmHarnessEnvironment`), so a launch
 * does not run a login shell to learn where Codex keeps its sessions.
 */
export class LoginEnvironmentResolver {
  private readonly entries = new Map<string, LoginEnvironmentEntry>();
  private readonly deadlineMs: () => number;
  private record: LoginEnvironmentRecorder;

  constructor(
    options: {
      /** How long one probe may take; read at each probe. */
      deadlineMs?: () => number;
      record?: LoginEnvironmentRecorder;
    } = {}
  ) {
    this.deadlineMs =
      options.deadlineMs ?? (() => LOGIN_ENVIRONMENT_TIMEOUT_MS);
    this.record = options.record ?? consoleRecorder;
  }

  configureDiagnostics(record: LoginEnvironmentRecorder): void {
    this.record = record;
  }

  /** The best answer now; refreshes a stale one in the background. */
  async current(
    shell: string,
    cwd: string,
    now = Date.now()
  ): Promise<NodeJS.ProcessEnv> {
    const entry = this.entryFor(shell, cwd);
    const retrying =
      entry.failedAt !== null &&
      now - entry.failedAt < LOGIN_ENVIRONMENT_RETRY_MS;
    if (entry.answer) {
      if (now - entry.answer.at >= LOGIN_ENVIRONMENT_TTL_MS && !retrying) {
        void this.probe(entry, shell, cwd, now);
      }
      return overProcessEnvironment(entry.answer.variables);
    }
    if (retrying && !entry.probe) return overProcessEnvironment(null);
    await this.probe(entry, shell, cwd, now);
    return environmentOf(entry);
  }

  /** Asks the shell now (joining a probe already running). */
  async fresh(
    shell: string,
    cwd: string,
    now = Date.now()
  ): Promise<NodeJS.ProcessEnv> {
    const entry = this.entryFor(shell, cwd);
    await this.probe(entry, shell, cwd, now);
    return environmentOf(entry);
  }

  /** Resolves when no probe is running. */
  async settled(): Promise<void> {
    for (;;) {
      const running = [...this.entries.values()]
        .map(entry => entry.probe)
        .filter((probe): probe is Promise<void> => probe !== null);
      if (running.length === 0) return;
      await Promise.all(running);
    }
  }

  reset(): void {
    this.entries.clear();
  }

  private entryFor(shell: string, cwd: string): LoginEnvironmentEntry {
    const key = `${shell}\0${cwd}`;
    let entry = this.entries.get(key);
    if (!entry) {
      if (this.entries.size >= LOGIN_ENVIRONMENT_MAX_CONTEXTS) {
        const oldest = this.entries.keys().next().value;
        if (oldest !== undefined) this.entries.delete(oldest);
      }
      entry = { answer: null, probe: null, failedAt: null, reported: false };
      this.entries.set(key, entry);
    }
    return entry;
  }

  private probe(
    entry: LoginEnvironmentEntry,
    shell: string,
    cwd: string,
    now: number
  ): Promise<void> {
    if (entry.probe) return entry.probe;
    const probe = readLoginVariables(shell, cwd, this.deadlineMs())
      .then(read => {
        const family = loginShellFamily(shell);
        if (read.ok) {
          if (entry.reported) {
            this.record('login-environment.recovered', { shell: family });
          }
          entry.answer = { variables: read.variables, at: now };
          entry.failedAt = null;
          entry.reported = false;
          return;
        }
        entry.failedAt = now;
        if (entry.reported) return;
        entry.reported = true;
        this.record('login-environment.unavailable', {
          shell: family,
          reason: read.failure,
          exitCode: read.exitCode,
          fallback: entry.answer ? 'previous-answer' : 'process-environment',
        });
      })
      .finally(() => {
        if (entry.probe === probe) entry.probe = null;
      });
    entry.probe = probe;
    return probe;
  }
}

const loginEnvironment = new LoginEnvironmentResolver();

/** Send the resolver's failures to `logs/main.jsonl`. */
export function configureLoginEnvironmentDiagnostics(
  record: LoginEnvironmentRecorder
): void {
  loginEnvironment.configureDiagnostics(record);
}

/**
 * The harness-relevant variables (`LOGIN_ENVIRONMENT_KEYS`) as the user's
 * login shell sets them in `cwd`, over this process's environment, asked
 * now. A shell that cannot answer leaves the previous answer for that
 * context, else this process's environment, and the log says which.
 */
export async function loginModelEnvironment(
  shell: string,
  cwd: string
): Promise<NodeJS.ProcessEnv> {
  return loginEnvironment.fresh(shell, cwd);
}

/**
 * The operator's login environment in his home: what every reader of a
 * harness's own store (the conversation catalog, resume candidates, project
 * suggestions, Clone's context) resolves homes from. The shell's answer is
 * shared for a minute and refreshed in the background after that; this
 * process's environment is read at each call. A Session's own environment,
 * which can differ by directory, is `loginModelEnvironment` in that
 * Session's cwd.
 */
export async function harnessEnvironment(
  now = Date.now()
): Promise<NodeJS.ProcessEnv> {
  return loginEnvironment.current(await defaultShell(), os.homedir(), now);
}

/** Ask the login shell once at app start, so the first read (a Codex
 *  launch's identity baseline among them) does not wait on it. */
export async function warmHarnessEnvironment(): Promise<void> {
  await harnessEnvironment();
}

/** Resolves once no background refresh of the login environment is
 *  running. */
export function harnessEnvironmentSettled(): Promise<void> {
  return loginEnvironment.settled();
}

/** Forget every answer, so the next read asks the login shell again. */
export function resetHarnessEnvironment(): void {
  loginEnvironment.reset();
}

/** An environment to resolve homes from: the login shell's, or a
 *  Session's own. */
type HarnessVariables = Readonly<Record<string, string | undefined>>;

function homeOf(env: HarnessVariables): string {
  return env.HOME || os.homedir();
}

/** Claude Code's configuration directory, as Claude Code itself resolves
 *  it: `CLAUDE_CONFIG_DIR` when set, `~/.claude` otherwise. */
export function claudeConfigDir(
  env: HarnessVariables,
  home = homeOf(env)
): string {
  return env.CLAUDE_CONFIG_DIR || path.join(home, '.claude');
}

/** Where Claude Code keeps its transcripts, one directory per launch cwd.
 *  `EXAWATT_CLAUDE_PROJECTS_ROOT` is the eval sandbox's override. */
export function claudeProjectsRoot(env: HarnessVariables): string {
  return (
    env.EXAWATT_CLAUDE_PROJECTS_ROOT ??
    path.join(claudeConfigDir(env), 'projects')
  );
}

/** Codex's home, as Codex resolves it: `CODEX_HOME` when set, `~/.codex`
 *  otherwise. Its sessions and its state database both live here. */
export function codexHome(env: HarnessVariables, home = homeOf(env)): string {
  return env.CODEX_HOME || path.join(home, '.codex');
}

/** The Codex state database the catalog and the project suggestions read. */
export function codexStateDatabase(
  env: HarnessVariables,
  home = homeOf(env)
): string {
  return path.join(codexHome(env, home), 'state_5.sqlite');
}

/** Where Grok keeps its sessions: `GROK_HOME` is the harness's own
 *  override; `EXAWATT_GROK_SESSIONS_ROOT` is the eval sandbox's. */
export function grokSessionsRoot(env: HarnessVariables): string {
  if (env.EXAWATT_GROK_SESSIONS_ROOT) return env.EXAWATT_GROK_SESSIONS_ROOT;
  if (env.GROK_HOME) return path.join(env.GROK_HOME, 'sessions');
  return path.join(homeOf(env), '.grok', 'sessions');
}
