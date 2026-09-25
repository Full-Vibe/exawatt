#!/usr/bin/env node
/**
 * Renderer-hang probe (BUG-129): freeze a real Exawatt window's page and
 * require the hang to be noticed, answered with Reload, and the window to come
 * back on a new renderer that paints and answers.
 *
 * Why this is a probe you run by hand and not a gated eval: Chromium ignores
 * a hung page while a debugger is attached to it (a page paused at a
 * breakpoint looks hung), and every harness eval drives the page through one.
 * So this launches Exawatt itself, with an inspector on MAIN only, and drives
 * everything from main. Chromium also reports a hang only for a visible window
 * whose input goes unanswered, so the window opens inactive (on a secondary
 * display when there is one, without taking focus) and main keeps sending it
 * input. The operator's answer comes from `EXAWATT_TEST_UNRESPONSIVE_RESPONSE`.
 *
 * Requires the worktree's own dev server (`EXA_BASE`) and a compiled Electron
 * main (`pnpm electron:compile`). `EXAWATT_PROBE_EXECUTABLE=<app binary>`
 * probes a packaged build instead, which serves its own renderer. Every exit
 * kills the process group it started, and nothing else.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = process.cwd();
const base = process.env.EXA_BASE ?? 'http://localhost:7000';
const userData = mkdtempSync(join(tmpdir(), 'exawatt-renderer-hang-probe-'));
const started = Date.now();
const log = message =>
  console.log(
    `[hang-probe ${((Date.now() - started) / 1000).toFixed(1)}s] ${message}`
  );

const packaged = process.env.EXAWATT_PROBE_EXECUTABLE;
const child = spawn(
  packaged ?? join(root, 'node_modules/.bin/electron'),
  packaged ? ['--inspect=0'] : ['.', '--inspect=0'],
  {
    cwd: root,
    detached: true,
    stdio: ['ignore', 'ignore', 'pipe'],
    env: {
      ...process.env,
      EXAWATT_TEST: '1',
      EXAWATT_WINDOW_MODE: 'inactive',
      EXAWATT_USER_DATA: userData,
      EXAWATT_TEST_UNRESPONSIVE_RESPONSE: 'reload',
      ...(packaged
        ? {}
        : { NODE_ENV: 'development', EXAWATT_DEV_URL: `${base}/workspace` }),
    },
  }
);

function finish(code) {
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch {
    // already gone
  }
  rmSync(userData, { recursive: true, force: true });
  process.exit(code);
}
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => finish(130));
setTimeout(() => {
  log('TIMED OUT after 150s');
  finish(3);
}, 150_000).unref();

const inspectorUrl = await new Promise(resolve => {
  let stderr = '';
  child.stderr.on('data', chunk => {
    stderr += chunk;
    const match = /ws:\/\/\S+/.exec(stderr);
    if (match) resolve(match[0]);
  });
});
const socket = new WebSocket(inspectorUrl);
await new Promise(resolve => socket.addEventListener('open', resolve));
let nextId = 0;
const pending = new Map();
socket.addEventListener('message', message => {
  const reply = JSON.parse(message.data);
  pending.get(reply.id)?.(reply.result?.result?.value);
  pending.delete(reply.id);
});
/** Evaluates `expression` in Electron main, where `electron` is in scope. */
const inMain = expression =>
  new Promise(resolve => {
    const id = ++nextId;
    pending.set(id, resolve);
    socket.send(
      JSON.stringify({
        id,
        method: 'Runtime.evaluate',
        params: {
          expression: `(async () => { const electron = process.mainModule.require('electron'); ${expression} })()`,
          awaitPromise: true,
          returnByValue: true,
        },
      })
    );
  });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const records = () => {
  const file = join(userData, 'logs', 'main.jsonl');
  return existsSync(file)
    ? readFileSync(file, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map(line => JSON.parse(line))
    : [];
};
const WINDOW = `const wc = electron.BrowserWindow.getAllWindows()[0]?.webContents;`;

let before = null;
for (let attempt = 0; attempt < 240 && !before; attempt += 1) {
  before = await inMain(`${WINDOW}
    if (!wc || wc.isLoading() || !wc.getURL().includes('/workspace')) return null;
    const ready = await wc.executeJavaScript("!!document.querySelector('[data-workspace-ready]')").catch(() => false);
    return ready ? wc.getOSProcessId() : null;`);
  if (!before) await pause(500);
}
if (!before) {
  log('FAIL the workspace never became ready');
  finish(1);
}
await inMain(`${WINDOW}
  void wc.executeJavaScript('const until = Date.now() + 120000; while (Date.now() < until) {}').catch(() => {});`);
log('the page is frozen; sending input until Chromium notices');

const seen = { hung: false, choice: null, gone: null };
while (!seen.gone) {
  await inMain(`${WINDOW}
    if (!wc) return;
    wc.sendInputEvent({ type: 'mouseMove', x: 40, y: 40 });
    wc.sendInputEvent({ type: 'keyDown', keyCode: 'A' });
    wc.sendInputEvent({ type: 'keyUp', keyCode: 'A' });`);
  for (const record of records()) {
    if (record.event === 'renderer.unresponsive') seen.hung = true;
    if (record.event === 'renderer.unresponsive-choice')
      seen.choice = record.choice;
    if (record.event === 'renderer.gone' && record.requested)
      seen.gone = record;
  }
  await pause(500);
}
log(`noticed, answered ${seen.choice}, renderer ${seen.gone.reason}`);

let after = null;
for (let attempt = 0; attempt < 60; attempt += 1) {
  after = await inMain(`${WINDOW}
    if (!wc || wc.isCrashed() || wc.isLoading()) return null;
    const image = await wc.capturePage().catch(() => null);
    const state = await wc.executeJavaScript('document.readyState').catch(() => null);
    return { renderer: wc.getOSProcessId(), painted: !!image && !image.isEmpty(), state };`);
  if (after?.painted && after.renderer !== before && after.state === 'complete')
    break;
  await pause(500);
}
const passed =
  seen.hung &&
  seen.choice === 'reload' &&
  after?.painted === true &&
  after.renderer !== before &&
  after.state === 'complete';
log(
  passed
    ? 'PASS the frozen window came back on a new renderer that paints and answers'
    : `FAIL ${JSON.stringify({ seen, after })}`
);
finish(passed ? 0 : 1);
