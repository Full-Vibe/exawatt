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
        .locator('[data-agent-composer][data-variant="empty"]')
        .waitFor();
      check(
        'Browse opens an inert Project',
        (await sessions(page)).length === 0
      );

      const firstTask = "Review the user's auth flow";
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

      await page.getByLabel('Agent Source').click();
      await page.getByRole('option', { name: 'Codex' }).click();
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
      await page.getByText('Start Agent with Codex', { exact: true }).click();
      await page.getByLabel('Initial task for the new Agent').waitFor();
      check(
        'palette routes into the visible composer',
        (await page.getByLabel('Agent Source').innerText()).includes('Codex')
      );

      await page.screenshot({
        path: join(output, '02-two-agents-composer.png'),
      });
      await page.getByRole('button', { name: 'Close Claude Code' }).click();
      await waitForSessionCount(page, 1);
      await page.getByRole('button', { name: 'Close Codex' }).click();
      await waitForSessionCount(page, 0);
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

      await page.reload({ waitUntil: 'networkidle' });
      await page
        .locator('[data-agent-composer][data-variant="empty"]')
        .waitFor();
      check(
        'inert Project survives renderer reload',
        (await sessions(page)).length === 0
      );
      check(
        'source recommendation survives reload',
        (await page.getByLabel('Agent Source').innerText()).includes('Codex')
      );

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
        path: join(output, '03-empty-project-800x600.png'),
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
        .locator('[data-agent-composer][data-variant="empty"]')
        .waitFor();
      check(
        'source recommendation survives a full app restart',
        (await page.getByLabel('Agent Source').innerText()).includes('Codex')
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
        .locator('[data-agent-composer][data-variant="empty"]')
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
      await page.getByRole('button', { name: 'Close Shell' }).click();
      await waitForSessionCount(page, 0);
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
