#!/usr/bin/env node

/**
 * The app-lifecycle owner, end to end in a real Electron app (BUG-260,
 * BUG-285, BUG-286). Headless, against this worktree's dev server, with a
 * throwaway userData. Restart to Update runs through the product updater's
 * test double (`electron/main/updater-test-double.ts`), whose staging is
 * chosen per launch: `stall`, `refuse` or `accept`.
 *
 *   1. BUG-285  a dismissed "New local build installed" stays dismissed when
 *               a second build installs under the same running one, when
 *               the app is activated, when the window reloads, and after a
 *               relaunch of the same build
 *   2. BUG-286  a stalled update names its wait and Cancel leaves the shell
 *               running; a refusal shows its reason with the shell running
 *   3. BUG-260  Restart to Update keeps what lived only for the run (the
 *               Fleet camera and return, in session storage) and comes back
 *               to the Fleet altitude; a plain quit keeps none of it
 *   4. W28      "What's new" shows once after the app starts on a newer
 *               version the feed publishes, and never on a first install,
 *               on the same version, without a feed answer (a dogfood
 *               build) or for a version the feed has not published; its
 *               dismissal holds across a reload and a relaunch
 *
 * EXA_BASE=http://localhost:<port> pnpm eval:electron:app-lifecycle
 */

import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  openShellFromLauncher,
  waitForPageCondition,
  waitForWorkspaceReady,
  withElectronApp,
} from './lib/electron-eval.mjs';

const base = process.env.EXA_BASE || 'http://localhost:7000';
const root = mkdtempSync(join(tmpdir(), 'exawatt-app-lifecycle-'));
const userData = join(root, 'userData');
const projectDir = join(root, 'project');
mkdirSync(userData, { recursive: true });
mkdirSync(projectDir, { recursive: true });

function launch(extra = {}, data = userData) {
  return {
    args: ['.'],
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: 'development',
      EXAWATT_TEST: '1',
      EXAWATT_USER_DATA: data,
      EXAWATT_DEV_URL: `${base}/workspace`,
      EXAWATT_TEST_QUIT_RESPONSES: 'confirm,confirm,confirm,confirm',
      ...extra,
    },
  };
}

const limits = {
  maxMs: 150_000,
  firstWindowMs: 45_000,
  readsHarnessHistory: true,
};

/** The installer's state file, as `scripts/install-dogfood.mjs` writes it. */
function install(sha) {
  const file = join(userData, 'update-state.json');
  writeFileSync(`${file}.tmp`, JSON.stringify({ installedSha: sha }));
  // A rename, as the installer does, so the watcher never reads half a file.
  renameSync(`${file}.tmp`, file);
}

const localNotice = page => page.getByText('New local build installed.');

async function installedSeen(page, sha) {
  await waitForPageCondition(
    page,
    async expected =>
      (await window.electron.app.installedBuild())?.installedSha === expected,
    sha
  );
}

async function openProjectWithShell(page) {
  await waitForWorkspaceReady(page);
  await page.evaluate(dir => {
    window.dispatchEvent(
      new CustomEvent('exawatt:open-project', { detail: dir })
    );
  }, projectDir);
  await page
    .locator('[data-agent-composer], [data-composer-toggle]')
    .first()
    .waitFor();
  await openShellFromLauncher(page);
  return await waitForPageCondition(page, async () => {
    const live = (await window.electron.pty.list()).filter(
      session => !session.exited
    );
    return live.length === 1 ? live[0] : null;
  });
}

async function liveSessions(page) {
  return await page.evaluate(
    async () =>
      (await window.electron.pty.list()).filter(session => !session.exited)
        .length
  );
}

const restartToUpdate = page =>
  page.getByRole('button', { name: 'Restart to Update' });

try {
  // ---- 1. BUG-285 ---------------------------------------------------------
  let runningSha = null;
  await withElectronApp(
    launch(),
    async (app, page) => {
      page.setDefaultTimeout(30_000);
      await waitForWorkspaceReady(page);
      runningSha = (
        await page.evaluate(() => window.electron.app.getBuildInfo())
      ).sha;
      install('dogfood-first');
      await localNotice(page).waitFor();
      await page.getByRole('button', { name: 'Dismiss update notice' }).click();
      await localNotice(page).waitFor({ state: 'detached' });

      // 2026-10-05 19:41: a second build installs under the same stale one.
      install('dogfood-second');
      await installedSeen(page, 'dogfood-second');
      // Returning to the app.
      await app.evaluate(async ({ app: electronApp }) => {
        electronApp.emit('activate');
      });
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      assert.equal(
        await localNotice(page).count(),
        0,
        'BUG-285: a second install under the same running build re-announced the dismissed notice'
      );

      await page.reload();
      await waitForWorkspaceReady(page);
      await installedSeen(page, 'dogfood-second');
      assert.equal(
        await localNotice(page).count(),
        0,
        'BUG-285: a reload brought back the dismissed notice'
      );
      await app.evaluate(async ({ app: electronApp }) => electronApp.quit());
    },
    limits
  );
  await withElectronApp(
    launch(),
    async (app, page) => {
      await waitForWorkspaceReady(page);
      await installedSeen(page, 'dogfood-second');
      assert.equal(
        await localNotice(page).count(),
        0,
        'BUG-285: a relaunch of the same build re-announced the dismissed notice'
      );
      await app.evaluate(async ({ app: electronApp }) => electronApp.quit());
    },
    limits
  );
  rmSync(join(userData, 'update-state.json'), { force: true });
  console.log(`[app-lifecycle] BUG-285 holds for running build ${runningSha}`);

  // ---- 2. BUG-286 ---------------------------------------------------------
  await withElectronApp(
    launch({ EXAWATT_TEST_PRODUCT_UPDATE: '9.9.9:stall' }),
    async (app, page) => {
      page.setDefaultTimeout(30_000);
      await openProjectWithShell(page);
      await restartToUpdate(page).click();
      await page.getByText('Waiting for macOS to accept the update.').waitFor();
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
      await waitForPageCondition(
        page,
        async () =>
          (await window.electron.app.shutdownStatus()).phase === 'idle'
      );
      assert.equal(
        await liveSessions(page),
        1,
        'BUG-286: cancelling a stalled update stopped the shell'
      );
      await restartToUpdate(page).waitFor();
      console.log('[app-lifecycle] stalled update named and cancelled');
      await app.evaluate(async ({ app: electronApp }) => electronApp.quit());
    },
    limits
  );

  await withElectronApp(
    launch({ EXAWATT_TEST_PRODUCT_UPDATE: '9.9.9:refuse' }),
    async (app, page) => {
      page.setDefaultTimeout(30_000);
      await openProjectWithShell(page);
      await restartToUpdate(page).click();
      await page
        .getByText(
          /Update failed, so .* stays installed\. Could not locate update bundle/
        )
        .waitFor();
      assert.equal(
        await liveSessions(page),
        1,
        'BUG-286: a refused update stopped the shell'
      );
      console.log('[app-lifecycle] refused update reported, shell running');
      await app.evaluate(async ({ app: electronApp }) => electronApp.quit());
    },
    limits
  );

  // ---- 3. BUG-260 ---------------------------------------------------------
  const heldKey = 'exawatt:eval-held-position';
  const viewportKey = 'exawatt:spatial-viewport:v2:fleet:~:~:top-down';
  let movedViewport = null;
  const sessionValue = page =>
    page.evaluate(key => window.sessionStorage.getItem(key), heldKey);
  await withElectronApp(
    launch({ EXAWATT_TEST_PRODUCT_UPDATE: '9.9.9:accept' }),
    async (app, page) => {
      page.setDefaultTimeout(30_000);
      await openProjectWithShell(page);
      await page.locator('[data-command-altitude-level="spatial"]').click();
      await page.waitForURL(/\/fleet\/spatial/);
      // What lives only for the run: the Fleet camera, the Fleet return.
      await page.evaluate(
        key => window.sessionStorage.setItem(key, 'kept'),
        heldKey
      );
      // The operator pans the Fleet camera: its viewport is what he holds.
      // Pan it through the board itself, as he would. Writing the stored
      // pose behind the board's back raced the board's own save of its
      // in-memory pose, which lands whenever the camera reports (2026-10-19:
      // it overwrote the write within half a second).
      const settledViewport = key =>
        waitForPageCondition(
          page,
          async storageKey => {
            const read = () => window.sessionStorage.getItem(storageKey);
            const before = read();
            for (let frame = 0; frame < 30; frame++) {
              await new Promise(resolve => requestAnimationFrame(resolve));
            }
            return before && read() === before ? before : null;
          },
          key,
          { label: 'a settled Fleet camera' }
        );
      const arrived = await settledViewport(viewportKey);
      const board = await page.locator('canvas').first().boundingBox();
      assert.ok(board, 'the Fleet board has no canvas');
      await page.mouse.move(
        board.x + board.width / 2,
        board.y + board.height / 2
      );
      await page.mouse.wheel(-120, 0);
      movedViewport = await waitForPageCondition(
        page,
        async ([storageKey, from]) => {
          const read = () => window.sessionStorage.getItem(storageKey);
          const before = read();
          if (!before || before === from) return null;
          for (let frame = 0; frame < 30; frame++) {
            await new Promise(resolve => requestAnimationFrame(resolve));
          }
          return read() === before ? JSON.parse(before) : null;
        },
        [viewportKey, arrived],
        { label: 'the panned Fleet camera, settled' }
      );
      assert.notEqual(
        movedViewport.centerX,
        JSON.parse(arrived).centerX,
        'the pan did not move the Fleet camera'
      );
      const closed = new Promise(resolve => app.once('close', resolve));
      await restartToUpdate(page).click();
      await closed;
    },
    limits
  );
  const record = JSON.parse(
    readFileSync(join(userData, 'run-state.json'), 'utf8')
  );
  assert.equal(record.clean, true, 'the update restart did not end cleanly');
  assert.equal(record.exit, 'update');
  assert.equal(
    record.held?.['session-storage']?.[heldKey],
    'kept',
    'BUG-260: the update restart did not keep what the run held'
  );
  assert.equal(
    JSON.parse(record.held['session-storage'][viewportKey]).centerX,
    movedViewport.centerX,
    'BUG-260: the update restart did not keep the Fleet camera'
  );
  await withElectronApp(
    launch(),
    async (app, page) => {
      page.setDefaultTimeout(30_000);
      await page.waitForURL(/\/fleet\/spatial/);
      assert.equal(
        await sessionValue(page),
        'kept',
        'BUG-260: the relaunch after the update lost what the run held'
      );
      // The Fleet camera opens where he left it, not at a fresh fit.
      await waitForPageCondition(
        page,
        ({ key, centerX }) =>
          JSON.parse(window.sessionStorage.getItem(key) ?? 'null')?.centerX ===
          centerX,
        { key: viewportKey, centerX: movedViewport.centerX },
        { label: 'the Fleet camera restored to where the operator left it' }
      );
      assert.equal(
        await liveSessions(page),
        0,
        'the relaunch revived work without the operator'
      );
      console.log(
        '[app-lifecycle] BUG-260 relaunch kept the altitude and the run’s position'
      );
      const closed = new Promise(resolve => app.once('close', resolve));
      await app.evaluate(async ({ app: electronApp }) => electronApp.quit());
      await closed;
    },
    limits
  );
  // A quit is the operator leaving: nothing per-run comes back.
  await withElectronApp(
    launch(),
    async (app, page) => {
      await page.waitForURL(/\/fleet\/spatial/);
      assert.equal(
        await sessionValue(page),
        null,
        'a plain quit carried per-run state into the next launch'
      );
      await app.evaluate(async ({ app: electronApp }) => electronApp.quit());
    },
    limits
  );

  // ---- 4. ENG-031 W28 -----------------------------------------------------
  const newsData = join(root, 'news-userData');
  mkdirSync(newsData, { recursive: true });
  const { version: running } = JSON.parse(
    readFileSync(join(process.cwd(), 'package.json'), 'utf8')
  );
  const runRecord = join(newsData, 'run-state.json');
  const ranBefore = version => {
    const previous = JSON.parse(readFileSync(runRecord, 'utf8'));
    writeFileSync(runRecord, JSON.stringify({ ...previous, version }));
  };
  const feedPublishes = version => ({
    EXAWATT_TEST_PRODUCT_UPDATE: `${version}:latest`,
  });
  const news = page => page.locator('[data-whats-new]');
  /** How many news notices show once every fact it reads has answered. */
  const newsShown = async page => {
    await waitForWorkspaceReady(page);
    await waitForPageCondition(page, async () => {
      await window.electron.app.previousVersion();
      const updates = window.electron.app.updates;
      // Only a launch with an update channel waits for the feed's answer.
      return !updates || (await updates.getStatus()).availableVersion !== null;
    });
    await page.evaluate(
      () =>
        new Promise(resolve =>
          requestAnimationFrame(() => requestAnimationFrame(resolve))
        )
    );
    return await news(page).count();
  };
  const quit = app =>
    app.evaluate(async ({ app: electronApp }) => electronApp.quit());
  const expectNoNews = async (env, message) =>
    await withElectronApp(
      launch(env, newsData),
      async (app, page) => {
        page.setDefaultTimeout(30_000);
        assert.equal(await newsShown(page), 0, message);
        await quit(app);
      },
      limits
    );

  await expectNoNews(
    feedPublishes(running),
    "W28: a first install showed What's new"
  );
  ranBefore('0.0.1');
  await withElectronApp(
    launch(feedPublishes(running), newsData),
    async (app, page) => {
      page.setDefaultTimeout(30_000);
      await news(page).waitFor();
      assert.match(
        await news(page).getAttribute('href'),
        new RegExp(`/changelog/${running.replaceAll('.', '\\.')}$`),
        "W28: What's new does not lead to this version's changelog page"
      );
      await page.getByRole('button', { name: 'Dismiss update notice' }).click();
      await news(page).waitFor({ state: 'detached' });
      await page.reload();
      assert.equal(
        await newsShown(page),
        0,
        "W28: a reload brought back a dismissed What's new"
      );
      await quit(app);
    },
    limits
  );
  ranBefore('0.0.1');
  await expectNoNews(
    feedPublishes(running),
    "W28: a relaunch brought back a dismissed What's new"
  );
  rmSync(join(newsData, 'notice-dismissals.json'), { force: true });
  await expectNoNews(
    feedPublishes(running),
    "W28: a relaunch of the same version showed What's new"
  );
  ranBefore('0.0.1');
  await expectNoNews({}, "W28: a build with no feed answer showed What's new");
  ranBefore('0.0.1');
  await expectNoNews(
    feedPublishes('0.0.2'),
    "W28: What's new showed for a version the feed has not published"
  );
  console.log(`[app-lifecycle] W28 What's new holds for ${running}`);

  console.log(
    'PASS app lifecycle: dismissed notice holds (BUG-285); stalled and refused updates leave Sessions running (BUG-286); update restart keeps the run’s held state (BUG-260); What’s new shows once per new published version (W28)'
  );
} finally {
  if (process.env.EXAWATT_KEEP_EVAL && existsSync(root)) {
    console.log(`[app-lifecycle] retained fixture: ${root}`);
  } else {
    try {
      rmSync(root, { recursive: true, force: true, maxRetries: 5 });
    } catch (error) {
      console.error(
        `[app-lifecycle] could not remove fixture ${root}: ${error}`
      );
    }
  }
}
