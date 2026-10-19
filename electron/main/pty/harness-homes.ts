import * as os from 'os';
import * as path from 'path';
import { defaultShell, runLoginShell } from './login-shell';

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

/**
 * The variables a harness reads to find its files or choose its model. The
 * login shell is asked for exactly these; everything else is this
 * process's.
 */
const LOGIN_ENVIRONMENT_KEYS = [
  'HOME',
  'CODEX_HOME',
  'CLAUDE_CONFIG_DIR',
  'GROK_HOME',
  'QWEN_HOME',
  'QWEN_RUNTIME_DIR',
  'ANTHROPIC_MODEL',
  'ANTHROPIC_CUSTOM_MODEL_OPTION',
  'ANTHROPIC_CUSTOM_MODEL_OPTION_NAME',
  'ANTHROPIC_CUSTOM_MODEL_OPTION_DESCRIPTION',
  'CLAUDE_CODE_EFFORT_LEVEL',
  'XDG_CONFIG_HOME',
  'OPENCODE_CONFIG',
  'OPENCODE_CONFIG_DIR',
  'OPENCODE_CONFIG_CONTENT',
] as const;

/** What the login shell said about each key: a value, or unset. */
type LoginVariables = ReadonlyMap<string, string | null>;

async function readLoginVariables(
  shell: string,
  cwd: string
): Promise<LoginVariables | null> {
  const printCommand = LOGIN_ENVIRONMENT_KEYS.map(
    key => `printf '${key}=%s\\n' "\${${key}-}"`
  ).join('; ');
  try {
    const result = await runLoginShell(shell, printCommand, {
      cwd,
      timeout: 2_000,
      maxBuffer: 64 * 1024,
    });
    const variables = new Map<string, string | null>();
    for (const line of result.stdout.split('\n')) {
      const separator = line.indexOf('=');
      if (separator < 1) continue;
      const key = line.slice(0, separator);
      if (
        !LOGIN_ENVIRONMENT_KEYS.includes(
          key as (typeof LOGIN_ENVIRONMENT_KEYS)[number]
        )
      ) {
        continue;
      }
      variables.set(key, line.slice(separator + 1) || null);
    }
    return variables;
  } catch {
    return null;
  }
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

/**
 * The harness-relevant variables (`LOGIN_ENVIRONMENT_KEYS`) as the user's
 * login shell sets them in `cwd`, over this process's environment. A shell
 * that cannot answer leaves this process's environment as it is.
 */
export async function loginModelEnvironment(
  shell: string,
  cwd: string
): Promise<NodeJS.ProcessEnv> {
  return overProcessEnvironment(await readLoginVariables(shell, cwd));
}

/** Long enough that a burst of reads spawns one shell, short enough that an
 *  edited startup file is followed without a relaunch. */
const HARNESS_ENVIRONMENT_TTL_MS = 60_000;

let harnessVariablesRead: {
  at: number;
  variables: Promise<LoginVariables | null>;
} | null = null;

/**
 * The operator's login environment in his home: what every reader of a
 * harness's own store (the conversation catalog, resume candidates, project
 * suggestions, Clone's context) resolves homes from. The shell's answer is
 * shared for a minute; this process's environment is read at each call. A
 * Session's own environment, which can differ by directory, is
 * `loginModelEnvironment` in that Session's cwd.
 */
export async function harnessEnvironment(
  now = Date.now()
): Promise<NodeJS.ProcessEnv> {
  if (
    !harnessVariablesRead ||
    now - harnessVariablesRead.at >= HARNESS_ENVIRONMENT_TTL_MS
  ) {
    harnessVariablesRead = {
      at: now,
      variables: defaultShell().then(shell =>
        readLoginVariables(shell, os.homedir())
      ),
    };
  }
  return overProcessEnvironment(await harnessVariablesRead.variables);
}

/** Forget the shared read, so the next one asks the login shell again. */
export function resetHarnessEnvironment(): void {
  harnessVariablesRead = null;
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
