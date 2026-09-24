#!/usr/bin/env node
/**
 * Helper-death eval (BUG-223, incident 0028): kill this instance's own
 * renderer, GPU and network helpers at once, the set a stray machine-wide
 * `pkill` killed on 2026-09-24, and require the window to come back by itself
 * with every death on the record. Before BUG-223 the window stayed dead until
 * a force quit.
 *
 * Kills by PID from `app.getAppMetrics()`, never by pattern: an eval that
 * pattern-killed would be the incident it guards against.
 *
 * Requires the dev server (`pnpm dev`) and a compiled Electron main
 * (`pnpm electron:compile`), like the spine eval.
 */
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  waitForWorkspaceReady,
  withElectronApp,
} from './lib/electron-eval.mjs';

const userData = mkdtempSync(join(tmpdir(), 'exawatt-helper-death-eval-'));
const failures = [];
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
  if (!ok) failures.push(name);
};

/** Re-evaluates `read` in main until `done` holds, or the deadline passes. */
async function until(app, read, done, deadlineMs = 20_000) {
  const deadline = Date.now() + deadlineMs;
  let value = await app.evaluate(read);
  while (!done(value) && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 100));
    value = await app.evaluate(read);
  }
  return value;
}

await withElectronApp(
  {
    args: ['.'],
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: 'development',
      EXAWATT_TEST: '1',
      EXAWATT_USER_DATA: userData,
      EXAWATT_DEV_URL: `${process.env.EXA_BASE ?? 'http://localhost:7000'}/workspace`,
    },
  },
  async (app, page) => {
    await waitForWorkspaceReady(page);

    const before = await app.evaluate(async ({ app: a, BrowserWindow }) => {
      const wc = BrowserWindow.getAllWindows()[0].webContents;
      return {
        renderer: wc.getOSProcessId(),
        helpers: a
          .getAppMetrics()
          .filter(
            m =>
              m.type === 'GPU' ||
              (m.type === 'Utility' && /network/i.test(m.serviceName ?? ''))
          )
          .map(m => m.pid),
      };
    });
    check(
      'found the renderer, GPU and network helpers',
      before.helpers.length >= 2
    );

    for (const pid of [before.renderer, ...before.helpers]) {
      process.kill(pid, 'SIGKILL');
    }

    // Recovery is the product's job: this eval never reloads.
    const after = await until(
      app,
      async ({ BrowserWindow }) => {
        const wc = BrowserWindow.getAllWindows()[0]?.webContents;
        if (!wc) return { alive: false };
        const alive = !wc.isCrashed() && !wc.isLoading();
        const image = alive ? await wc.capturePage().catch(() => null) : null;
        const painted = image !== null && !image.isEmpty();
        return { alive, painted, renderer: wc.getOSProcessId() };
      },
      state => state.alive && state.painted
    );
    check(
      'the window reloaded itself onto a new renderer',
      after.alive && after.renderer !== before.renderer
    );
    check('the window paints again', after.painted === true);

    const log = join(userData, 'logs', 'main.jsonl');
    const records = existsSync(log)
      ? readFileSync(log, 'utf8')
          .split('\n')
          .filter(Boolean)
          .map(line => JSON.parse(line))
      : [];
    const gone = records.find(r => r.event === 'renderer.gone');
    check(
      'the renderer death is on the record with its reason and the recovery',
      gone?.reason === 'killed' && gone?.action === 'reload',
      JSON.stringify(gone ?? null)
    );
    const helpers = records.filter(r => r.event === 'child.gone');
    check(
      'every helper death is on the record',
      helpers.length >= before.helpers.length,
      `${helpers.length} of ${before.helpers.length}`
    );
  },
  { maxMs: 90_000 }
);

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed`);
  process.exit(1);
}
console.log('\nhelper-death eval passed');
