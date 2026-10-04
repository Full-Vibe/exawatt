#!/usr/bin/env node

// ENG-045: the permission primer and Settings > Permissions, through the real
// main, preload, IPC and renderer. Only the native notification read is a
// fixture (`EXAWATT_TEST_NOTIFICATION_AUTHORIZATION`), built to the addon's
// own surface, so no run raises a real macOS prompt or changes this Mac's
// notification grants. System Settings is never opened: `shell.openExternal`
// is observed, not performed.
import assert from 'node:assert/strict';
import { mkdirSync, rmSync } from 'node:fs';
import {
  createHarnessFixture,
  fixtureLaunch,
  openFixtureSession,
} from './lib/harness-event-fixture.mjs';
import { waitForPageCondition, withElectronApp } from './lib/electron-eval.mjs';

const base = process.env.EXA_BASE ?? 'http://localhost:7000';
const screenshots =
  process.env.EXAWATT_PERMISSIONS_SCREENSHOTS ??
  '/tmp/exawatt-permissions-eval';
mkdirSync(screenshots, { recursive: true });

const NOTIFICATIONS_PANE =
  'x-apple.systempreferences:com.apple.Notifications-Settings.extension';

async function run(name, authorization, body, { path = '/settings' } = {}) {
  const fixture = createHarnessFixture(`exawatt-permissions-${name}`);
  try {
    await withElectronApp(
      fixtureLaunch(fixture, {
        EXAWATT_TEST_NOTIFICATION_AUTHORIZATION: authorization,
        EXAWATT_TEST_NOTIFICATION_ANSWER: 'granted',
        EXAWATT_DEV_URL: `${base}${path}`,
      }),
      async (app, page) => {
        page.setDefaultTimeout(25_000);
        await page.setViewportSize({ width: 1100, height: 760 });
        await page.waitForFunction(
          () => Boolean(window.electron?.permissions),
          null,
          {
            timeout: 90_000,
          }
        );
        // Observe System Settings being opened; never open it.
        await app.evaluate(({ shell }) => {
          globalThis.__opened = [];
          shell.openExternal = async url => {
            globalThis.__opened.push(url);
          };
        });
        await body(app, page, fixture);
      }
    );
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
}

const state = page =>
  page.evaluate(
    async () => (await window.electron.permissions.snapshot())[0].state
  );
/** Polls a main-process observation until it holds; the effect, not a delay. */
async function until(condition, label, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  while (!(await condition())) {
    if (Date.now() > deadline)
      throw new Error(`TIMED OUT waiting for ${label}`);
    await new Promise(resolve => setTimeout(resolve, 50));
  }
}
const opened = app => app.evaluate(() => globalThis.__opened);
/** Dialogs and nav fade in; a screenshot waits for the motion to finish. */
async function shot(page, file) {
  await page.evaluate(() =>
    Promise.all(document.getAnimations().map(animation => animation.finished))
  );
  await page.screenshot({ path: `${screenshots}/${file}.png` });
}
/** Settings hydrates after it paints, so a click can land before React hears
 *  it. Click again until the section it opens is there. */
async function openSection(page, name, ready) {
  await until(async () => {
    if ((await ready.count()) > 0) return true;
    await page.getByRole('button', { name, exact: true }).click();
    return (await ready.count()) > 0;
  }, `the ${name} section`);
}
const openPermissions = page =>
  openSection(
    page,
    'Permissions',
    page.locator('[data-permission="notifications"]')
  );
const openPreferences = page =>
  openSection(page, 'Preferences', nativeSwitch(page));
/** By attribute, not by role: while a dialog is open the page behind it is
 *  hidden from the accessibility tree, and the switch is still on screen. */
const nativeSwitch = page =>
  page.locator(
    'button[role="switch"][aria-label="Native macOS notifications"]'
  );
const row = page => page.locator('[data-permission="notifications"]');
const primer = page => page.locator('[data-permission-primer]');

// 1. A Mac that never answered: Allow shows the primer, the primer raises
//    nothing, and only Continue reaches the system.
await run('first-run', 'not-determined', async (_app, page) => {
  await openPermissions(page);
  await row(page).getByText('Not asked yet').waitFor();
  assert.equal(
    await row(page)
      .getByRole('button', { name: 'Open System Settings' })
      .count(),
    0
  );
  await shot(page, '1-section-not-asked');

  await row(page).getByRole('button', { name: 'Allow' }).click();
  await primer(page).waitFor();
  assert.equal(
    await primer(page).locator('button').count(),
    1,
    'the primer has one button'
  );
  assert.match(await primer(page).locator('button').innerText(), /Continue/);
  assert.equal(
    await state(page),
    'not-determined',
    'showing the primer must not raise the prompt'
  );
  await shot(page, '2-primer');

  await primer(page)
    .getByRole('button', { name: /Continue/ })
    .click();
  await primer(page).waitFor({ state: 'detached' });
  await row(page).getByText('Allowed').waitFor();
  assert.equal(await state(page), 'granted');
  await shot(page, '3-section-allowed');
});

// 2. Turning on the Settings switch is a moment of need: it primes first and
//    follows the answer.
await run('switch', 'not-determined', async (_app, page) => {
  await openPreferences(page);
  const toggle = nativeSwitch(page);
  await toggle.waitFor();
  assert.equal(await toggle.getAttribute('aria-checked'), 'false');
  await toggle.click();
  await primer(page).waitFor();
  assert.equal(await state(page), 'not-determined');
  assert.equal(
    await toggle.getAttribute('aria-checked'),
    'false',
    'off until it is allowed'
  );
  await primer(page)
    .getByRole('button', { name: /Continue/ })
    .click();
  await waitForPageCondition(
    page,
    async () =>
      (await window.electron.settings.get()).notifications?.attention === true,
    null
  );
  await toggle.waitFor();
  assert.equal(await toggle.getAttribute('aria-checked'), 'true');
});

// 3. The first notification moment: an agent needs the user while Exawatt is in
//    the background and notifications are on. Main raises nothing; the primer
//    is what the user finds on return, and Continue is what reaches macOS.
await run(
  'moment',
  'not-determined',
  async (_app, page, fixture) => {
    const { send, until } = await openFixtureSession(page, fixture);
    await page.evaluate(() =>
      window.electron.settings.setAttentionNotifications(true)
    );
    await send('turn');
    await send('stop');
    await primer(page).waitFor({ timeout: 30_000 });
    assert.match(
      await primer(page).innerText(),
      /An agent needed you while Exawatt was in the background/
    );
    assert.equal(await primer(page).locator('button').count(), 1);
    assert.equal(
      await state(page),
      'not-determined',
      'the moment of need must not raise the system prompt before the primer'
    );
    await shot(page, '6-primer-at-the-moment');
    await primer(page)
      .getByRole('button', { name: /Continue/ })
      .click();
    await until(async () => (await state(page)) === 'granted', 'the answer');
    await primer(page).waitFor({ state: 'detached' });
  },
  { path: '/workspace' }
);

// 4. A denial: System Settings is the way forward, and nothing prompts.
await run('denied', 'denied', async (app, page) => {
  await openPermissions(page);
  await row(page).getByText('Off in macOS').waitFor();
  assert.equal(
    await row(page).getByRole('button', { name: 'Allow' }).count(),
    0
  );
  await shot(page, '4-section-denied');
  await row(page).getByRole('button', { name: 'Open System Settings' }).click();
  await until(
    async () => (await opened(app)).length > 0,
    'System Settings to be opened'
  );
  assert.deepEqual(await opened(app), [NOTIFICATIONS_PANE]);

  await openPreferences(page);
  const toggle = nativeSwitch(page);
  await toggle.click();
  await primer(page).waitFor();
  assert.equal(await primer(page).getAttribute('data-primer-step'), 'denied');
  assert.equal(await primer(page).locator('button').count(), 1);
  await shot(page, '5-primer-denied');
  await page.keyboard.press('Escape');
  await primer(page).waitFor({ state: 'detached' });
  assert.equal(await toggle.getAttribute('aria-checked'), 'false');
  assert.equal(await state(page), 'denied');
});

console.log(`Permissions eval passed. Screenshots: ${screenshots}`);
