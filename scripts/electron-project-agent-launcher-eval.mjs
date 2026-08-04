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
if [ "$1" = "debug" ] && [ "$2" = "models" ]; then
  printf '%s\\n' '{"models":[{"slug":"eval-codex-sol","display_name":"Eval Codex Sol","description":"Frontier evaluator model.","visibility":"list","priority":1,"default_reasoning_level":"low","supported_reasoning_levels":[{"effort":"low","description":"Fast evaluator reasoning."},{"effort":"high","description":"Deep evaluator reasoning."},{"effort":"max","description":"Maximum evaluator reasoning."}]},{"slug":"eval-codex-terra","display_name":"Eval Codex Terra","description":"Balanced evaluator model.","visibility":"list","priority":2,"default_reasoning_level":"medium","supported_reasoning_levels":[{"effort":"low","description":"Fast evaluator reasoning."},{"effort":"medium","description":"Balanced evaluator reasoning."},{"effort":"high","description":"Deep evaluator reasoning."},{"effort":"max","description":"Maximum evaluator reasoning."}]}]}'
  exit 0
fi
if [ "$1" = "--safe-mode" ]; then
  printf '%s\\n' '{"type":"control_response","response":{"subtype":"success","request_id":"exawatt-model-catalog","response":{"models":[{"value":"default","displayName":"Account default","description":"Claude Code chooses the recommended model for your account.","supportsEffort":true,"supportedEffortLevels":["low","medium","high","xhigh","max"]},{"value":"eval-claude-fable","displayName":"Eval Claude Fable","description":"Frontier evaluator model.","supportsEffort":true,"supportedEffortLevels":["high","max"]}]}}}'
  exit 0
fi
if [ "$1" = "--version" ]; then
  printf '${source === 'claude' ? '2.1.220 (Claude Code)' : 'codex-cli 0.146.0'}\\n'
  exit 0
fi
if [ "$1" = "auth" ] && [ "$2" = "status" ]; then
  printf '%s\\n' '{"loggedIn":true,"email":"operator@example.com","subscriptionType":"max"}'
  exit 0
fi
if [ "$1" = "login" ] && [ "$2" = "status" ]; then
  printf 'Logged in using ChatGPT\\n'
  exit 0
fi
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

const launch = () => ({
  args: ['.'],
  cwd: process.cwd(),
  env: {
    ...process.env,
    HOME: fakeHome,
    PATH: `${fakeBin}:${process.env.PATH ?? ''}`,
    NODE_ENV: 'development',
    EXAWATT_TEST: '1',
    EXAWATT_USER_DATA: userData,
    EXAWATT_TEST_HARNESS_BIN: fakeBin,
    EXAWATT_TEST_QUIT_RESPONSES: 'confirm,confirm,confirm',
    EXAWATT_DEV_URL: `${process.env.EXA_BASE ?? 'http://localhost:7011'}/workspace`,
  },
});

async function stubDirectoryPicker(app, selectedDirectory) {
  await app.evaluate(({ dialog }, directory) => {
    globalThis.__EXAWATT_DIRECTORY_PICKER_CALLS = [];
    dialog.showOpenDialog = async (...args) => {
      const attached = args.length === 2;
      const parent = attached ? args[0] : null;
      const options = attached ? args[1] : args[0];
      const webModalMounted = parent
        ? await parent.webContents.executeJavaScript(
            "document.querySelector('[data-project-opener]') !== null"
          )
        : null;
      globalThis.__EXAWATT_DIRECTORY_PICKER_CALLS.push({
        attached,
        options,
        webModalMounted,
      });
      return {
        canceled: false,
        filePaths: [directory],
        bookmarks: [],
      };
    };
  }, selectedDirectory);
}

async function directoryPickerCalls(app) {
  return await app.evaluate(
    () => globalThis.__EXAWATT_DIRECTORY_PICKER_CALLS ?? []
  );
}

async function sessions(page) {
  return await page.evaluate(
    async () => (await window.electron?.pty?.list()) ?? []
  );
}

async function nativeSessionMenu(app) {
  return await app.evaluate(({ Menu }) =>
    Menu.getApplicationMenu()
      .items.find(item => item.label === 'Session')
      ?.submenu?.items.map(item => ({
        label: item.label,
        accelerator: item.accelerator,
        enabled: item.enabled,
      }))
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

async function waitForClosedSessionCount(page, count) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const entries = await page.evaluate(
      async () => (await window.electron?.pty?.closedSessions?.()) ?? []
    );
    if (entries.length === count) return entries;
    await page.waitForTimeout(50);
  }
  throw new Error(`Timed out waiting for ${count} closed Sessions`);
}

// close grammar (D27): one Close per tab; a STARTED agent pops the in-app
// confirm, where ⏎ presses the default Close button.
async function closeTab(page, title) {
  const source =
    title === 'Claude Code'
      ? 'claude'
      : title === 'Codex'
        ? 'codex'
        : title === 'Shell'
          ? 'shell'
          : null;
  const closeButton = source
    ? page
        .locator(`[data-tab-harness="${source}"]`)
        .getByRole('button', { name: /^Close / })
        .first()
    : page.getByRole('button', { name: `Close ${title}` });
  const closingTabId = await closeButton.evaluate(button =>
    button.closest('[data-tab-id]')?.getAttribute('data-tab-id')
  );
  if (!closingTabId) throw new Error(`Could not resolve tab for ${title}`);
  await closeButton.click();
  const confirm = page.locator('[data-close-confirm]');
  try {
    await confirm.waitFor({ timeout: 700 });
    await page.keyboard.press('Enter');
  } catch {
    // unstarted or stopped — closed without ceremony
  }
  await page
    .locator(`[data-tab-id="${closingTabId}"]`)
    .waitFor({ state: 'detached', timeout: 15_000 });
}

async function waitForBuffer(page, sessionId, fragment) {
  await page.waitForFunction(
    async ({ id, text }) =>
      ((await window.electron?.pty?.buffer(id)) ?? '').includes(text),
    { id: sessionId, text: fragment }
  );
}

async function showLaunchCustomization(page) {
  const customization = page.locator('[data-launch-customize]');
  if (await customization.isVisible().catch(() => false)) return customization;
  await page.getByRole('button', { name: 'Customize' }).click();
  await customization.waitFor({ state: 'visible' });
  return customization;
}

let completed = false;
try {
  await withElectronApp(
    launch(),
    async (app, page) => {
      page.setDefaultTimeout(20_000);
      page.on('pageerror', error =>
        console.log(`[project-launcher] pageerror: ${error.message}`)
      );
      await page.locator('[data-command-altitude]').waitFor();
      await stubDirectoryPicker(app, projectA);
      await page.waitForTimeout(250);

      const fileMenu = await app.evaluate(({ Menu }) =>
        Menu.getApplicationMenu()
          .items.find(item => item.label === 'File')
          ?.submenu?.items.map(item => `${item.label}|${item.accelerator}`)
      );
      check(
        'native File menu exposes the Project chooser',
        fileMenu?.includes('Open Project…|Command+N')
      );
      const sessionMenu = await nativeSessionMenu(app);
      check(
        'native Session menu describes the contextual close target',
        sessionMenu?.some(
          item =>
            item.label === 'Close Tab or Empty Project' &&
            item.accelerator === 'Command+W'
        )
      );
      check(
        'native Session menu shows distinct shell and reopen chords',
        sessionMenu?.some(
          item =>
            item.label === 'Open Shell' && item.accelerator === 'Command+Alt+T'
        ) &&
          sessionMenu?.some(
            item =>
              item.label === 'Reopen Closed Tab' &&
              item.accelerator === 'Command+Shift+T'
          )
      );
      check(
        'native Session menu disables commands without a current target',
        [
          'Open Shell',
          'Reopen Closed Tab',
          'Rename Session',
          'Split: Pin / Unpin',
          'Close Tab or Empty Project',
          'Jump to Session Needing You',
        ].every(
          label =>
            sessionMenu?.find(item => item.label === label)?.enabled === false
        )
      );

      await page.keyboard.press('Meta+KeyK');
      const unavailableShell = page.locator(
        '[cmdk-item][data-launch-configuration="shell"]'
      );
      await unavailableShell.waitFor();
      check(
        'palette explains why shell is unavailable without a Project',
        (await unavailableShell.getAttribute('data-disabled')) === 'true' &&
          (await unavailableShell.innerText()).includes('Open a Project first')
      );
      const unavailableJump = page.locator('[cmdk-item]').filter({
        hasText: 'Jump to the Session needing you',
      });
      check(
        'palette explains that no Session currently needs attention',
        (await unavailableJump.getAttribute('data-disabled')) === 'true' &&
          (await unavailableJump.innerText()).includes('No Sessions need you')
      );
      await page.keyboard.press('Escape');

      await page.keyboard.press('Meta+KeyN');
      await page.locator('[data-project-opener]').waitFor();
      check('Command-N opens the Exawatt Project chooser', true);
      check(
        'opening the chooser creates no process',
        (await sessions(page)).length === 0
      );
      await page.waitForFunction(
        () =>
          document.activeElement?.getAttribute('aria-label') ===
          'Search Projects'
      );
      await page.keyboard.press('Tab');
      check(
        'Browse Folder participates in the Project chooser tab cycle',
        await page
          .getByRole('button', { name: 'Browse Folder' })
          .evaluate(
            button =>
              document.activeElement === button &&
              button.tabIndex === 0 &&
              !button.disabled
          )
      );
      await page.keyboard.press('Shift+Tab');
      await page.screenshot({ path: join(output, '01-project-chooser.png') });

      await page.getByRole('button', { name: 'Browse Folder' }).click();
      await page.locator('[data-agent-composer]').waitFor();
      const [pickerCall] = await directoryPickerCalls(app);
      check(
        'Browse releases the web modal before requesting the native picker',
        pickerCall?.webModalMounted === false
      );
      check(
        'Browse invokes a window-owned native directory picker',
        pickerCall?.attached === true &&
          pickerCall?.options?.title === 'Open Project' &&
          pickerCall?.options?.properties?.includes('openDirectory')
      );
      check(
        'Browse opens an inert Project',
        (await sessions(page)).length === 0
      );

      await page.keyboard.press('Meta+KeyJ');
      await page.waitForTimeout(300);
      check(
        'Command-J stays in Terminal when no visible Session needs attention',
        await page
          .locator(
            '[data-command-altitude-level="terminal"][aria-current="page"]'
          )
          .isVisible()
      );

      await page.waitForTimeout(100);
      const emptyProjectMenu = await nativeSessionMenu(app);
      check(
        'native Session menu enables only valid empty-Project commands',
        emptyProjectMenu?.find(item => item.label === 'Open Shell')?.enabled ===
          true &&
          emptyProjectMenu?.find(
            item => item.label === 'Close Tab or Empty Project'
          )?.enabled === true &&
          emptyProjectMenu?.find(item => item.label === 'Rename Session')
            ?.enabled === false &&
          emptyProjectMenu?.find(item => item.label === 'Split: Pin / Unpin')
            ?.enabled === false &&
          emptyProjectMenu?.find(
            item => item.label === 'Jump to Session Needing You'
          )?.enabled === false
      );

      await page.keyboard.press('Meta+KeyK');
      const availableShell = page.locator(
        '[cmdk-item][data-launch-configuration="shell"]'
      );
      await availableShell.waitFor();
      const projectEdit = page.locator('[cmdk-item]').filter({
        hasText: 'Rename or recolor the active Project',
      });
      check(
        'palette follows empty-Project command availability',
        (await availableShell.getAttribute('data-disabled')) !== 'true' &&
          (await projectEdit.getAttribute('data-disabled')) !== 'true' &&
          (await unavailableJump.getAttribute('data-disabled')) === 'true'
      );
      await page.keyboard.press('Escape');

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
          zones: Array.from(document.querySelectorAll('[data-board-zone]')).map(
            z => z.getAttribute('data-board-zone')
          ),
        }));
        console.log(
          `[project-launcher] spatial state: ${JSON.stringify(state)}`
        );
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
      await page.locator('[data-agent-composer]').waitFor();

      const launchRibbon = page.locator('[data-launch-configuration-ribbon]');
      const selectedConfiguration = launchRibbon.locator(
        '[role="radio"][aria-checked="true"]'
      );
      check(
        'the composer keeps the primary launch path lightweight',
        (await page.getByLabel('Initial task for the new Agent').isVisible()) &&
          (await launchRibbon.isVisible()) &&
          (await selectedConfiguration.count()) === 1 &&
          (await selectedConfiguration.isVisible()) &&
          (await page.getByRole('button', { name: 'Start' }).isVisible()) &&
          (await page.getByRole('button', { name: 'Customize' }).isVisible()) &&
          (await page
            .getByRole('button', { name: 'All launch configurations' })
            .isVisible()) &&
          (await page.getByLabel('Agent Source').isHidden())
      );
      await page
        .getByRole('button', { name: 'All launch configurations' })
        .click();
      const allConfigurations = page.locator(
        '[data-all-launch-configurations]'
      );
      await allConfigurations.waitFor();
      check(
        'All configurations discloses the complete launch catalog',
        (await allConfigurations.innerText()).includes('All configurations') &&
          (await allConfigurations.getByRole('button').count()) > 1
      );
      await page
        .getByRole('button', { name: 'All launch configurations' })
        .click();
      await allConfigurations.waitFor({ state: 'detached' });
      await showLaunchCustomization(page);

      const firstTask = "Review the user's auth flow";
      await page.waitForFunction(() =>
        document
          .querySelector('[role="combobox"][aria-label^="Agent model:"]')
          ?.textContent?.includes('Account default')
      );
      const claudeModelTrigger = page.getByRole('combobox', {
        name: /^Agent model:/,
      });
      check(
        'the composer shows the effective Claude model before launch',
        (await claudeModelTrigger.innerText()).includes('Account default')
      );
      // The rows must be the ones the installed CLI reported, not a list
      // Exawatt keeps of its own.
      await claudeModelTrigger.click();
      const claudeModelMenu = page.getByRole('listbox');
      await claudeModelMenu.waitFor();
      check(
        'Claude model choices mirror the catalog the installed CLI reports',
        (await claudeModelMenu.innerText()).includes('Eval Claude Fable')
      );
      await page.screenshot({
        path: join(output, '04-claude-model-options.png'),
      });
      await page.keyboard.press('Escape');
      await claudeModelMenu.waitFor({ state: 'hidden' });
      const claudeEffortTrigger = page.getByLabel('Agent effort');
      await page.waitForFunction(() =>
        document
          .querySelector('[aria-label="Agent effort"]')
          ?.textContent?.includes('Auto')
      );
      check(
        'the composer shows Claude effort beside its model',
        (await claudeEffortTrigger.innerText()).includes('Auto')
      );
      await claudeEffortTrigger.click();
      const claudeEffortMenu = page.getByRole('listbox');
      await claudeEffortMenu.waitFor();
      check(
        'Claude effort choices explain the speed-depth tradeoff',
        (await claudeEffortMenu.innerText()).includes('Fastest for short') &&
          (await claudeEffortMenu.innerText()).includes('Extra high') &&
          (await claudeEffortMenu.innerText()).includes('DEFAULT')
      );
      await page.getByRole('option', { name: /High.*Strong balance/i }).click();
      await page.waitForFunction(() =>
        document
          .querySelector('[aria-label="Agent effort"]')
          ?.textContent?.includes('High')
      );
      check(
        'the operator can override Claude effort for one new Agent',
        (await claudeEffortTrigger.innerText()).includes('High')
      );
      check(
        'new Project and source pair visibly defaults to YOLO',
        (await page.getByLabel('Agent permissions').innerText()).includes(
          'YOLO'
        )
      );
      const permissionTrigger = page.getByLabel('Agent permissions');
      await permissionTrigger.click();
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
      await waitForBuffer(page, current[0].id, '<--model><default>');
      check('Claude Code receives the visible model choice', true);
      await waitForBuffer(page, current[0].id, '<--effort><high>');
      check('Claude Code receives the visible effort override', true);

      const activeTab = page.locator('[data-tab-id][data-active]');
      const activeTabChrome = activeTab.locator('[data-tab-chrome]');
      await activeTabChrome.focus();
      await page.keyboard.press('Shift+F10');
      const sessionActions = page.getByRole('menu');
      await sessionActions.waitFor();
      check(
        'Shift-F10 opens every active Session action',
        (await sessionActions.innerText()).includes('Rename…') &&
          (await sessionActions.innerText()).includes('Pin in split') &&
          (await sessionActions.innerText()).includes('Close')
      );
      await page.keyboard.press('Escape');
      check(
        'dismissing Session actions returns focus to the invoking tab',
        await activeTabChrome.evaluate(
          element => document.activeElement === element
        )
      );

      await page.waitForTimeout(100);
      const activeSessionMenu = await nativeSessionMenu(app);
      check(
        'native Session menu enables tab commands but not attention without a target',
        activeSessionMenu?.find(item => item.label === 'Rename Session')
          ?.enabled === true &&
          activeSessionMenu?.find(item => item.label === 'Split: Pin / Unpin')
            ?.enabled === true &&
          activeSessionMenu?.find(
            item => item.label === 'Jump to Session Needing You'
          )?.enabled === false
      );

      const menuDuringReload = await app.evaluate(
        ({ BrowserWindow, Menu }) =>
          new Promise(resolve => {
            const win = BrowserWindow.getAllWindows()[0];
            win.webContents.once('did-start-loading', () => {
              resolve(
                ['close-tab', 'rename-tab', 'toggle-split'].map(id => ({
                  id,
                  enabled:
                    Menu.getApplicationMenu().getMenuItemById(id)?.enabled ??
                    null,
                }))
              );
            });
            win.webContents.reload();
          })
      );
      check(
        'native Session commands reset while renderer truth reloads',
        menuDuringReload.every(item => item.enabled === false)
      );
      await page.locator('[data-command-altitude]').waitFor();
      await page.waitForFunction(async () => {
        const api = window.electron?.pty;
        return ((await api?.list()) ?? []).length > 0;
      });
      await page.waitForTimeout(100);
      const menuAfterReload = await nativeSessionMenu(app);
      check(
        'native Session commands republish after workspace hydration',
        menuAfterReload?.find(
          item => item.label === 'Close Tab or Empty Project'
        )?.enabled === true
      );

      await page.keyboard.press('Control+Meta+3');
      await page.waitForURL(url => url.pathname === '/fleet/spatial');
      await page.waitForTimeout(100);
      const spatialSessionMenu = await nativeSessionMenu(app);
      check(
        'native Session menu disables workspace-local commands in Spatial',
        [
          'Rename Session',
          'Split: Pin / Unpin',
          'Close Tab or Empty Project',
          'Jump to Session Needing You',
        ].every(
          label =>
            spatialSessionMenu?.find(item => item.label === label)?.enabled ===
            false
        )
      );
      await page.keyboard.press('Control+Meta+1');
      await page.waitForURL(url => url.pathname === '/workspace');

      await activeTab.locator('[data-status="done"]').waitFor({
        timeout: 8_000,
      });
      await page.evaluate(
        async ({ id }) =>
          window.electron?.pty?.write(id, 'PASSIVE_IDLE_REPAINT\n'),
        { id: current[0].id }
      );
      await waitForBuffer(page, current[0].id, 'PASSIVE_IDLE_REPAINT');
      await page.waitForTimeout(250);
      current = await sessions(page);
      check(
        'passive PTY repaint cannot reopen a finished Agent turn',
        current[0].working === false &&
          (await activeTab.locator('[data-status="done"]').count()) === 1 &&
          (await activeTab.locator('[data-status="working"]').count()) === 0
      );
      await page.locator('.terminal-pane[data-pane="full"]').click();
      await page.keyboard.type('NEXT_OPERATOR_TURN');
      await page.keyboard.press('Enter');
      await waitForBuffer(page, current[0].id, 'NEXT_OPERATOR_TURN');
      await activeTab.locator('[data-status="working"]').waitFor();
      check('operator input explicitly opens the next Agent turn', true);

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
      await showLaunchCustomization(page);
      const sourceTrigger = page.getByLabel('Agent Source');
      check(
        'Agent Source trigger owns exactly one harness glyph',
        (await sourceTrigger.locator('[data-slot="harness-glyph"]').count()) ===
          1
      );
      await sourceTrigger.click();
      const claudeOption = page.getByRole('option', { name: 'Claude Code' });
      const codexOption = page.getByRole('option', { name: 'Codex' });
      check(
        'Agent Source options each retain one harness glyph',
        (await claudeOption.locator('[data-slot="harness-glyph"]').count()) ===
          1 &&
          (await codexOption.locator('[data-slot="harness-glyph"]').count()) ===
            1
      );
      await page.screenshot({
        path: join(output, '04-source-options.png'),
      });
      await codexOption.click();
      await page.waitForFunction(() =>
        document
          .querySelector('[role="combobox"][aria-label^="Agent model:"]')
          ?.textContent?.includes('Eval Codex Sol')
      );
      check(
        'changing Agent Source keeps one trigger glyph',
        (await sourceTrigger.locator('[data-slot="harness-glyph"]').count()) ===
          1
      );
      check(
        'a new Codex pair has its own YOLO default',
        (await page.getByLabel('Agent permissions').innerText()).includes(
          'YOLO'
        )
      );
      const modelTrigger = page.getByRole('combobox', {
        name: /^Agent model:/,
      });
      check(
        'Codex exposes the installed catalog default beside Agent Source',
        (await modelTrigger.innerText()).includes('Eval Codex Sol')
      );
      await modelTrigger.click();
      const modelMenu = page.getByRole('listbox');
      await modelMenu.waitFor();
      check(
        'model choices explain their role and mark the current default',
        (await modelMenu.innerText()).includes('Frontier evaluator model') &&
          (await modelMenu.innerText()).includes('Balanced evaluator model') &&
          (await modelMenu.innerText()).includes('DEFAULT')
      );
      await page.screenshot({
        path: join(output, '04-model-options.png'),
      });
      await page
        .getByRole('option', { name: /Eval Codex Terra.*Balanced evaluator/i })
        .click();
      check(
        'the operator can override the model for one new Agent',
        (await modelTrigger.innerText()).includes('Eval Codex Terra')
      );
      const effortTrigger = page.getByLabel('Agent effort');
      check(
        'changing models reveals that model’s default effort',
        (await effortTrigger.innerText()).includes('Medium')
      );
      await effortTrigger.click();
      const effortMenu = page.getByRole('listbox');
      await effortMenu.waitFor();
      check(
        'Codex effort choices come from the selected model catalog',
        (await effortMenu.innerText()).includes(
          'Balanced evaluator reasoning'
        ) &&
          (await effortMenu.innerText()).includes(
            'Maximum evaluator reasoning'
          ) &&
          (await effortMenu.innerText()).includes('DEFAULT')
      );
      await page.screenshot({
        path: join(output, '04-effort-options.png'),
      });
      await page
        .getByRole('option', { name: /Max.*Maximum evaluator reasoning/i })
        .click();
      check(
        'the operator can override Codex effort for one new Agent',
        (await effortTrigger.innerText()).includes('Max')
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
      // Keep the draft: it is the composer under test, and the launch below
      // consumes it into the second Agent. Discarding it here would select
      // the neighbouring live Session instead (D24 close policy), leaving no
      // composer to assert against — and would drop the per-source model and
      // effort choices the launch assertions depend on. The later
      // palette-opened draft is the one that needs an explicit discard.
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
      await waitForBuffer(page, codex.id, '<--model><eval-codex-terra>');
      check('Codex receives the visible model override', true);
      await waitForBuffer(page, codex.id, '<-c><model_reasoning_effort="max">');
      check('Codex receives the visible effort override', true);

      await page.keyboard.press('Meta+KeyK');
      const palette = page.locator('[cmdk-list]');
      await palette.waitFor();
      const paletteText = await palette.innerText();
      check(
        'palette presents exact Agent and Shell launch configurations together',
        paletteText.includes('Start') &&
          paletteText.includes('Claude Code') &&
          paletteText.includes('Codex') &&
          paletteText.includes('OpenCode') &&
          paletteText.includes('Shell')
      );
      await page.getByText('Claude Code', { exact: true }).click();
      await page.getByLabel('Initial task for the new Agent').waitFor();
      await showLaunchCustomization(page);
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
      // The palette policy check above deliberately opened an unlaunched
      // draft. It is still an Agent tab, so discard it before asserting the
      // true close-last-Agent Project transition.
      await closeTab(page, 'New agent');
      // Tab removal is intentionally optimistic; wait for the async archive
      // transaction instead of racing it after the chrome disappears.
      const ledger = await waitForClosedSessionCount(page, 2);
      check(
        'both closed Sessions land in the Recently-closed ledger',
        ledger.length === 2
      );
      await page.locator('[data-agent-composer]').waitFor();
      await showLaunchCustomization(page);
      check(
        'closing the last Agent leaves the empty Project selected',
        await page.locator('[data-project="alpha"]').isVisible()
      );
      check(
        'last source recommendation survives in the empty Project',
        (await page.getByLabel('Agent Source').innerText()).includes('Codex')
      );
      check(
        'Project and harness permission survive in the empty Project',
        (await page.getByLabel('Agent permissions').innerText()).includes(
          'Auto'
        )
      );
      const guardedTask = 'Keep this launch intent in the open Project';
      await page.getByLabel('Initial task for the new Agent').fill(guardedTask);
      await page.getByRole('button', { name: 'Close New agent' }).waitFor();
      check(
        'typing in the empty Project promotes a durable draft',
        (await page.locator('[data-project="alpha"]').count()) === 1 &&
          (await page
            .getByLabel('Initial task for the new Agent')
            .inputValue()) === guardedTask
      );
      await closeTab(page, 'New agent');
      await page.locator('[data-agent-composer]').waitFor();
      const alphaProject = page.locator('[data-project="alpha"]');
      await page.waitForTimeout(4_400);
      check(
        'the selected exhausted Project remains open instead of auto-closing',
        (await alphaProject.count()) === 1 &&
          !(await alphaProject.getAttribute('data-project-exiting')) &&
          !(await alphaProject.getAttribute('data-project-dormant'))
      );
      await page.screenshot({
        path: join(output, '05-empty-project-retained.png'),
      });
      const afterLastCloseLayout = await page.evaluate(() =>
        window.electron?.workspace?.load()
      );
      check(
        'closing the last Agent preserves the open Project object',
        afterLastCloseLayout?.projects?.some(
          project => project.name === 'alpha'
        )
      );

      // Browser-style restore is ledger-backed, not a fresh launch. Two rapid
      // presses must pop newest then next-newest into the retained Project, and
      // neither restore may spawn a process.
      await page.keyboard.press('Meta+Shift+KeyT');
      await page.keyboard.press('Meta+Shift+KeyT');
      await page.waitForFunction(async () => {
        const closed = (await window.electron?.pty?.closedSessions?.()) ?? [];
        return closed.length === 0;
      });
      await page.locator('[data-tab-harness="codex"]').waitFor();
      await page.locator('[data-tab-harness="claude"]').waitFor();
      const secondRestoredIsActive = await page
        .locator(
          `[data-durable-session-id="${ledger[1].durableSessionId}"][data-active="true"]`
        )
        .isVisible();
      check(
        'Command-Shift-T walks Recently closed in LIFO order',
        secondRestoredIsActive
      );
      check(
        'reopen repopulates the retained Project without starting a process',
        (await page.locator('[data-project="alpha"]').count()) === 1 &&
          (await sessions(page)).length === 0
      );

      // The close is optimistic and its archive is asynchronous. Reopen must
      // wait behind that exact in-flight close rather than observing an empty
      // ledger and losing the user's immediate undo.
      const closingTabId = await page
        .locator('[data-tab-id][data-active="true"]')
        .getAttribute('data-tab-id');
      await page.keyboard.press('Meta+KeyW');
      await page.keyboard.press('Meta+Shift+KeyT');
      await page.waitForFunction(
        ({ previousId, durableSessionId }) => {
          const active = document.querySelector(
            `[data-durable-session-id="${durableSessionId}"][data-active="true"]`
          );
          return active?.getAttribute('data-tab-id') !== previousId;
        },
        {
          previousId: closingTabId,
          durableSessionId: ledger[1].durableSessionId,
        }
      );
      const ledgerAfterImmediateUndo = await page.evaluate(
        async () => (await window.electron?.pty?.closedSessions?.()) ?? []
      );
      check(
        'immediate Command-W then Command-Shift-T waits for archive and restores',
        ledgerAfterImmediateUndo.length === 0
      );

      // Put both stopped Sessions back in the ledger so the remaining explicit
      // Project-close and recency checks continue against their original fixture.
      await closeTab(page, 'Claude Code');
      await closeTab(page, 'Codex');
      await waitForClosedSessionCount(page, 2);
      await page.locator('[data-agent-composer]').waitFor();
      await showLaunchCustomization(page);
      check(
        'source recommendation survives the close and restore cycle',
        (await page.getByLabel('Agent Source').innerText()).includes('Codex')
      );
      check(
        'permission recommendation survives the close and restore cycle',
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
        path: join(output, '06-empty-project-800x600.png'),
      });

      await page.keyboard.press('Meta+KeyK');
      await page
        .getByText('Close the active tab or empty Project', { exact: true })
        .waitFor();
      check('command palette describes the contextual close target', true);
      await page.keyboard.press('Escape');

      // The source switch above is authored launch intent, so it promoted a
      // real draft tab. Discard it first: the close verb follows the active UI
      // object, so with a draft present Command-W would close that tab, not
      // the Project.
      await closeTab(page, 'New agent');
      await page.locator('[data-agent-composer]').waitFor();

      // The close verb follows the active UI object. With no Agent tab left,
      // Command-W closes the selected empty Project immediately.
      await page.evaluate(() => {
        globalThis.__EXAWATT_SAW_PROJECT_EXIT = false;
        const observer = new MutationObserver(records => {
          for (const record of records) {
            if (
              record.type === 'attributes' &&
              record.target instanceof Element &&
              record.target.matches(
                '[data-project="alpha"][data-project-exiting="true"]'
              )
            ) {
              globalThis.__EXAWATT_SAW_PROJECT_EXIT = true;
            }
          }
        });
        observer.observe(document.body, {
          attributes: true,
          attributeFilter: ['data-project-exiting'],
          childList: true,
          subtree: true,
        });
        globalThis.__EXAWATT_PROJECT_EXIT_OBSERVER = observer;
      });
      await page.keyboard.press('Meta+KeyW');
      await page
        .locator('[data-project="alpha"]')
        .waitFor({ state: 'detached' });
      const sawCommandExit = await page.evaluate(() => {
        globalThis.__EXAWATT_PROJECT_EXIT_OBSERVER?.disconnect();
        return globalThis.__EXAWATT_SAW_PROJECT_EXIT === true;
      });
      check(
        'Command-W closes an explicitly opened empty Project through its exit state',
        sawCommandExit
      );
      await page.waitForTimeout(600);

      // Reopen once more so the explicit context-menu entry remains covered
      // independently of the keyboard path.
      await page.keyboard.press('Meta+KeyN');
      await page.locator('[data-project-opener]').waitFor();
      await page
        .locator('[data-project-opener] button')
        .filter({ hasText: 'alpha' })
        .click();
      await page.locator('[data-agent-composer]').waitFor();

      const projectChrome = page.locator(
        '[data-project="alpha"] [data-project-chrome]'
      );
      await projectChrome.focus();
      await page.keyboard.press('Shift+F10');
      const projectActions = page.getByRole('menu', {
        name: 'alpha Project actions',
      });
      await projectActions.waitFor();
      check(
        'Shift-F10 exposes empty-Project rename, color, and close actions',
        (await projectActions.innerText()).includes('Rename / color…') &&
          (await projectActions.innerText()).includes('Close project')
      );
      await page.keyboard.press('Escape');
      check(
        'dismissing Project actions returns focus to the Project chip',
        await projectChrome.evaluate(
          element => document.activeElement === element
        )
      );

      // The explicit context-menu verb is the pointer counterpart to ⌘W.
      // Leave the app with alpha closed so the
      // next launch proves durable library reentry rather than open-layout
      // persistence.
      await page.locator('[data-project="alpha"]').click({ button: 'right' });
      await page.getByRole('menuitem', { name: 'Close project' }).click();
      await page
        .locator('[data-project="alpha"][data-project-exiting="true"]')
        .waitFor({ state: 'attached' });
      await page
        .locator('[data-project="alpha"]')
        .waitFor({ state: 'detached' });
      check('Project context menu closes an empty Project', true);
      await page.waitForTimeout(600);
    },
    { maxMs: 240_000, firstWindowMs: 90_000 }
  );

  await withElectronApp(
    launch(),
    async (app, page) => {
      page.setDefaultTimeout(20_000);
      await page.locator('[data-command-altitude]').waitFor();
      await stubDirectoryPicker(app, importRoot);
      await page.keyboard.press('Meta+KeyN');
      await page.locator('[data-project-opener]').waitFor();
      const alphaTile = page
        .locator('[data-project-opener] button')
        .filter({ hasText: 'alpha' });
      await alphaTile.waitFor();
      check(
        'curated library includes the previously closed Project',
        await alphaTile.isVisible()
      );
      await alphaTile.click();
      await page.locator('[data-agent-composer]').waitFor();
      await showLaunchCustomization(page);
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
      await page.getByRole('button', { name: 'Import Folder' }).click();
      await page.getByText('Import Projects', { exact: true }).waitFor();
      check(
        'parent import presents a reviewed selection',
        (await page.getByRole('checkbox').count()) === 2
      );
      await page.getByRole('button', { name: 'Import 2' }).click();
      await page.locator('[data-agent-composer]').waitFor();
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
      await page.getByLabel('Initial task for the new Agent').press('Enter');
      const bare = (await waitForLiveSessionCount(page, 1)).find(
        session => !session.exited
      );
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
      await page.getByRole('button', { name: 'charlie', exact: true }).click();
      const dormantBravo = page.locator(
        '[data-project="bravo"][data-project-dormant="true"]'
      );
      await dormantBravo.waitFor({ state: 'attached', timeout: 6_000 });
      check(
        'an inactive empty Project settles into the dormant ribbon tail',
        await dormantBravo.isVisible()
      );
      await page.getByRole('button', { name: 'bravo', exact: true }).click();
      await dormantBravo.waitFor({ state: 'detached' });
      check(
        'selecting a dormant Project restores it without starting work',
        (await page.locator('[data-project="bravo"]').count()) === 1 &&
          (await sessions(page)).length === 0
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
    { maxMs: 180_000, firstWindowMs: 90_000 }
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
