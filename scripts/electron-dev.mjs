// Launch the Electron shell against a Next dev server, REUSING one if it is
// already running (Next 16 allows only one dev server per project dir, so
// blindly spawning `next dev` fails whenever any dev server — including an
// agent's verification server — is already up).
//
//   EXAWATT_DEV_PORT  force a specific port (skip probing)
//   EXAWATT_DEV_PATH  initial route (default /workspace — the dogfood surface)
import { spawn } from 'child_process';
import http from 'http';

const CANDIDATES = process.env.EXAWATT_DEV_PORT
  ? [Number(process.env.EXAWATT_DEV_PORT)]
  : [7000, 7090, 3000];
const DEV_PATH = process.env.EXAWATT_DEV_PATH ?? '/workspace';

function probe(port) {
  return new Promise((resolve) => {
    const req = http.get(
      { host: 'localhost', port, path: '/', timeout: 1500 },
      (res) => {
        res.resume();
        resolve(true);
      }
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function findRunning() {
  for (const p of CANDIDATES) {
    if (await probe(p)) return p;
  }
  return null;
}

let devProc = null;
let port = await findRunning();

if (port) {
  console.log(`[electron-dev] reusing dev server on :${port}`);
} else {
  port = CANDIDATES[0];
  console.log(`[electron-dev] starting next dev on :${port}`);
  devProc = spawn('pnpm', ['dev'], { stdio: 'inherit' });
  const deadline = Date.now() + 120_000;
  while (!(await probe(port))) {
    if (devProc.exitCode !== null) {
      console.error('[electron-dev] dev server exited before becoming ready');
      process.exit(1);
    }
    if (Date.now() > deadline) {
      console.error('[electron-dev] TIMED OUT waiting for the dev server');
      devProc.kill();
      process.exit(1);
    }
    await new Promise((r) => setTimeout(r, 500));
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
