/**
 * One owner for "ask the operator's own harness binary one question and
 * judge what it printed" (ENG-038 slices 3 and 4).
 *
 * The Claude and Google plan reads both run a CLI the operator installed
 * (`claude -p "/usage"`, `agy -p "/usage"`) through their login shell, so the
 * binary is found where their terminal finds it (a packaged app has a bare
 * PATH), from Exawatt's scratch directory so no shell startup file runs inside
 * a Project (incident `0006`), with a hard timeout that kills the whole
 * process group, and bounded output. Nothing here is a credential: the
 * harness makes the request under its own sign-in.
 */
import { spawn } from 'node:child_process';
import { defaultShell } from '../pty/session-manager';
import { planLoginShell, shellQuote } from '../pty/login-shell';

const MAX_STDOUT_BYTES = 1024 * 1024;
const MAX_STDERR_BYTES = 64 * 1024;

/** What one run of the command produced. */
export type HarnessCommandRun =
  | { kind: 'finished'; exitCode: number; stdout: string; stderr: string }
  | { kind: 'timed-out' }
  | { kind: 'spawn-failed' };

export type HarnessCommandRunner = (
  timeoutMs: number
) => Promise<HarnessCommandRun>;

/** A shell that cannot find the command says so in one of these ways. */
export const COMMAND_NOT_FOUND =
  /command not found|unknown command|is not recognized/i;

interface LoginShellCommandOptions {
  /** The binary, as the operator types it; found on the login shell's PATH. */
  command: string;
  /** Its arguments, each quoted for the shell. */
  args: readonly string[];
  /** Environment added to Exawatt's own for the run. */
  env?: NodeJS.ProcessEnv;
  resolveShell?: () => Promise<string>;
}

/**
 * Runs `command args…` through the operator's login shell, once, with a hard
 * timeout. Resolves, never rejects: every way a run can go wrong is a value.
 */
export function createLoginShellCommandRunner(
  options: LoginShellCommandOptions
): HarnessCommandRunner {
  const resolveShell = options.resolveShell ?? defaultShell;
  const command = `${options.command} ${options.args.map(shellQuote).join(' ')}`;
  return async timeoutMs => {
    const shell = await resolveShell();
    const plan = planLoginShell(shell, { command });
    return new Promise<HarnessCommandRun>(resolve => {
      let settled = false;
      const settle = (run: HarnessCommandRun) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(run);
      };
      let child: ReturnType<typeof spawn>;
      try {
        child = spawn(shell, plan.args, {
          cwd: plan.cwd,
          env: { ...process.env, SHELL: shell, ...options.env },
          stdio: ['ignore', 'pipe', 'pipe'],
          detached: true,
        });
      } catch {
        resolve({ kind: 'spawn-failed' });
        return;
      }
      const timer = setTimeout(() => {
        if (child.pid) {
          try {
            process.kill(-child.pid, 'SIGKILL');
          } catch {
            child.kill('SIGKILL');
          }
        }
        settle({ kind: 'timed-out' });
      }, timeoutMs);
      let stdout = '';
      let stderr = '';
      child.stdout?.on('data', (data: Buffer) => {
        if (stdout.length < MAX_STDOUT_BYTES) stdout += data.toString();
      });
      child.stderr?.on('data', (data: Buffer) => {
        if (stderr.length < MAX_STDERR_BYTES) stderr += data.toString();
      });
      child.on('error', () => settle({ kind: 'spawn-failed' }));
      child.on('close', code =>
        settle({ kind: 'finished', exitCode: code ?? -1, stdout, stderr })
      );
    });
  };
}

/**
 * The JSON envelope a `--output-format json` run printed: the last stdout
 * line that is a JSON object, because a login shell may print startup noise
 * around it. Falls back to the whole output for a pretty-printed envelope.
 */
export function lastJsonObject(stdout: string): Record<string, unknown> | null {
  const parse = (candidate: string): Record<string, unknown> | null => {
    try {
      const parsed: unknown = JSON.parse(candidate);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  };
  const lines = stdout.split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i].trim();
    if (!line.startsWith('{')) continue;
    const parsed = parse(line);
    if (parsed) return parsed;
  }
  const whole = stdout.trim();
  return whole.startsWith('{') ? parse(whole) : null;
}
