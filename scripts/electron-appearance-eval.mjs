#!/usr/bin/env node

import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { withElectronApp } from './lib/electron-eval.mjs';

const BASE = process.env.EXA_BASE || 'http://localhost:7000';
const root = mkdtempSync(join(tmpdir(), 'exawatt-appearance-eval-'));
const userData = join(root, 'userData');
const screenshots = resolve(
  process.env.EXAWATT_APPEARANCE_SCREENSHOTS ?? '/tmp/exawatt-appearance-eval'
);
mkdirSync(userData, { recursive: true });
mkdirSync(screenshots, { recursive: true });

const expectedClassic = {
  schemaVersion: 1,
  selection: { mode: 'manual', themeId: 'exawatt-classic-dark' },
  accentSource: 'theme',
  interfaceFont: 'theme',
  interfaceScale: 100,
  contrast: 'system',
  transparency: 'system',
};

async function inspectRenderer(page, label) {
  page.setDefaultTimeout(30_000);
  await page.locator('[data-command-altitude]').waitFor();
  const snapshot = await page.evaluate(async () => {
    const rootElement = document.documentElement;
    const bodyStyle = getComputedStyle(document.body);
    const rootStyle = getComputedStyle(rootElement);
    return {
      themeId: rootElement.dataset.exaTheme,
      appearance: rootElement.dataset.exaAppearance,
      contrast: rootElement.dataset.exaContrast,
      transparency: rootElement.dataset.exaTransparency,
      darkClass: rootElement.classList.contains('dark'),
      lightClass: rootElement.classList.contains('light'),
      colorScheme: rootStyle.colorScheme,
      background: bodyStyle.backgroundColor,
      foreground: bodyStyle.color,
      settings: await window.electron?.settings?.get(),
      native: await window.electron?.app?.appearance?.(),
      mirror: localStorage.getItem('exawatt.appearance.v1'),
    };
  });

  if (
    snapshot.themeId !== 'exawatt-classic-dark' ||
    snapshot.appearance !== 'dark' ||
    !snapshot.darkClass ||
    snapshot.lightClass ||
    snapshot.colorScheme !== 'dark' ||
    snapshot.background !== 'rgb(10, 10, 10)' ||
    snapshot.foreground !== 'rgb(250, 250, 250)'
  ) {
    throw new Error(
      `${label} Classic root mismatch: ${JSON.stringify(snapshot)}`
    );
  }
  if (snapshot.native?.dark !== true) {
    throw new Error(`${label} native theme disagrees with the renderer`);
  }
  if (
    !snapshot.mirror ||
    JSON.parse(snapshot.mirror).selection.themeId !== 'exawatt-classic-dark'
  ) {
    throw new Error(`${label} did not publish the validated bootstrap mirror`);
  }
  await page.screenshot({ path: join(screenshots, `${label}.png`) });
  return snapshot;
}

async function launch(label, osAppearance, body, args = ['.']) {
  return withElectronApp(
    {
      args,
      cwd: process.cwd(),
      env: {
        ...process.env,
        NODE_ENV: 'development',
        EXAWATT_TEST: '1',
        EXAWATT_USER_DATA: userData,
        EXAWATT_DEV_URL: `${BASE}/workspace`,
        EXAWATT_TEST_OS_APPEARANCE: osAppearance,
      },
    },
    async (app, page) => body(app, page),
    { maxMs: 90_000, firstWindowMs: 30_000 }
  );
}

try {
  const first = await launch('mock-os-light', 'light', async (_app, page) => {
    const snapshot = await inspectRenderer(page, 'mock-os-light');

    // Exercise the real trusted preload mutation. Multi-window fanout is a
    // focused main-process unit because hidden macOS windows are not stable
    // visibility targets in Playwright.
    await page.evaluate(
      appearance => window.electron?.settings?.setAppearance(appearance),
      expectedClassic
    );
    return snapshot;
  });

  const settingsFile = join(userData, 'settings.json');
  const afterMutation = readFileSync(settingsFile, 'utf8');
  const second = await launch(
    'mock-os-dark-relaunch',
    'dark',
    async (_app, page) => inspectRenderer(page, 'mock-os-dark-relaunch')
  );
  if (readFileSync(settingsFile, 'utf8') !== afterMutation) {
    throw new Error('Relaunch rewrote an explicit appearance preference');
  }

  const safeSeed = `${JSON.stringify(
    {
      ...JSON.parse(afterMutation),
      appearance: {
        ...expectedClassic,
        selection: { mode: 'manual', themeId: 'exawatt-air-light' },
      },
    },
    null,
    2
  )}\n`;
  writeFileSync(settingsFile, safeSeed);
  const safe = await launch(
    'safe-theme',
    'light',
    async (_app, page) => inspectRenderer(page, 'safe-theme'),
    ['.', '--safe-theme']
  );
  if (
    !safe.native?.safeTheme ||
    readFileSync(settingsFile, 'utf8') !== safeSeed
  ) {
    throw new Error('--safe-theme rewrote the committed appearance preference');
  }

  console.log(
    JSON.stringify(
      {
        result: 'PASS',
        first: { themeId: first.themeId, native: first.native },
        relaunch: { themeId: second.themeId, native: second.native },
        safeTheme: { themeId: safe.themeId, native: safe.native },
        screenshots,
      },
      null,
      2
    )
  );
} finally {
  rmSync(root, { recursive: true, force: true });
}
