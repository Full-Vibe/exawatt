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

let originalIds = [];
let otherIds = [];
try {
  await withElectronApp(
    launchOptions,
    async (_app, page) => {
      page.setDefaultTimeout(20_000);
      await page.locator('[data-command-altitude]').waitFor();
      await page.waitForFunction(
        () => !document.body.innerText.includes('Loading…')
      );
      if (!new URL(page.url()).pathname.startsWith('/workspace')) {
        await page.locator('[data-command-altitude-level="terminal"]').click();
        await page.waitForURL('**/workspace*');
        await page.waitForFunction(
          () => !document.body.innerText.includes('Loading…')
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
    async (_app, page) => {
      page.setDefaultTimeout(20_000);
      const resumeBanner = page.getByRole('region', {
        name: 'Saved Agent recovery',
      });
      await resumeBanner.waitFor();
      const before = await page.evaluate(
        async () => (await window.electron?.pty?.list())?.length
      );
      if (before !== 0)
        throw new Error(`Relaunch silently spawned ${before} sessions`);
      const scope = resumeBanner.getByRole('button', {
        name: 'Choose resume scope',
      });
      await page.setViewportSize({ width: 1200, height: 800 });
      await page.screenshot({
        path: join(screenshots, 'project-default-1200.png'),
      });
      await scope.click();
      await page.getByRole('menuitem', { name: 'Resume this agent' }).waitFor();
      await page
        .getByRole('menuitem', { name: 'Resume 2 agents in this project' })
        .waitFor();
      await page
        .getByRole('menuitem', { name: 'Resume all 6 agents' })
        .waitFor();
      await page.screenshot({
        path: join(screenshots, 'scope-menu-1200.png'),
      });
      await page.setViewportSize({ width: 800, height: 600 });
      await page.screenshot({
        path: join(screenshots, 'scope-menu-800.png'),
      });
      await page.keyboard.press('Escape');

      await scope.click();
      await page
        .getByRole('menuitem', { name: 'Resume 2 agents in this project' })
        .click();
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

      await resumeBanner
        .getByRole('button', { name: 'Resume previously running (4)' })
        .click();
      await waitForSessionCount(page, 6);

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
    'PASS exact resume: Project scope resumed two exact IDs while four stayed paused, then all six resumed'
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
