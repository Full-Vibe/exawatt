import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';
import {
  nextDistributionEnvironment,
  readPreparedDistribution,
} from './lib/distribution-build.mjs';
import { resolveDevPort, resolveIdleTtlMs, watchForIdle } from './lib/dev-idle-watch.mjs';

const root = process.cwd();
const [command, ...args] = process.argv.slice(2);
if (!command)
  throw new Error('Usage: run-next-with-distribution.mjs <command>');

const prepared = await readPreparedDistribution(root);
const require = createRequire(import.meta.url);
const nextBin = require.resolve('next/dist/bin/next');
const child = spawn(process.execPath, [nextBin, command, ...args], {
  cwd: root,
  env: nextDistributionEnvironment(prepared),
  stdio: 'inherit',
  // Own process group so the whole `next dev` → `next-server` tree can be
  // signalled as a unit; `detached` here does not orphan it, the supervisor
  // still waits on the child below.
  detached: true,
});

// Next's dev process owns a `next-server` child of its own. Signalling only
// this process leaves that grandchild listening — the exact orphan shape H12
// exists to remove — so termination goes to the whole process group and
// escalates if the group does not go quietly.
function terminateChild() {
  const signalGroup = signal => {
    try {
      process.kill(-child.pid, signal);
    } catch {
      // No group (already reaped, or the platform refused): fall back to the
      // direct child rather than leaving it running.
      try {
        child.kill(signal);
      } catch {
        /* already gone */
      }
    }
  };
  signalGroup('SIGTERM');
  const escalation = setTimeout(() => signalGroup('SIGKILL'), 10_000);
  escalation.unref?.();
}

// ENG-022 H12: a dev server nobody is attached to shuts itself down, so an
// agent that walks away does not leave one running for days.
let stopIdleWatch = () => {};
if (command === 'dev') {
  const port = resolveDevPort(args, { env: process.env });
  const ttlMs = resolveIdleTtlMs(process.env.EXAWATT_DEV_IDLE_MINUTES);
  stopIdleWatch = watchForIdle({
    port,
    ttlMs,
    onIdle: () => terminateChild(),
    log: message => console.log(message),
  });
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    terminateChild();
  });
}

const exitCode = await new Promise((resolve, reject) => {
  child.once('error', reject);
  child.once('exit', code => resolve(code ?? 1));
});
stopIdleWatch();
if (exitCode !== 0) process.exit(exitCode);

if (command === 'build') {
  await mkdir(path.join(root, '.next'), { recursive: true });
  await writeFile(
    path.join(root, '.next', 'exawatt-distribution.sha256'),
    `${prepared.digest}\n`,
    'utf8'
  );
}
