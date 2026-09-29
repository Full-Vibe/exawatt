import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import type { PtyHarness } from '@exawatt/core';
import type { PtyPowerControl } from '@exawatt/core/desktop-bridge';
import { harnessDescriptor } from './harness-registry';
import { loginShellFamily, planLoginShell, shellQuote } from './login-shell';

const execFileAsync = promisify(execFile);

interface ProbeRequest {
  harness: PtyHarness;
  shell: string;
  cwd: string;
  executable?: string;
  env?: NodeJS.ProcessEnv;
}

/** Read-only, bounded CLI candidate probes. Pipes do not reproduce terminal
 * startup: the actual launch must confirm resolution before claiming control.
 * Failure must leave the original launch available, without a flag
 * whose support we have not established. No probe starts an agent turn. */
export async function probeHarnessPowerControl(
  request: ProbeRequest
): Promise<PtyPowerControl> {
  if (request.harness === 'shell') {
    return { state: 'not-applicable', reason: 'shell' };
  }
  const descriptor = harnessDescriptor(request.harness);
  const control = descriptor.sleepControl;
  if (control?.kind === 'uncontrolled') {
    return { state: 'uncontrolled', reason: control.reason };
  }
  if (!control)
    return { state: 'unknown', reason: 'Source control not verified' };
  if (
    process.platform !== 'darwin' ||
    loginShellFamily(request.shell) === 'powershell'
  ) {
    return {
      state: 'unknown',
      reason: 'Platform or shell control not verified',
    };
  }
  const run = async (command: string): Promise<string> => {
    const plan = planLoginShell(request.shell, {
      command,
      directory: request.cwd,
    });
    const { stdout } = await execFileAsync(request.shell, plan.args, {
      cwd: plan.cwd,
      env: request.env ?? { ...process.env, SHELL: request.shell },
      timeout: 3_000,
      maxBuffer: 64 * 1024,
      encoding: 'utf8',
    });
    return stdout.trim();
  };
  let executable: string | undefined;
  let version: string | undefined;
  try {
    // Fish's `command -v` skips functions (including its aliases), unlike the
    // plain invocation we normally launch. Never bypass an operator wrapper
    // merely because a verified binary also exists later in PATH.
    if (
      !request.executable &&
      loginShellFamily(request.shell) === 'fish' &&
      (await run(`type -t ${shellQuote(descriptor.source.executable)}`)) !==
        'file'
    ) {
      return {
        state: 'unknown',
        reason: 'Source invocation is not a plain executable',
      };
    }
    executable =
      request.executable ??
      (await run(`command -v ${shellQuote(descriptor.source.executable)}`));
    // Shell functions, aliases and noisy startup output cannot identify an
    // exact executable. Preserve their original launch behavior as unknown.
    if (!path.isAbsolute(executable) || /[\r\n\0]/.test(executable)) {
      return {
        state: 'unknown',
        reason: 'Executable not resolved unambiguously',
      };
    }
    const versionOutput = await run(
      `${shellQuote(executable)} ${descriptor.source.versionArgs.map(shellQuote).join(' ')}`
    );
    version = /^codex-cli ([^\s]+)$/.exec(versionOutput)?.[1];
    if (!version || !control.verifiedVersions.includes(version)) {
      return {
        state: 'unknown',
        reason: 'Executable version not verified',
        executable,
        version,
      };
    }
    // Also exercise the actual override parser without running a turn. The
    // recognized feature must be false with the launch opt-out applied.
    const features = await run(
      `${control.invocation(shellQuote(executable))} features list`
    );
    const rows = features.split(/\r?\n/).map(line => line.trim().split(/\s+/));
    const featureRows = rows.filter(row => row[0] === control.feature);
    if (
      featureRows.length !== 1 ||
      featureRows[0].length !== 3 ||
      featureRows[0][2] !== 'false'
    ) {
      return {
        state: 'unknown',
        reason: 'Feature override not recognized',
        executable,
        version,
      };
    }
    return {
      state: 'applied-at-launch',
      mechanism: control.kind,
      executable,
      version,
      observedAt: Date.now(),
    };
  } catch {
    // Do not expose stderr/config paths or make transient probe failure an
    // agent-launch failure. Never retain evidence from a previous process.
    return {
      state: 'unknown',
      reason: 'Control probe failed',
      executable,
      version,
    };
  }
}
