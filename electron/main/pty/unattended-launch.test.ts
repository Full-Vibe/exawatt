/**
 * Decision 0054: Exawatt never opens an app, a browser tab or a sign-in page
 * from work nobody is watching. A signed-out or offline `agy -p` opened 188
 * Google sign-in tabs from Exawatt's usage read (incident 0042), so every
 * login-shell command outside a visible Session runs in a sandbox that cannot
 * open anything.
 */
import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { planLoginShell, planUnattendedLaunch } from './login-shell';

// @scans electron/main/**/*.ts

const SCRATCH = '/tmp/exawatt-unattended-launch-scratch';
const MAIN = path.resolve(__dirname, '..');

function sourceFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...sourceFiles(full));
    else if (
      entry.name.endsWith('.ts') &&
      !entry.name.endsWith('.d.ts') &&
      !/\.test(?:-support)?\.ts$|\.test\.[a-z-]+\.ts$|\.test-support\.ts$/.test(
        entry.name
      )
    ) {
      files.push(full);
    }
  }
  return files;
}

describe('planUnattendedLaunch', () => {
  const request = { command: "agy '-p' '/usage'", scratchDir: SCRATCH };

  it('runs the login shell inside a macOS sandbox that cannot open apps or URLs', () => {
    const plain = planLoginShell('/bin/zsh', request);
    const launch = planUnattendedLaunch('/bin/zsh', request, 'darwin');
    expect(launch.file).toBe('/usr/bin/sandbox-exec');
    expect(launch.args.slice(0, 2)).toEqual([
      '-p',
      '(version 1)(allow default)(deny lsopen)',
    ]);
    // The shell and its plan are unchanged; children inherit the sandbox.
    expect(launch.args.slice(2)).toEqual(['/bin/zsh', ...plain.args]);
    expect(launch.cwd).toBe(plain.cwd);
  });

  it('runs the shell directly where Exawatt does not ship', () => {
    const plain = planLoginShell('/bin/bash', request);
    expect(planUnattendedLaunch('/bin/bash', request, 'linux')).toEqual({
      file: '/bin/bash',
      args: plain.args,
      cwd: plain.cwd,
    });
  });

  it('leaves only the visible Session launch on the plain login shell', () => {
    const plain = sourceFiles(MAIN)
      .filter(file => /\bplanLoginShell\(/.test(fs.readFileSync(file, 'utf8')))
      .map(file => path.relative(MAIN, file).split(path.sep).join('/'))
      .sort();
    expect(plain).toEqual(['pty/login-shell.ts', 'pty/session-manager.ts']);
  });
});
