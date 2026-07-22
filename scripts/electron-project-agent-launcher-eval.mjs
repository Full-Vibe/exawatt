#!/usr/bin/env node

import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { withElectronApp } from './lib/electron-eval.mjs';

const root = mkdtempSync(join(tmpdir(), 'exawatt-project-launcher-'));
const userData = join(root, 'userData');
const fakeHome = join(root, 'home');
const fakeBin = join(root, 'bin');
const projectA = join(root, 'alpha');
const importRoot = join(root, 'projects');
const projectB = join(importRoot, 'bravo');
const projectC = join(importRoot, 'charlie');
const output = resolve('.artifacts', 'project-agent-launcher');
for (const directory of [
  userData,
  fakeHome,
  fakeBin,
  projectA,
  projectB,
  projectC,
  output,
]) {
  mkdirSync(directory, { recursive: true });
}
for (const directory of [projectA, projectB, projectC]) {
  writeFileSync(join(directory, 'package.json'), '{}');
}

for (const source of ['claude', 'codex']) {
  const executable = join(fakeBin, source);
  writeFileSync(
    executable,
    `#!/bin/sh
if [ "$1" = "-p" ]; then printf 'fixture context'; exit 0; fi
printf 'FAKE_${source.toUpperCase()}_ARGS:'
printf '<%s>' "$@"
printf '\n'
while true; do
  if IFS= read -r line; then printf '%s\n' "$line"; else /bin/sleep 1; fi
done
`
  );
  chmodSync(executable, 0o755);
}

const failures = [];
const check = (name, ok) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
  if (!ok) failures.push(name);
};

const launch = testDirectory => ({
  args: ['.'],
  cwd: process.cwd(),
  env: {
    ...process.env,
    HOME: fakeHome,
    PATH: `${fakeBin}:${process.env.PATH ?? ''}`,
    NODE_ENV: 'development',
    EXAWATT_TEST: '1',
    EXAWATT_USER_DATA: userData,
    EXAWATT_TEST_DIR: testDirectory,
    EXAWATT_TEST_HARNESS_BIN: fakeBin,
    EXAWATT_TEST_QUIT_RESPONSES: 'confirm,confirm,confirm',
    EXAWATT_DEV_URL: `${process.env.EXA_BASE ?? 'http://localhost:7011'}/workspace`,
  },
});

async function sessions(page) {
  return await page.evaluate(
    async () => (await window.electron?.pty?.list()) ?? []
  );
}

async function waitForSessionCount(page, count) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const current = await sessions(page);
    if (current.length === count) return current;
    await page.waitForTimeout(100);
  }
  throw new Error(`Timed out waiting for ${count} Sessions`);
}

// D23: parked sessions stay in pty.list() as exited records — LIVE count is
// the honest signal for stop flows
async function waitForLiveSessionCount(page, count) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const current = await sessions(page);
    if (current.filter(s => !s.exited).length === count) return current;
    await page.waitForTimeout(100);
  }
  throw new Error(`Timed out waiting for ${count} live Sessions`);
}

// close grammar (D27): one Close per tab; a STARTED agent pops the in-app
// confirm, where ⏎ presses the default Close button.
async function closeTab(page, title) {
  const closeButton = page.getByRole('button', { name: `Close ${title}` });
  await closeButton.click();
  const confirm = page.locator('[data-close-confirm]');
  try {
    await confirm.waitFor({ timeout: 700 });
    await page.keyboard.press('Enter');
  } catch {
    // unstarted or stopped — closed without ceremony
  }
  await closeButton.waitFor({ state: 'detached', timeout: 15_000 });
}

async function waitForBuffer(page, sessionId, fragment) {
  await page.waitForFunction(
    async ({ id, text }) =>
      ((await window.electron?.pty?.buffer(id)) ?? '').includes(text),
    { id: sessionId, text: fragment }
  );
}

let completed = false;
try {
  await withElectronApp(
    launch(projectA),
    async (app, page) => {
      page.setDefaultTimeout(20_000);
      page.on('pageerror', error =>
        console.log(`[project-launcher] pageerror: ${error.message}`)
      );
      await page.locator('[data-command-altitude]').waitFor();

      const fileMenu = await app.evaluate(({ Menu }) =>
        Menu.getApplicationMenu()
          .items.find(item => item.label === 'File')
          ?.submenu?.items.map(item => `${item.label}|${item.accelerator}`)
      );
      check(
        'native File menu exposes the Project chooser',
        fileMenu?.includes('Open Project…|Command+N')
      );

      await page.keyboard.press('Meta+KeyN');
      await page.locator('[data-project-opener]').waitFor();
      check('Command-N opens the Exawatt Project chooser', true);
      check(
        'opening the chooser creates no process',
        (await sessions(page)).length === 0
      );
      await page.screenshot({ path: join(output, '01-project-chooser.png') });

      await page.getByRole('button', { name: 'Browse Folder' }).click();
      await page
        .locator('[data-agent-composer]')
        .waitFor();
      check(
        'Browse opens an inert Project',
        (await sessions(page)).length === 0
      );

      await page.keyboard.press('Control+Meta+2');
      const emptyProject = page.locator('[data-expose-empty-project]').filter({
        hasText: 'No Sessions yet',
      });
      await emptyProject.waitFor();
      check(
        'Sessions keeps the zero-Session Project visible',
        (await emptyProject.getAttribute('data-expose-empty-project')) ===
          projectA && (await page.locator('[data-expose-tile]').count()) === 0
      );
      await page.waitForTimeout(250);
      await page.screenshot({
        path: join(output, '02-empty-project-sessions.png'),
      });

      // Leave immediately, before the normal debounce. Route teardown must
      // flush the shared Project catalog so Spatial sees the same identity.
      await page.keyboard.press('Control+Meta+3');
      await page.waitForURL('**/fleet/spatial**');
      const clusterId = `project:${projectA}`;
      const emptyZone = page.locator(`[data-board-zone="${clusterId}"]`);
      try {
        await emptyZone.waitFor();
      } catch (error) {
        const state = await page.evaluate(() => ({
          url: window.location.href,
          board: document
            .querySelector('[data-spatial-board]')
            ?.getAttribute('data-board-projects'),
          zones: Array.from(
            document.querySelectorAll('[data-board-zone]')
          ).map(z => z.getAttribute('data-board-zone')),
        }));
        console.log(`[project-launcher] spatial state: ${JSON.stringify(state)}`);
        await page.screenshot({ path: join(output, 'debug-spatial.png') });
        throw error;
      }
      check(
        'Spatial keeps the same zero-Agent Project visible',
        (await page
          .locator('[data-spatial-board]')
          .getAttribute('data-board-projects')) === '1' &&
          (await page
            .locator('[data-spatial-board]')
            .getAttribute('data-board-pieces')) === '0' &&
          (await emptyZone.innerText()).includes('No agents yet')
      );
      await emptyZone.click();
      await page.waitForURL(
        url =>
          url.searchParams.get('altitude') === 'project' &&
          url.searchParams.get('project') === clusterId
      );
      check(
        'empty Spatial Project remains drillable at Project altitude',
        (await page
          .locator('[data-spatial-board]')
          .getAttribute('data-board-projects')) === '1' &&
          (await page
            .locator('[data-spatial-board]')
            .getAttribute('data-board-pieces')) === '0'
      );
      await page.screenshot({
        path: join(output, '03-empty-project-spatial.png'),
      });

      await page.keyboard.press('Control+Meta+1');
      await page.waitForURL('**/workspace**');
      await page
        .locator('[data-agent-composer]')
        .waitFor();

      const firstTask = "Review the user's auth flow";
      check(
        'new Project and source pair visibly defaults to YOLO',
        (await page.getByLabel('Agent permissions').innerText()).includes(
          'YOLO'
        )
      );
      const permissionTrigger = page.getByLabel('Agent permissions');
      await permissionTrigger.focus();
      await page.keyboard.press('Space');
      const permissionMenu = page.getByRole('listbox');
      await permissionMenu.waitFor();
      const permissionMenuText = await permissionMenu.innerText();
      check(
        'permission menu explains all three access policies',
        (await page.getByRole('option').count()) === 3 &&
          permissionMenuText.includes('Ask first') &&
          permissionMenuText.includes('Keep harness protections on') &&
          permissionMenuText.includes('Auto-review') &&
          permissionMenuText.includes('Routine work proceeds') &&
          permissionMenuText.includes('YOLO') &&
          permissionMenuText.includes('No approvals or sandbox')
      );
      await page.keyboard.press('Home');
      await page.keyboard.press('Escape');
      await page.waitForFunction(
        () =>
          document.activeElement?.getAttribute('aria-label') ===
          'Agent permissions'
      );
      check(
        'Escape preserves YOLO and returns focus to the permission trigger',
        (await permissionTrigger.innerText()).includes('YOLO') &&
          (await permissionTrigger.evaluate(
            element => document.activeElement === element
          ))
      );
      await page.getByLabel('Initial task for the new Agent').fill(firstTask);
      await page.getByRole('button', { name: 'Start' }).click();
      await page.waitForTimeout(500);
      const launchAlert = await page
        .locator('[role="alert"]')
        .allInnerTexts()
        .catch(() => []);
      const launchAlertText = launchAlert.join(' | ').trim();
      if (launchAlertText) {
        console.log(`[project-launcher] launch alert: ${launchAlertText}`);
      }
      let current = await waitForSessionCount(page, 1);
      check(
        'default Agent Source starts Claude Code',
        current[0].harness === 'claude'
      );
      await waitForBuffer(page, current[0].id, `<${firstTask}>`);
      check('initial task arrives as one quoted source argument', true);
      await waitForBuffer(
        page,
        current[0].id,
        '<--dangerously-skip-permissions>'
      );
      check('Claude Code receives the visible YOLO policy', true);

      await page.keyboard.press('Control+Meta+3');
      await page.waitForURL(
        url =>
          url.searchParams.get('altitude') === 'project' &&
          url.searchParams.get('project') === clusterId
      );
      await page.waitForFunction(
        () =>
          document
            .querySelector('[data-spatial-board]')
            ?.getAttribute('data-board-pieces') === '1'
      );
      check(
        'the first Agent populates the existing Project instead of duplicating it',
        (await page
          .locator('[data-spatial-board]')
          .getAttribute('data-board-projects')) === '1' &&
          (await page
            .locator('[data-agent-count]')
            .getAttribute('data-agent-count')) === '1'
      );
      await page.keyboard.press('Control+Meta+1');
      await page.waitForURL('**/workspace**');

      // the composer is summoned, not permanent (D18): with a live tab it
      // rests collapsed, so reopen it before driving its controls. (This
      // wait was missing since the summon landed — the eval only passed
      // while the composer was always-open.)
      await page.locator('[data-composer-toggle]').click();
      await page.locator('[data-agent-composer]').waitFor();
      await page.getByLabel('Agent Source').click();
      await page.getByRole('option', { name: 'Codex' }).click();
      check(
        'a new Codex pair has its own YOLO default',
        (await page.getByLabel('Agent permissions').innerText()).includes(
          'YOLO'
        )
      );
      await page.getByLabel('Agent permissions').focus();
      await page.keyboard.press('Space');
      await page.locator('[role="listbox"]').waitFor();
      // keyboard doctrine (D24): from the YOLO default (last option),
      // ArrowUp must land on Auto-review and ⏎ must commit it — the
      // Select's keyboard path is a first-class contract
      await page.keyboard.press('ArrowUp');
      await page.waitForFunction(() =>
        document
          .querySelector('[role="option"][data-highlighted]')
          ?.textContent?.includes('Auto-review')
      );
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => {
        const trigger = document.querySelector(
          '[aria-label="Agent permissions"]'
        );
        return (
          trigger?.textContent?.includes('Auto') &&
          document.activeElement === trigger
        );
      });
      check(
        'KEYBOARD selection commits Auto-review and restores trigger focus',
        (await page.getByLabel('Agent permissions').innerText()).includes(
          'Auto'
        ) &&
          (await page
            .getByLabel('Agent permissions')
            .evaluate(element => document.activeElement === element))
      );
      await page.getByLabel('Agent Source').click();
      await page.getByRole('option', { name: 'Claude Code' }).click();
      await page.waitForFunction(() =>
        document
          .querySelector('[aria-label="Agent Source"]')
          ?.textContent?.includes('Claude Code')
      );
      await page.getByLabel('Agent Source').click();
      await page.getByRole('option', { name: 'Codex' }).click();
      await page.waitForFunction(() =>
        document
          .querySelector('[aria-label="Agent Source"]')
          ?.textContent?.includes('Codex')
      );
      check(
        'an unlaunched policy choice survives a harness round trip',
        (await page.getByLabel('Agent permissions').innerText()).includes(
          'Auto'
        )
      );
      await page
        .getByLabel('Initial task for the new Agent')
        .fill('Run focused tests');
      await page.getByRole('button', { name: 'Start' }).click();
      current = await waitForSessionCount(page, 2);
      check(
        'a second Agent can start in the same Project',
        current
          .map(item => item.harness)
          .sort()
          .join(',') === 'claude,codex'
      );
      const codex = current.find(item => item.harness === 'codex');
      await waitForBuffer(page, codex.id, '<Run focused tests>');
      check('Codex receives its first task through the launch contract', true);
      await waitForBuffer(page, codex.id, '<approvals_reviewer="auto_review">');
      check('Codex receives the visible Auto-review policy', true);

      await page.keyboard.press('Meta+KeyK');
      const palette = page.locator('[cmdk-list]');
      await palette.waitFor();
      const paletteText = await palette.innerText();
      check(
        'palette separates Agent start from shell tools',
        paletteText.includes('Start Agent') &&
          paletteText.includes('Start Agent with Codex') &&
          paletteText.includes('Tools') &&
          paletteText.includes('Open shell in the active Project')
      );
      await page
        .getByText('Start Agent with Claude Code', { exact: true })
        .click();
      await page.getByLabel('Initial task for the new Agent').waitFor();
      await page.waitForFunction(
        () =>
          document
            .querySelector('[aria-label="Agent Source"]')
            ?.textContent?.includes('Claude Code') &&
          document
            .querySelector('[aria-label="Agent permissions"]')
            ?.textContent?.includes('YOLO')
      );
      check(
        'palette routes into the visible composer with that harness policy',
        (await page.getByLabel('Agent Source').innerText()).includes(
          'Claude Code'
        ) &&
          (await page.getByLabel('Agent permissions').innerText()).includes(
            'YOLO'
          )
      );
      await page.getByLabel('Agent Source').click();
      await page.getByRole('option', { name: 'Codex' }).click();
      await page.waitForFunction(() =>
        document
          .querySelector('[aria-label="Agent Source"]')
          ?.textContent?.includes('Codex')
      );

      await page.screenshot({
        path: join(output, '04-two-agents-composer.png'),
      });
      await closeTab(page, 'Claude Code');
      await waitForLiveSessionCount(page, 1);
      await closeTab(page, 'Codex');
      await waitForLiveSessionCount(page, 0);
      const ledger = await page.evaluate(
        async () => (await window.electron?.pty?.closedSessions?.()) ?? []
      );
      check(
        'both closed Sessions land in the Recently-closed ledger',
        ledger.length === 2
      );
      await page.waitForTimeout(1_000);
      const afterCloseLayout = await page.evaluate(() =>
        window.electron?.workspace?.load()
      );
      check(
        'zero-Session Project is durably checkpointed',
        afterCloseLayout?.projects?.some(
          project => project.name === 'alpha' && project.tabs.length === 0
        )
      );
      check(
        'closing the last Session retains the Project',
        await page.locator('[data-project="alpha"]').isVisible()
      );
      check(
        'last source recommendation survives close-last-tab',
        (await page.getByLabel('Agent Source').innerText()).includes('Codex')
      );
      check(
        'Project and harness permission survives close-last-tab',
        (await page.getByLabel('Agent permissions').innerText()).includes(
          'Auto'
        )
      );

      await page.reload({ waitUntil: 'networkidle' });
      await page
        .locator('[data-agent-composer]')
        .waitFor();
      check(
        'inert Project survives renderer reload',
        (await sessions(page)).length === 0
      );
      check(
        'source recommendation survives reload',
        (await page.getByLabel('Agent Source').innerText()).includes('Codex')
      );
      check(
        'permission recommendation survives reload',
        (await page.getByLabel('Agent permissions').innerText()).includes(
          'Auto'
        )
      );
      await page.getByLabel('Agent Source').click();
      await page.getByRole('option', { name: 'Claude Code' }).click();
      check(
        'Claude and Codex retain independent permission choices',
        (await page.getByLabel('Agent permissions').innerText()).includes(
          'YOLO'
        )
      );
      await page.getByLabel('Agent Source').click();
      await page.getByRole('option', { name: 'Codex' }).click();

      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].setSize(800, 600)
      );
      await page.waitForTimeout(300);
      const composerBounds = await page
        .locator('[data-agent-composer]')
        .evaluate(element => {
          const box = element.getBoundingClientRect();
          return { left: box.left, right: box.right, width: window.innerWidth };
        });
      check(
        'composer remains inside the narrow workspace',
        composerBounds.left >= 0 && composerBounds.right <= composerBounds.width
      );
      await page.screenshot({
        path: join(output, '05-empty-project-800x600.png'),
      });
    },
    { maxMs: 120_000 }
  );

  await withElectronApp(
    launch(importRoot),
    async (_app, page) => {
      page.setDefaultTimeout(20_000);
      await page.locator('[data-command-altitude]').waitFor();
      await page
        .locator('[data-agent-composer]')
        .waitFor();
      check(
        'source recommendation survives a full app restart',
        (await page.getByLabel('Agent Source').innerText()).includes('Codex')
      );
      check(
        'permission recommendation survives a full app restart',
        (await page.getByLabel('Agent permissions').innerText()).includes(
          'Auto'
        )
      );
      await page.keyboard.press('Meta+KeyN');
      await page.locator('[data-project-opener]').waitFor();
      const alphaTile = page
        .locator('[data-project-opener] button')
        .filter({ hasText: 'alpha' });
      await alphaTile.waitFor();
      check(
        'curated library includes the previously opened inert Project',
        await alphaTile.isVisible()
      );
      await page.getByRole('button', { name: 'Import Folder' }).click();
      await page.getByText('Import Projects', { exact: true }).waitFor();
      check(
        'parent import presents a reviewed selection',
        (await page.getByRole('checkbox').count()) === 2
      );
      await page.getByRole('button', { name: 'Import 2' }).click();
      await page
        .locator('[data-agent-composer]')
        .waitFor();
      check(
        'importing Projects starts no process',
        (await sessions(page)).length === 0
      );
      await page.locator('[data-project="bravo"]').waitFor();
      await page.getByRole('button', { name: 'Open shell in bravo' }).click();
      const shell = await waitForSessionCount(page, 1);
      check(
        'shell remains an explicit Project tool',
        shell[0]?.harness === 'shell'
      );
      await closeTab(page, 'Shell');
      await waitForSessionCount(page, 0);
      // ⌘T ⏎ then ⌘W (D24): a bare agent never given work DISCARDS — it
      // must not pollute the Recently-closed ledger. (bravo is empty, so
      // its pane composer is already inline.)
      await page
        .getByLabel('Initial task for the new Agent')
        .press('Enter');
      const bare = (
        await waitForLiveSessionCount(page, 1)
      ).find(session => !session.exited);
      await closeTab(page, bare.title);
      await waitForLiveSessionCount(page, 0);
      const ledgerAfterDiscard = await page.evaluate(
        async () => (await window.electron?.pty?.closedSessions?.()) ?? []
      );
      check(
        'a never-started agent discards without joining the ledger',
        !ledgerAfterDiscard.some(
          entry => entry.durableSessionId === bare?.durableSessionId
        )
      );
      check(
        'closing a shell retains its Project',
        await page.locator('[data-project="bravo"]').isVisible()
      );
      await page.keyboard.press('Meta+KeyN');
      await page.locator('[data-project-opener]').waitFor();
      for (const name of ['alpha', 'bravo', 'charlie']) {
        await page
          .locator('[data-project-opener] button')
          .filter({ hasText: name })
          .waitFor();
      }
      const chooserText = await page
        .locator('[data-project-opener]')
        .innerText();
      check(
        'imported Projects join the curated library',
        ['alpha', 'bravo', 'charlie'].every(name => chooserText.includes(name))
      );
      await page.screenshot({ path: join(output, '04-imported-library.png') });
    },
    { maxMs: 90_000 }
  );
  completed = true;
} finally {
  if (completed && failures.length === 0 && !process.env.EXAWATT_KEEP_EVAL) {
    rmSync(root, { recursive: true, force: true });
  } else {
    console.log(`[project-launcher] fixture retained: ${root}`);
  }
}

if (failures.length > 0) {
  throw new Error(
    `${failures.length} project/Agent checks failed: ${failures.join(', ')}`
  );
}
console.log('PASS Project opener + Agent composer evaluator');
