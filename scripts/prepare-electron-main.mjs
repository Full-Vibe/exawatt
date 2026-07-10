import { cp, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

const execFileAsync = promisify(execFile);

const root = process.cwd();
const source = await realpath(path.join(root, 'node_modules', 'node-pty'));
const dependencyRoot = path.join(root, 'dist-electron', 'node_modules');
const target = path.join(dependencyRoot, 'node-pty');

await rm(dependencyRoot, { recursive: true, force: true });
await mkdir(dependencyRoot, { recursive: true });
await cp(source, target, { recursive: true, dereference: true });

const { stdout: shaOutput } = await execFileAsync('git', ['rev-parse', 'HEAD'], {
  cwd: root,
});
const { stdout: branchOutput } = await execFileAsync(
  'git',
  ['branch', '--show-current'],
  { cwd: root }
);
await writeFile(
  path.join(root, 'dist-electron', 'build-info.json'),
  `${JSON.stringify(
    {
      sha: shaOutput.trim(),
      branch: branchOutput.trim(),
      builtAt: new Date().toISOString(),
    },
    null,
    2
  )}\n`
);

console.log('[electron-main] staged node-pty runtime');
