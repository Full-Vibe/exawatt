import { afterEach, describe, expect, it } from 'vitest';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  configureLoginShellScratchDir,
  loginShellFamily,
  loginShellScratchDir,
  observedShellStartupArtifacts,
  planLoginShell,
  prepareLoginShellScratchDir,
  shellQuote,
} from './login-shell';

const execFileAsync = promisify(execFile);
const SCRATCH = '/tmp/exawatt-login-shell-scratch';
const created: string[] = [];

afterEach(async () => {
  configureLoginShellScratchDir(
    path.join(os.tmpdir(), 'exawatt-shell-startup')
  );
  for (const dir of created.splice(0)) {
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
});

async function tempDir(prefix: string): Promise<string> {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), prefix));
  created.push(dir);
  return dir;
}

describe('login shell families', () => {
  it('classifies the shells Exawatt can be handed as a login shell', () => {
    expect(loginShellFamily('/opt/homebrew/bin/fish')).toBe('fish');
    expect(loginShellFamily('/bin/zsh')).toBe('posix');
    expect(loginShellFamily('/bin/bash')).toBe('posix');
    expect(loginShellFamily('/bin/sh')).toBe('posix');
    expect(loginShellFamily('/opt/homebrew/bin/nu')).toBe('posix');
    expect(loginShellFamily('/bin/tcsh')).toBe('csh');
    expect(loginShellFamily('/bin/csh')).toBe('csh');
    expect(loginShellFamily('/usr/local/bin/pwsh')).toBe('powershell');
  });

  it('never combines -l with -c for csh, which rejects the pair', () => {
    // tcsh documents -l as usable "only alone". A hand-built ['-l','-c',cmd]
    // fails outright there; this is the per-shell difference the single owner
    // exists to hold.
    expect(planLoginShell('/bin/tcsh', { command: 'true' }).args).toEqual([
      '-c',
      'true',
    ]);
    expect(planLoginShell('/bin/tcsh').args).toEqual(['-l']);
  });

  it('uses the PowerShell spelling of the same two ideas', () => {
    const plan = planLoginShell('/usr/local/bin/pwsh', {
      command: 'Get-Command',
      directory: '/tmp/project',
      scratchDir: SCRATCH,
    });
    expect(plan.args[0]).toBe('-Login');
    expect(plan.args[1]).toBe('-Command');
    expect(plan.args[2]).toContain('Set-Location -LiteralPath');
  });
});

describe('startup files never execute inside a Project', () => {
  it('spawns a commanded shell in scratch and enters the Project after', () => {
    const plan = planLoginShell('/opt/homebrew/bin/fish', {
      command: 'claude --resume x',
      directory: '/Users/tester/Code/exawatt',
      scratchDir: SCRATCH,
    });
    expect(plan.cwd).toBe(SCRATCH);
    expect(plan.startupIsolated).toBe(true);
    expect(plan.args).toEqual([
      '-l',
      '-c',
      "cd -- '/Users/tester/Code/exawatt' || exit 1\nclaude --resume x",
    ]);
  });

  it('uses fish -C for an interactive shell, which runs after config', () => {
    // `-C` is documented to evaluate "after reading the configuration", so it
    // is the only post-startup entry point an interactive shell offers.
    const plan = planLoginShell('/opt/homebrew/bin/fish', {
      directory: '/Users/tester/Code/exawatt',
      scratchDir: SCRATCH,
    });
    expect(plan.cwd).toBe(SCRATCH);
    expect(plan.startupIsolated).toBe(true);
    expect(plan.args).toEqual([
      '-l',
      '-C',
      "cd -- '/Users/tester/Code/exawatt'",
    ]);
  });

  it('says so honestly when a family offers no post-startup entry', () => {
    // zsh/bash have no init-command that runs after their startup files, so an
    // interactive login shell still starts in the Project. The plan reports it
    // rather than pretending otherwise.
    const plan = planLoginShell('/bin/zsh', {
      directory: '/Users/tester/Code/exawatt',
      scratchDir: SCRATCH,
    });
    expect(plan.cwd).toBe('/Users/tester/Code/exawatt');
    expect(plan.startupIsolated).toBe(false);
  });

  it('quotes a Project path that would otherwise break out of the cd', () => {
    const plan = planLoginShell('/bin/zsh', {
      command: 'echo hi',
      directory: "/tmp/it's a; rm -rf /",
      scratchDir: SCRATCH,
    });
    expect(plan.args[2]).toBe(
      `cd -- ${shellQuote("/tmp/it's a; rm -rf /")} || exit 1\necho hi`
    );
  });

  it('runs commands with no Project in scratch, not the home directory', () => {
    const plan = planLoginShell('/bin/zsh', {
      command: 'echo hi',
      scratchDir: SCRATCH,
    });
    expect(plan.cwd).toBe(SCRATCH);
    expect(plan.args).toEqual(['-l', '-c', 'echo hi']);
  });
});

describe('the scratch directory', () => {
  it('always exists by the time a plan names it as cwd', async () => {
    // A spawn into a missing cwd fails with a bare ENOENT that reads as a
    // broken harness, so the plan may never hand out a directory that is not
    // there yet.
    const root = await tempDir('exawatt-scratch-missing-');
    const scratch = path.join(root, 'never-created', 'shell-startup');
    configureLoginShellScratchDir(scratch);
    const plan = planLoginShell('/bin/zsh', { command: 'true' });
    expect(plan.cwd).toBe(scratch);
    expect(fs.existsSync(plan.cwd)).toBe(true);
  });

  it('falls back to a directory that certainly exists when it cannot be made', () => {
    configureLoginShellScratchDir('/proc/nope/exawatt-shell-startup');
    const plan = planLoginShell('/bin/zsh', { command: 'true' });
    expect(fs.existsSync(plan.cwd)).toBe(true);
  });

  it('is created empty and reports what a shell startup wrote there', async () => {
    const root = await tempDir('exawatt-scratch-');
    const scratch = path.join(root, 'shell-startup');
    configureLoginShellScratchDir(scratch);
    expect(loginShellScratchDir()).toBe(scratch);

    await fs.promises.mkdir(scratch, { recursive: true });
    await fs.promises.writeFile(path.join(scratch, 'stale'), '');
    await prepareLoginShellScratchDir();
    expect(await observedShellStartupArtifacts()).toEqual([]);

    await fs.promises.writeFile(path.join(scratch, '-l'), '');
    expect(await observedShellStartupArtifacts()).toEqual(['-l']);
  });
});

/**
 * The end-to-end proof, with a fake shell standing in for the operator's fish:
 * a startup file that redirects to `./-l`, exactly like the malformed OpenClaw
 * completion `openclaw.fish` sources. Run through the owner, the Project stays
 * clean and the command still runs in the Project.
 */
describe('a shell whose startup writes into its working directory', () => {
  it('leaves the Project clean and still runs the command there', async () => {
    const root = await tempDir('exawatt-dirty-shell-');
    const scratch = path.join(root, 'scratch');
    const project = path.join(root, 'project');
    await fs.promises.mkdir(scratch, { recursive: true });
    await fs.promises.mkdir(project, { recursive: true });

    // Startup runs before anything the caller asked for, and writes to cwd.
    const fakeShell = path.join(root, 'dirty-shell');
    await fs.promises.writeFile(
      fakeShell,
      ['#!/bin/sh', ': > ./-l', 'shift 2', 'exec /bin/sh -c "$1"', ''].join(
        '\n'
      ),
      { mode: 0o755 }
    );

    const plan = planLoginShell(fakeShell, {
      command: 'pwd',
      directory: project,
      scratchDir: scratch,
    });
    const { stdout } = await execFileAsync(fakeShell, plan.args, {
      cwd: plan.cwd,
      encoding: 'utf8',
    });

    expect(stdout.trim()).toBe(project);
    expect(await fs.promises.readdir(project)).toEqual([]);
    expect(await fs.promises.readdir(scratch)).toEqual(['-l']);
  });
});
