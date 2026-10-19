/**
 * Run a source's own CLI the way its Session's launch resolved it (ENG-029
 * C4): through the operator's login shell, in the Session's directory, so
 * PATH and a `CODEX_HOME` set in a shell startup file are the launch's own.
 * `codex queue` written to the wrong home would be accepted and never read.
 *
 * Literal arguments are shell-quoted; free text travels in the environment
 * and is referenced as `"$NAME"`, so no shell's quoting rules can alter it.
 */
import { execFile } from 'child_process';
import path from 'path';
import { defaultShell, planLoginShell, shellQuote } from '../pty/login-shell';
import type { SourceCommandArg, SourceCommandResult } from './transports/types';

const SOURCE_COMMAND_TIMEOUT_MS = 20_000;
const ENV_NAME = /^[A-Z][A-Z0-9_]*$/;

/** The fixture binary directory the Electron evals launch harnesses from. */
function testExecutable(executable: string): string {
  const bin = process.env.EXAWATT_TEST_HARNESS_BIN;
  return process.env.EXAWATT_TEST === '1' && bin && path.isAbsolute(bin)
    ? path.join(bin, executable)
    : executable;
}

export function sourceCommandLine(
  executable: string,
  args: readonly SourceCommandArg[]
): { command: string; env: Record<string, string> } {
  const env: Record<string, string> = {};
  const words = [shellQuote(testExecutable(executable))];
  for (const arg of args) {
    if (typeof arg === 'string') {
      words.push(shellQuote(arg));
      continue;
    }
    if (!ENV_NAME.test(arg.env)) throw new Error(`Invalid variable ${arg.env}`);
    env[arg.env] = arg.value;
    words.push(`"$${arg.env}"`);
  }
  return { command: words.join(' '), env };
}

export async function runSourceCommand(
  cwd: string,
  launchEnvironment: Record<string, string | undefined>,
  executable: string,
  args: readonly SourceCommandArg[]
): Promise<SourceCommandResult> {
  const shell = await defaultShell();
  const { command, env } = sourceCommandLine(executable, args);
  const plan = planLoginShell(shell, { command, directory: cwd });
  return new Promise(resolve => {
    execFile(
      shell,
      plan.args,
      {
        cwd: plan.cwd,
        env: { ...launchEnvironment, ...env },
        timeout: SOURCE_COMMAND_TIMEOUT_MS,
        maxBuffer: 256 * 1024,
      },
      (error, stdout, stderr) => {
        const code =
          error && typeof (error as NodeJS.ErrnoException).code === 'number'
            ? (error as unknown as { code: number }).code
            : error
              ? null
              : 0;
        resolve({
          exitCode: code,
          stdout: String(stdout),
          stderr: String(stderr),
        });
      }
    );
  });
}
