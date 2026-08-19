// Launch the Electron shell against a Next dev server, REUSING one only if it
// is serving THIS checkout (Next 16 allows one dev server per project dir, so
// blindly spawning `next dev` fails whenever any dev server — including an
// agent's verification server — is already up).
//
// ENG-022 H13: reuse used to mean "something answered GET / on 7000/7090/3000",
// which with parallel agent worktrees adopted ANOTHER checkout's renderer and
// dogfooded the wrong code. Identity is now read through the same owner the
// eval harness uses (`dev-server-identity.mjs`), and a foreign or unverifiable
// server is stepped over rather than adopted — the launcher starts its own on
// the first genuinely free port instead of colliding with it.
//
//   EXAWATT_DEV_PORT  force a specific port (skip probing)
//   EXAWATT_DEV_PATH  initial route (default /workspace — the dogfood surface)
import { spawn } from 'child_process';
import { realpathSync } from 'node:fs';
import {
  DEV_IDENTITY,
  findServerForCheckout,
  firstFreePort,
  readDevServerIdentity,
  servesCheckout,
} from './lib/dev-server-identity.mjs';

const CANDIDATES = process.env.EXAWATT_DEV_PORT
  ? [Number(process.env.EXAWATT_DEV_PORT)]
  : [7000, 7090, 3000];
const DEV_PATH = process.env.EXAWATT_DEV_PATH ?? '/workspace';
const ROOT = realpathSync(process.cwd());

function describeRejection({ port, kind, repoRoot }) {
  if (kind === DEV_IDENTITY.IDENTIFIED) {
    return `:${port} serves ${repoRoot} (another checkout)`;
  }
  if (kind === DEV_IDENTITY.UNVERIFIABLE) {
    return `:${port} could not name its checkout (no /api/dev-identity)`;
  }
  return `:${port} is unhealthy`;
}

const found = await findServerForCheckout(CANDIDATES, ROOT, {
  read: origin => readDevServerIdentity(origin, { timeoutMs: 10_000 }),
});
for (const rejection of found.rejected) {
  console.log(`[electron-dev] not reusing ${describeRejection(rejection)}`);
}

let devProc = null;
let port = found.port;

if (port) {
  console.log(`[electron-dev] reusing this checkout's dev server on :${port}`);
} else {
  port = await firstFreePort(CANDIDATES);
  if (!port) {
    console.error(
      `[electron-dev] every candidate port (${CANDIDATES.join(', ')}) is taken by a ` +
        `server that does not serve ${ROOT}. Free one, or set EXAWATT_DEV_PORT.`
    );
    process.exit(1);
  }
  console.log(`[electron-dev] starting next dev on :${port}`);
  devProc = spawn('pnpm', ['dev', '-p', String(port)], { stdio: 'inherit' });
  const deadline = Date.now() + 120_000;
  const origin = `http://localhost:${port}`;
  // Ready means "answering AS THIS CHECKOUT", not merely answering: the whole
  // point of the change is that a listening port proves nothing about identity.
  for (;;) {
    const identity = await readDevServerIdentity(origin, { timeoutMs: 5_000 });
    if (servesCheckout(identity, ROOT)) break;
    if (devProc.exitCode !== null) {
      console.error('[electron-dev] dev server exited before becoming ready');
      process.exit(1);
    }
    if (Date.now() > deadline) {
      console.error('[electron-dev] TIMED OUT waiting for the dev server');
      devProc.kill();
      process.exit(1);
    }
    await new Promise(r => setTimeout(r, 500));
  }
}

console.log(`[electron-dev] launching Electron → http://localhost:${port}${DEV_PATH}`);
const electron = spawn('electron', ['.'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    NODE_ENV: 'development',
    EXAWATT_DEV_URL: `http://localhost:${port}${DEV_PATH}`,
  },
});

const shutdown = () => {
  electron.kill();
  devProc?.kill();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
electron.on('exit', (code) => {
  devProc?.kill();
  process.exit(code ?? 0);
});
