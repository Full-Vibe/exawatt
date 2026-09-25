#!/usr/bin/env node
/**
 * Renderer-errors eval (BUG-129): throw in this instance's own page, and
 * reject a promise nobody awaits, and require both to reach
 * `logs/main.jsonl`. Before, only route error boundaries were recorded, so an
 * "I saw something weird" report had no trail.
 *
 * The hang half of BUG-129 cannot be proven here: Chromium ignores a hung
 * page while a debugger is attached, and this harness is one. That half has
 * its own probe, `pnpm eval:electron:renderer-hang`.
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

const userData = mkdtempSync(join(tmpdir(), 'exawatt-renderer-errors-eval-'));
const failures = [];
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
  if (!ok) failures.push(name);
};

function records() {
  const log = join(userData, 'logs', 'main.jsonl');
  if (!existsSync(log)) return [];
  return readFileSync(log, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line));
}

/** Waits for the effect, bounded, polling main's own record of it. */
async function untilRecorded(predicate, deadlineMs) {
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    const found = records().find(predicate);
    if (found) return found;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  return null;
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

    await page.evaluate(() => {
      setTimeout(() => {
        throw new Error('renderer-errors-eval: thrown in a timer');
      }, 0);
      void Promise.reject(
        new Error('renderer-errors-eval: nobody awaited this')
      );
    });
    const thrown = await untilRecorded(
      r => r.event === 'renderer.error' && /thrown in a timer/.test(r.message),
      10_000
    );
    check('a thrown error reaches the log', thrown !== null);
    const rejected = await untilRecorded(
      r =>
        r.event === 'renderer.unhandled-rejection' &&
        /nobody awaited/.test(r.message),
      10_000
    );
    check('an unhandled rejection reaches the log', rejected !== null);
  },
  { maxMs: 90_000 }
);

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed`);
  process.exit(1);
}
console.log('\nrenderer-errors eval passed');
