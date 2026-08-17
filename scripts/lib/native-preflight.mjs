import { existsSync } from 'node:fs';
import path from 'node:path';

/** The node-pty native binding for this tree, or null when it has not been
 *  built. pnpm blocks dependency build scripts by default and Electron
 *  needs its own ABI, so a fresh worktree ships WITHOUT the binding — and
 *  the failure surfaces at runtime as a bare "posix_spawnp failed." banner
 *  on every PTY launch, which reads like a shell/cwd problem. Check it up
 *  front instead. */
export function nodePtyBindingPath(root = process.cwd()) {
  const binding = path.join(
    root,
    'node_modules',
    'node-pty',
    'build',
    'Release',
    'pty.node'
  );
  return existsSync(binding) ? binding : null;
}

export function assertNodePtyBuilt(root = process.cwd()) {
  if (!nodePtyBindingPath(root)) {
    throw new Error(
      `node-pty's native binding is missing under ${root} — every PTY ` +
        'spawn would fail with a bare "posix_spawnp failed.". ' +
        'Run: pnpm worktree:setup (or pnpm electron:rebuild).'
    );
  }
}

/** The compiled Electron main for a DEVELOPMENT launch (`electron .`).
 *  `package.json`'s `main` points here, so when `dist-electron/main` is absent
 *  — a wiped or never-compiled `dist-electron`, which happens in a long-lived
 *  worktree — Electron exits before opening a window and Playwright reports
 *  only `Process failed to launch!`, naming nothing. That message has cost
 *  more than one agent a hunt, so name the cause here instead. */
export function assertCompiledElectronMain(root = process.cwd()) {
  const main = path.join(root, 'dist-electron', 'main', 'main.js');
  if (existsSync(main)) return;
  throw new Error(
    `The Electron main process is not compiled under ${root} ` +
      '(dist-electron/main/main.js is missing), so Electron exits before it ' +
      'opens a window and Playwright reports only "Process failed to ' +
      'launch!". Run: pnpm electron:compile'
  );
}
