#!/usr/bin/env node
/**
 * Settings destinations, discoverability and device-local presentation
 * choices. BUG-306: the shell draws each destination's frame once, from the
 * registry, with no strip of links to its own rows, and every topic link
 * lands on its row and marks it.
 */
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
          '[data-fleet-settings] [data-fleet-material="gummy"]'
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
    const view = page.locator('#fleet-view');
    assert.equal(
      await view
        .locator('[data-settings-option="v1"]')
        .getAttribute('aria-pressed'),
      'true'
    );
    await view.locator('[data-settings-option="v2"]').click();
    await page.waitForFunction(
      key => JSON.parse(localStorage.getItem(key) || 'null') === 'v2',
      storageKeys.fleetView
    );
    for (const material of FLEET_MATERIALS) {
      await page.locator(`[data-fleet-material="${material.id}"]`).click();
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
      id =>
        document
          .querySelector(`[data-fleet-settings] [data-fleet-material="${id}"]`)
          ?.getAttribute('aria-pressed') === 'true',
      last.id
    );
    await page.locator('[data-fleet-material-reset]').click();
    await page.waitForFunction(
      keys =>
        JSON.parse(localStorage.getItem(keys.fleetView) || 'null') === 'v2' &&
        localStorage.getItem(keys.fleetMaterial) === 'null',
      storageKeys
    );
    // With no saved material the presentation default (gummy) is selected.
    assert.equal(
      await page
        .locator('[data-fleet-material="gummy"]')
        .getAttribute('aria-pressed'),
      'true'
    );
    await page.screenshot({
      path: join(output, `settings-${theme}-fleet.png`),
      fullPage: true,
    });

    const shell = page.locator('[data-settings-shell]');
    const search = shell.getByRole('searchbox');
    await search.fill('anodized');
    const result = page.locator('[data-settings-search-results]');
    await result
      .locator(`a[href="${settingsHref('fleet', 'fleet-material')}"]`)
      .click();
    assert.equal(new URL(page.url()).searchParams.get('section'), 'fleet');
    assert.equal(new URL(page.url()).hash, '#fleet-material');
    await page.waitForFunction(
      () => document.activeElement?.id === 'fleet-material'
    );
    const frames = [];
    for (const destination of SETTINGS_DESTINATIONS) {
      const nav = shell.getByRole('navigation');
      const link = nav.locator(`a[href="${settingsHref(destination.id)}"]`);
      await link.click();
      await page.waitForFunction(
        id => new URL(location.href).searchParams.get('section') === id,
        destination.id
      );
      assert.equal(await link.getAttribute('aria-current'), 'page');
      // One frame, drawn from the registry: one heading named for the page,
      // and the page body never links to its own rows.
      const frame = page.getByRole('region', {
        name: destination.label,
        exact: true,
      });
      await frame.waitFor();
      const headings = await page
        .getByRole('heading', { name: destination.label, exact: true })
        .count();
      assert.equal(headings, 1, `${destination.id}: one page heading`);
      assert.equal(
        await frame.getByText(destination.description, { exact: true }).count(),
        1,
        `${destination.id}: the registry description heads the page`
      );
      const ownLinks = await frame.locator('a[href^="/settings"]').count();
      assert.equal(ownLinks, 0, `${destination.id}: no topic strip`);
      await page.waitForLoadState('networkidle').catch(() => undefined);
      await page.screenshot({
        path: join(output, `settings-${theme}-${destination.id}.png`),
        fullPage: true,
      });
      frames.push({ id: destination.id, headings, ownLinks });
    }
    // Every topic link lands on the row with its id, in view and focused,
    // marks it visibly, and lets the mark go.
    const landings = [];
    for (const destination of SETTINGS_DESTINATIONS) {
      for (const topic of destination.topics) {
        await page.goto(`${base}${settingsHref(destination.id, topic.id)}`, {
          waitUntil: 'domcontentloaded',
        });
        await page.waitForFunction(
          id =>
            document.getElementById(id)?.hasAttribute('data-settings-landed'),
          topic.id
        );
        const landed = await page.evaluate(id => {
          const row = document.getElementById(id);
          const box = row.getBoundingClientRect();
          return {
            focused: document.activeElement === row,
            inView: box.top >= 0 && box.bottom <= window.innerHeight,
            mark: getComputedStyle(row, '::before').opacity,
            title: row.textContent,
          };
        }, topic.id);
        assert.ok(landed.focused, `${topic.id}: the landed row takes focus`);
        assert.ok(landed.inView, `${topic.id}: the landed row is in view`);
        assert.equal(landed.mark, '1', `${topic.id}: the landed row is marked`);
        assert.ok(
          landed.title.startsWith(topic.label),
          `${topic.id}: the link names the row it lands on`
        );
        await page.waitForFunction(
          id =>
            !document.getElementById(id)?.hasAttribute('data-settings-landed'),
          topic.id
        );
        landings.push(topic.id);
      }
    }
    await page.goto(`${base}${settingsHref('fleet')}`, {
      waitUntil: 'domcontentloaded',
    });
    await shell
      .getByRole('navigation')
      .locator(`a[href="${settingsHref('fleet')}"]`)
      .click();
    await shell
      .getByRole('navigation')
      .locator(`a[href="${settingsHref('appearance')}"]`)
      .click();
    await page.goBack();
    await page.locator('[data-fleet-settings]').waitFor();
    await search.fill('font');
    await page.locator('[data-settings-search-results]').waitFor();
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
      frames,
      landings,
      overflow,
      errors,
    });
    await context.close();
  }
  writeFileSync(join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(
    `PASS Settings: one frame per destination, every topic link lands and marks its row, search, history, material persistence/reset, all themes and narrow layout. Evidence: ${output}`
  );
} finally {
  await browser.close();
}
