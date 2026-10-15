#!/usr/bin/env node
/** Settings destinations, discoverability and device-local presentation choices. */
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import {
  resolveQaBrowserLaunchOptions,
  primeEvalBrowserPage,
} from './lib/qa-browser.mjs';
import {
  SETTINGS_DESTINATIONS,
  settingsHref,
} from '../src/app/settings/settings-registry.ts';
const { FLEET_MATERIALS } = createRequire(import.meta.url)(
  '@exawatt/core/desktop-bridge'
);

const base = process.env.EXA_BASE || 'http://localhost:7134';
const output =
  process.env.SETTINGS_REPORT_DIR || '/tmp/exawatt-fleet-v2-settings';
const storageKeys = {
  fleetView: 'exawatt.presentation.fleetView.v1',
  fleetMaterial: 'exawatt.presentation.fleetMaterial.v1',
};
mkdirSync(output, { recursive: true });
const identity = await fetch(`${base}/api/dev-identity`).then(response =>
  response.json()
);
assert.equal(
  realpathSync(identity.repoRoot),
  realpathSync(process.cwd()),
  'Settings eval must use its own worktree server'
);
const browser = await chromium.launch(
  await resolveQaBrowserLaunchOptions(chromium, { headless: true })
);
const report = [];
try {
  for (const [theme, themeId] of [
    ['classic', 'exawatt-classic-dark'],
    ['air', 'exawatt-air-light'],
    ['night', 'exawatt-night-dark'],
  ]) {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      reducedMotion: 'reduce',
    });
    const page = await context.newPage();
    await primeEvalBrowserPage(page);
    await page.addInitScript(
      ({ themeId }) => {
        localStorage.setItem(
          'exawatt.appearance.v1',
          JSON.stringify({
            schemaVersion: 1,
            selection: { mode: 'manual', themeId },
            autoPair: {
              lightThemeId: 'exawatt-air-light',
              darkThemeId: 'exawatt-night-dark',
            },
            accentSource: 'theme',
            interfaceFont: 'theme',
            interfaceScale: 100,
            contrast: 'system',
            transparency: 'system',
          })
        );
      },
      { themeId }
    );
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${base}${settingsHref('fleet', 'fleet-material')}`, {
      waitUntil: 'domcontentloaded',
    });
    await page.waitForFunction(
      () =>
        document.querySelector(
          '[data-fleet-settings] button[aria-label="Gummy"]'
        )?.disabled === false
    );
    assert.equal(
      await page.evaluate(() => document.documentElement.dataset.exaTheme),
      themeId
    );
    assert.equal(
      await page.evaluate(
        keys =>
          Object.values(keys).some(key => localStorage.getItem(key) !== null),
        storageKeys
      ),
      false,
      'reading Settings must not persist defaults'
    );
    const view = page.getByRole('group', { name: 'Fleet view', exact: true });
    assert.equal(
      await view
        .getByRole('button', { name: 'v1', exact: true })
        .getAttribute('aria-pressed'),
      'true'
    );
    await view.getByRole('button', { name: /v2/ }).click();
    await page.waitForFunction(
      key => JSON.parse(localStorage.getItem(key) || 'null') === 'v2',
      storageKeys.fleetView
    );
    for (const material of FLEET_MATERIALS) {
      await page
        .getByRole('button', { name: material.name, exact: true })
        .click();
      await page.waitForFunction(
        ({ keys, material }) =>
          JSON.parse(localStorage.getItem(keys.fleetMaterial) || 'null') ===
            material &&
          JSON.parse(localStorage.getItem(keys.fleetView) || 'null') === 'v2',
        { keys: storageKeys, material: material.id }
      );
    }
    await page.reload({ waitUntil: 'domcontentloaded' });
    const last = FLEET_MATERIALS.at(-1);
    await page.waitForFunction(
      name =>
        document
          .querySelector(`[data-fleet-settings] button[aria-label="${name}"]`)
          ?.getAttribute('aria-pressed') === 'true',
      last.name
    );
    await page
      .getByRole('button', { name: 'Reset material', exact: true })
      .click();
    await page.waitForFunction(
      keys =>
        JSON.parse(localStorage.getItem(keys.fleetView) || 'null') === 'v2' &&
        localStorage.getItem(keys.fleetMaterial) === 'null',
      storageKeys
    );
    assert.equal(
      await page
        .getByRole('button', { name: 'Gummy', exact: true })
        .getAttribute('aria-pressed'),
      'true'
    );
    await page.screenshot({
      path: join(output, `settings-${theme}-fleet.png`),
      fullPage: true,
    });

    const search = page.getByRole('searchbox', { name: 'Search Settings' });
    await search.fill('anodized');
    const result = page.getByRole('region', {
      name: 'Settings search results',
    });
    await result
      .getByRole('link', { name: 'Tile material', exact: true })
      .click();
    assert.equal(new URL(page.url()).searchParams.get('section'), 'fleet');
    assert.equal(new URL(page.url()).hash, '#fleet-material');
    await page.waitForFunction(
      () => document.activeElement?.id === 'fleet-material'
    );
    for (const destination of SETTINGS_DESTINATIONS) {
      const nav = page.getByRole('navigation', {
        name: 'Settings',
        exact: true,
      });
      await nav
        .getByRole('link', { name: destination.label, exact: true })
        .click();
      await page.waitForFunction(
        id => new URL(location.href).searchParams.get('section') === id,
        destination.id
      );
      assert.equal(
        await nav
          .getByRole('link', { name: destination.label, exact: true })
          .getAttribute('aria-current'),
        'page'
      );
    }
    await page
      .getByRole('navigation', { name: 'Settings', exact: true })
      .getByRole('link', { name: 'Fleet', exact: true })
      .click();
    await page
      .getByRole('navigation', { name: 'Settings', exact: true })
      .getByRole('link', { name: 'Appearance', exact: true })
      .click();
    await page.goBack();
    await page.locator('[data-fleet-settings]').waitFor();
    await search.fill('font');
    await page
      .getByRole('region', { name: 'Settings search results' })
      .waitFor();
    await page.screenshot({
      path: join(output, `settings-${theme}-search.png`),
      fullPage: true,
    });
    await search.fill('');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: join(output, `settings-${theme}-narrow.png`),
      fullPage: true,
    });
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth
    );
    assert.ok(overflow <= 1, `Settings overflow at 390px: ${overflow}`);
    assert.deepEqual(errors, [], 'Settings browser errors');
    report.push({
      theme,
      materials: FLEET_MATERIALS.map(item => item.id),
      sections: SETTINGS_DESTINATIONS.map(item => item.id),
      overflow,
      errors,
    });
    await context.close();
  }
  writeFileSync(join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(
    `PASS Settings: search, deep links, history, material persistence/reset, all themes and narrow layout. Evidence: ${output}`
  );
} finally {
  await browser.close();
}
