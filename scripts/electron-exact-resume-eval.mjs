#!/usr/bin/env node

import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  startAgentFromLauncher,
  waitForPageCondition,
  waitForWorkspaceReady,
  withElectronApp,
} from './lib/electron-eval.mjs';
import { writeFakeHarness } from './lib/harness-probe-fixture.mjs';
import { ensurePackagedApp } from './lib/packaged-app.mjs';

// This tree's package, built when absent or stale (BUG-217).
const packaged = await ensurePackagedApp({ label: 'exact-resume' });
const root = mkdtempSync(join(tmpdir(), 'exawatt-exact-resume-'));
const userData = join(root, 'userData');
const fakeBin = join(root, 'bin');
const projectDir = join(root, 'project');
const otherProjectDir = join(root, 'other-project');
const screenshots = resolve('.artifacts', 'exact-resume');
mkdirSync(userData, { recursive: true });
mkdirSync(fakeBin, { recursive: true });
mkdirSync(projectDir, { recursive: true });
mkdirSync(otherProjectDir, { recursive: true });
mkdirSync(screenshots, { recursive: true });

// A Claude that answers the product's probes, then echoes its argv and stdin.
// The hand-rolled one this replaced answered no probe at all, so `--version`
// fell into the launch loop and every source probe hung (BUG-217).
writeFakeHarness(fakeBin, 'claude', {
  launch: [
    `printf 'FAKE_CLAUDE_ARGS:%s\\n' "$*"`,
    `while IFS= read -r line; do printf '%s\\n' "$line"; done`,
  ].join('\n'),
});

// `EXAWATT_TEST_HARNESS_BIN` resolves every source from the fixture bin and
// nothing else, so the operator's own CLIs are never probed.
const launchOptions = {
  packaged,
  env: {
    ...process.env,
    EXAWATT_TEST: '1',
    EXAWATT_USER_DATA: userData,
    EXAWATT_TEST_HARNESS_BIN: fakeBin,
  },
};
// The second launch reads what the first one's quit persisted, so a quit is
// allowed to finish rather than be killed at the harness's default deadline.
const launchLimits = {
  maxMs: 180_000,
  firstWindowMs: 45_000,
  gracefulMs: 30_000,
  readsHarnessHistory: true,
};

async function waitForSessionCount(page, expected) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const sessions = await page.evaluate(
      async () => (await window.electron?.pty?.list()) ?? []
    );
    if (sessions.length === expected) return sessions;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${expected} PTY sessions`);
}

/** Wait until the persisted layout holds every one of `ids`, which is what the
 *  relaunch reads; the debounced save lands after the last launch. */
function waitForPersistedIdentities(page, ids) {
  return waitForPageCondition(
    page,
    async expected => {
      const layout = await window.electron?.workspace?.load();
      const persisted = new Set(
        layout?.projects?.flatMap(project =>
          project.tabs.map(tab => tab.harnessSessionId)
        ) ?? []
      );
      return expected.every(id => persisted.has(id));
    },
    ids,
    { label: 'all six identities in the persisted layout' }
  );
}

/**
 * Hold Session starts inside main's start itself, in the slot where its
 * readiness probe runs (BUG-305). `ensureRunning` has already registered the
 * start when it reaches that slot, so any ask for the same Session during the
 * hold must join it rather than start or refuse. Reached through main's own
 * Session owner module; a build that does not expose it fails the eval
 * rather than holding nothing.
 */
async function installStartHold(app) {
  const installed = await app.evaluate(() => {
    const { ptySessions } = process.mainModule.require('./pty/session-manager');
    if (typeof ptySessions?.ensureRunning !== 'function') return false;
    const ensureRunning = ptySessions.ensureRunning;
    const hold = { armed: null };
    globalThis.__exawattStartHold = hold;
    ptySessions.ensureRunning = function (options, prepare) {
      const asked = hold.armed;
      if (
        asked?.durableSessionId &&
        asked.durableSessionId === options.durableSessionId
      )
        asked.asks += 1;
      return ensureRunning.call(this, options, async () => {
        const armed = hold.armed;
        if (armed && !armed.durableSessionId) {
          armed.durableSessionId = options.durableSessionId;
          armed.asks = 1;
          await armed.gate;
        }
        if (armed?.durableSessionId === options.durableSessionId)
          armed.prepared += 1;
        await prepare?.();
      });
    };
    return true;
  });
  if (!installed)
    throw new Error('Could not hold a start: main exposes no Session owner');
  const read = () =>
    app.evaluate(() => {
      const { armed } = globalThis.__exawattStartHold;
      return {
        durableSessionId: armed?.durableSessionId ?? null,
        asks: armed?.asks ?? 0,
        prepared: armed?.prepared ?? 0,
      };
    });
  async function until(condition, label) {
    const deadline = Date.now() + 20_000;
    for (;;) {
      const state = await read();
      if (condition(state)) return state;
      if (Date.now() >= deadline)
        throw new Error(`TIMED OUT after 20s waiting for ${label}`);
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }
  return {
    /** Hold the next start until `release`. */
    arm: () =>
      app.evaluate(() => {
        let release;
        const gate = new Promise(resolve => (release = resolve));
        globalThis.__exawattStartHold.armed = {
          gate,
          release,
          durableSessionId: null,
          asks: 0,
          prepared: 0,
        };
      }),
    /** Resolves with the held Session once a start is inside the hold. */
    held: () =>
      until(state => state.durableSessionId, 'a start inside the hold'),
    /** Resolves once the held Session has been asked for `count` times. */
    asked: count =>
      until(state => state.asks >= count, 'another ask for the held Session'),
    read,
    release: () =>
      app.evaluate(() => globalThis.__exawattStartHold.armed.release()),
  };
}

/** Lines of this run's harness-event log (BUG-102). */
function harnessEventLines() {
  try {
    return readFileSync(join(userData, 'logs', 'harness-events.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map(line => JSON.parse(line));
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
}

let originalIds = [];
let otherIds = [];
try {
  await withElectronApp(
    launchOptions,
    async (_app, page) => {
      page.setDefaultTimeout(20_000);
      await page.locator('[data-command-altitude]').waitFor();
      await page.waitForFunction(
        () => !document.querySelector('[data-route-loading]')
      );
      if (!new URL(page.url()).pathname.startsWith('/workspace')) {
        await page.locator('[data-command-altitude-level="terminal"]').click();
        await page.waitForURL('**/workspace*');
        await page.waitForFunction(
          () => !document.querySelector('[data-route-loading]')
        );
      }
      await waitForWorkspaceReady(page);
      await page.evaluate(dir => {
        window.dispatchEvent(
          new CustomEvent('exawatt:open-project', { detail: dir })
        );
      }, projectDir);
      await page.locator('[data-agent-composer]').waitFor();

      for (let count = 1; count <= 4; count++) {
        // D24 uses a new-Agent tab once a Project already has Sessions; the
        // shared driver summons either way and waits out the last launch.
        await startAgentFromLauncher(page);
        const snapshot = await waitForSessionCount(page, count);
        console.log(
          `[exact-resume] launch ${count}: ${snapshot?.map(session => `${session.id}:${session.harnessSessionId}`).join(', ')}`
        );
      }
      originalIds = await page.evaluate(async () => {
        const sessions = await window.electron?.pty?.list();
        return sessions?.map(session => session.harnessSessionId) ?? [];
      });
      if (originalIds.length !== 4 || new Set(originalIds).size !== 4) {
        throw new Error(
          `Expected four distinct Claude IDs; got ${originalIds.join(', ')}`
        );
      }

      await page.evaluate(dir => {
        window.dispatchEvent(
          new CustomEvent('exawatt:open-project', { detail: dir })
        );
      }, otherProjectDir);
      await page.locator('[data-agent-composer]').waitFor();
      for (let count = 5; count <= 6; count++) {
        await startAgentFromLauncher(page);
        await waitForSessionCount(page, count);
      }
      otherIds = await page.evaluate(async dir => {
        const sessions = (await window.electron?.pty?.list()) ?? [];
        return sessions
          .filter(session => session.projectDir === dir || session.cwd === dir)
          .map(session => session.harnessSessionId);
      }, otherProjectDir);
      if (otherIds.length !== 2 || new Set(otherIds).size !== 2) {
        throw new Error(
          `Expected two distinct IDs in the second Project; got ${otherIds.join(', ')}`
        );
      }
      await waitForPersistedIdentities(page, [...originalIds, ...otherIds]);
    },
    launchLimits
  );

  const persisted = JSON.parse(
    readFileSync(join(userData, 'workspace.json'), 'utf8')
  );
  const persistedIds = persisted.projects.flatMap(project =>
    project.tabs.map(tab => tab.harnessSessionId)
  );
  const expectedIds = [...originalIds, ...otherIds];
  if (JSON.stringify(persistedIds) !== JSON.stringify(expectedIds)) {
    throw new Error(
      'Workspace did not persist all six exact Claude identities'
    );
  }

  await withElectronApp(
    launchOptions,
    async (app, page) => {
      page.setDefaultTimeout(20_000);
      const resumeBanner = page.locator('[data-resume-recovery]');
      await resumeBanner.waitFor();
      const before = await page.evaluate(
        async () => (await window.electron?.pty?.list())?.length
      );
      if (before !== 0)
        throw new Error(`Relaunch silently spawned ${before} sessions`);
      const scope = resumeBanner.locator('[data-resume-scope-trigger]');
      const scopeRow = id =>
        page.locator(`[role="menuitem"][data-resume-scope="${id}"]`);
      await page.setViewportSize({ width: 1200, height: 800 });
      await page.screenshot({
        path: join(screenshots, 'project-default-1200.png'),
      });
      await scope.click();
      await scopeRow('agent').waitFor();
      await scopeRow('project').waitFor();
      await scopeRow('all').waitFor();
      await page.screenshot({
        path: join(screenshots, 'scope-menu-1200.png'),
      });
      await page.setViewportSize({ width: 800, height: 600 });
      await page.screenshot({
        path: join(screenshots, 'scope-menu-800.png'),
      });
      await page.keyboard.press('Escape');

      await scope.click();
      await scopeRow('project').click();
      await waitForSessionCount(page, 2);

      const scopedIds = await page.evaluate(async () => {
        const sessions = (await window.electron?.pty?.list()) ?? [];
        return sessions.map(session => session.harnessSessionId);
      });
      if (JSON.stringify(scopedIds) !== JSON.stringify(otherIds)) {
        throw new Error(
          `Project recovery crossed its boundary: ${scopedIds.join(', ')}`
        );
      }

      // BUG-305, push: the window reloads while main is inside a start. The
      // reloaded window reads a list that start is not in yet, so it must
      // learn of it from main's push and show its tab attached, untouched.
      const hold = await installStartHold(app);
      await hold.arm();
      await resumeBanner.getByRole('button').first().click();
      const pushed = await hold.held();
      await page.reload();
      await waitForWorkspaceReady(page);
      await hold.release();
      await waitForSessionCount(page, 3);
      await waitForPageCondition(
        page,
        async id => {
          const layout = await window.electron?.workspace?.load();
          const tab = layout?.projects
            ?.flatMap(project => project.tabs)
            .find(candidate => candidate.durableSessionId === id);
          const live = (await window.electron?.pty?.list())?.find(
            session => session.durableSessionId === id
          );
          return (
            !!live && tab?.sessionId === live.id && tab.lifecycle === 'running'
          );
        },
        pushed.durableSessionId,
        { label: 'the reloaded window attaching the Session main started' }
      );
      console.log(
        `[exact-resume] BUG-305: ${pushed.durableSessionId} started behind a reload and its tab attached`
      );

      // BUG-305, join: the window reloads inside the next start, and its
      // Resume asks for that very Session while main is still starting it.
      // Main must answer with that start: one readiness probe, one process,
      // no refusal.
      const logBefore = harnessEventLines().length;
      await hold.arm();
      await resumeBanner.getByRole('button').first().click();
      const joined = await hold.held();
      await page.reload();
      await waitForWorkspaceReady(page);
      const listed = await page.evaluate(
        async () => (await window.electron?.pty?.list()) ?? []
      );
      if (
        listed.some(item => item.durableSessionId === joined.durableSessionId)
      )
        throw new Error('The held Session was running before its start ended');
      await resumeBanner.getByRole('button').first().click();
      await hold.asked(2);
      await hold.release();
      await waitForSessionCount(page, 6);
      await waitForPageCondition(
        page,
        async () => {
          const layout = await window.electron?.workspace?.load();
          const tabs = layout?.projects?.flatMap(project => project.tabs) ?? [];
          return (
            tabs.length === 6 &&
            tabs.every(tab => tab.lifecycle === 'running' && tab.sessionId)
          );
        },
        undefined,
        { label: 'all six tabs attached' }
      );
      if ((await page.locator('[data-tab-lifecycle="failed"]').count()) > 0)
        throw new Error('A tab reads failed after the joined Resume');
      const { prepared } = await hold.read();
      if (prepared !== 1)
        throw new Error(`The held start prepared ${prepared} times, not once`);
      const deadline = Date.now() + 20_000;
      let answers = [];
      let starts = [];
      for (;;) {
        const lines = harnessEventLines()
          .slice(logBefore)
          .filter(line => line.durableSessionId === joined.durableSessionId);
        answers = lines
          .filter(line => line.event === 'session.ensure')
          .map(line => line.answer);
        starts = lines.filter(line => line.event === 'session.start');
        if (answers.length > 0 || Date.now() >= deadline) break;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      if (
        JSON.stringify(answers) !== JSON.stringify(['joined']) ||
        starts.length !== 1
      )
        throw new Error(
          `The Resume asked during the start was not joined to it: answers ${JSON.stringify(answers)}, starts ${starts.length}`
        );
      console.log(
        `[exact-resume] BUG-305: a Resume during ${joined.durableSessionId}'s start joined it`
      );

      const resumed = await page.evaluate(async () => {
        const pty = window.electron?.pty;
        const sessions = (await pty?.list()) ?? [];
        return await Promise.all(
          sessions.map(async session => ({
            id: session.harnessSessionId,
            buffer: (await pty?.buffer(session.id)) ?? '',
          }))
        );
      });
      const resumedIds = resumed.map(item => item.id);
      if (
        JSON.stringify([...resumedIds].sort()) !==
        JSON.stringify([...expectedIds].sort())
      ) {
        throw new Error(`Resume identity mismatch: ${resumedIds.join(', ')}`);
      }
      for (const item of resumed) {
        if (
          !item.id ||
          !item.buffer.includes(`resuming exact claude conversation ${item.id}`)
        ) {
          throw new Error(`Resume lifecycle did not name exact ID ${item.id}`);
        }
      }
    },
    launchLimits
  );
  console.log(
    'PASS exact resume: Project scope resumed two exact IDs while four stayed paused, a reload during the next start left it attached, then all six resumed'
  );
} finally {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      rmSync(root, { recursive: true, force: true });
      break;
    } catch {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
}
