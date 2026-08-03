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
import { isDeepStrictEqual } from 'node:util';
import { withElectronApp } from './lib/electron-eval.mjs';

const BASE = process.env.EXA_BASE || 'http://localhost:7000';
const root = mkdtempSync(join(tmpdir(), 'exawatt-appearance-eval-'));
const screenshots = resolve(
  process.env.EXAWATT_APPEARANCE_SCREENSHOTS ?? '/tmp/exawatt-appearance-eval'
);
mkdirSync(screenshots, { recursive: true });

const AUTO_PAIR = {
  lightThemeId: 'exawatt-air-light',
  darkThemeId: 'exawatt-night-dark',
};

const THEMES = {
  'exawatt-classic-dark': {
    appearance: 'dark',
    typography: 'classic',
    canvas: 'rgb(10, 10, 10)',
    text: 'rgb(250, 250, 250)',
    bootstrap: '#04060B',
  },
  'exawatt-air-light': {
    appearance: 'light',
    typography: 'air',
    canvas: 'rgb(243, 245, 242)',
    text: 'rgb(24, 33, 29)',
    bootstrap: '#F3F5F2',
  },
  'exawatt-night-dark': {
    appearance: 'dark',
    typography: 'night',
    canvas: 'rgb(11, 16, 14)',
    text: 'rgb(232, 240, 235)',
    bootstrap: '#0B100E',
  },
};

function appearancePreferences(selection, autoPair = AUTO_PAIR) {
  return {
    schemaVersion: 1,
    selection,
    autoPair: { ...autoPair },
    accentSource: 'theme',
    interfaceFont: 'theme',
    interfaceScale: 100,
    contrast: 'system',
    transparency: 'system',
  };
}

const autoPreferences = () =>
  appearancePreferences({ mode: 'auto', ...AUTO_PAIR });
const manualPreferences = themeId =>
  appearancePreferences({ mode: 'manual', themeId });
const classicRecovery = manualPreferences('exawatt-classic-dark');

function scenarioUserData(name) {
  const directory = join(root, name);
  mkdirSync(directory, { recursive: true });
  return directory;
}

function fail(message, detail) {
  throw new Error(
    detail === undefined ? message : `${message}: ${JSON.stringify(detail)}`
  );
}

function assert(condition, message, detail) {
  if (!condition) fail(message, detail);
}

function assertDeep(actual, expected, message) {
  if (!isDeepStrictEqual(actual, expected)) {
    fail(message, { expected, actual });
  }
}

function normalizeHex(value) {
  return typeof value === 'string' ? value.slice(0, 7).toUpperCase() : value;
}

async function setMockSystemAppearance(app, appearance) {
  await app.evaluate(({ nativeTheme }, next) => {
    nativeTheme.themeSource = next;
  }, appearance);
}

async function commitAppearance(page, preferences) {
  const settings = await page.evaluate(
    next => window.electron?.settings?.setAppearance(next),
    preferences
  );
  assert(settings?.appearance, 'appearance mutation returned no preference');
  assertDeep(
    settings.appearance,
    preferences,
    'appearance mutation changed the committed preference'
  );
  return settings;
}

async function inspectRenderer(app, page, label, expected) {
  const theme = THEMES[expected.themeId];
  assert(theme, `${label} references an unknown evaluator theme`);
  page.setDefaultTimeout(30_000);
  await page.locator('[data-command-altitude]').waitFor();
  await page.waitForFunction(
    themeId => document.documentElement.dataset.exaTheme === themeId,
    expected.themeId
  );

  const [renderer, native] = await Promise.all([
    page.evaluate(async () => {
      const rootElement = document.documentElement;
      const bodyStyle = getComputedStyle(document.body);
      const rootStyle = getComputedStyle(rootElement);
      const mirror = localStorage.getItem('exawatt.appearance.v1');
      return {
        themeId: rootElement.dataset.exaTheme,
        appearance: rootElement.dataset.exaAppearance,
        contrast: rootElement.dataset.exaContrast,
        transparency: rootElement.dataset.exaTransparency,
        typography: rootElement.dataset.exaTypography,
        darkClass: rootElement.classList.contains('dark'),
        lightClass: rootElement.classList.contains('light'),
        colorScheme: rootStyle.colorScheme,
        bootstrapBackground: rootStyle
          .getPropertyValue('--exa-bootstrap-background')
          .trim(),
        background: bodyStyle.backgroundColor,
        foreground: bodyStyle.color,
        settings: await window.electron?.settings?.get(),
        native: await window.electron?.app?.appearance?.(),
        mirror: mirror ? JSON.parse(mirror) : null,
      };
    }),
    app.evaluate(({ BrowserWindow, nativeTheme }) => {
      const window = BrowserWindow.getAllWindows()[0];
      return {
        source: nativeTheme.themeSource,
        dark: nativeTheme.shouldUseDarkColors,
        windowBackground: window?.getBackgroundColor() ?? null,
      };
    }),
  ]);

  const dark = theme.appearance === 'dark';
  assert(renderer.themeId === expected.themeId, `${label} theme mismatch`, renderer);
  assert(
    renderer.appearance === theme.appearance,
    `${label} appearance mismatch`,
    renderer
  );
  assert(
    renderer.typography === theme.typography,
    `${label} typography mismatch`,
    renderer
  );
  assert(renderer.darkClass === dark, `${label} dark class mismatch`, renderer);
  assert(
    renderer.lightClass === !dark,
    `${label} light class mismatch`,
    renderer
  );
  assert(
    renderer.colorScheme === theme.appearance,
    `${label} color-scheme mismatch`,
    renderer
  );
  assert(
    renderer.background === theme.canvas && renderer.foreground === theme.text,
    `${label} foundation paint mismatch`,
    renderer
  );
  assert(
    normalizeHex(renderer.bootstrapBackground) === theme.bootstrap,
    `${label} renderer bootstrap token mismatch`,
    renderer
  );
  assert(
    normalizeHex(native.windowBackground) === theme.bootstrap,
    `${label} BrowserWindow bootstrap background mismatch`,
    native
  );
  assert(native.dark === dark, `${label} main native appearance mismatch`, native);
  assert(
    renderer.native?.dark === dark,
    `${label} preload native appearance mismatch`,
    renderer.native
  );
  assert(
    renderer.native?.safeTheme === Boolean(expected.safeTheme),
    `${label} safe-theme signal mismatch`,
    renderer.native
  );
  if (expected.nativeSource) {
    assert(
      native.source === expected.nativeSource,
      `${label} native source mismatch`,
      native
    );
  }

  if (expected.settingsAppearance === null) {
    assert(
      !Object.prototype.hasOwnProperty.call(renderer.settings ?? {}, 'appearance'),
      `${label} turned a missing preference into durable settings`,
      renderer.settings
    );
  } else {
    assertDeep(
      renderer.settings?.appearance,
      expected.settingsAppearance,
      `${label} settings preference mismatch`
    );
  }
  assertDeep(
    renderer.mirror,
    expected.mirrorAppearance,
    `${label} bootstrap mirror mismatch`
  );
  if (expected.settingsSubset) {
    for (const [key, value] of Object.entries(expected.settingsSubset)) {
      assertDeep(
        renderer.settings?.[key],
        value,
        `${label} changed unrelated ${key} settings`
      );
    }
  }

  await page.screenshot({ path: join(screenshots, `${label}.png`) });
  return { renderer, native };
}

async function launch(
  { label, userData, osAppearance, startupThemeId, startupSource, mockAuto, args },
  body
) {
  return withElectronApp(
    {
      args: args ?? ['.'],
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
    async (app, page) => {
      const rendererErrors = [];
      page.on('pageerror', error => rendererErrors.push(String(error.message)));
      page.on('console', message => {
        if (message.type() === 'error') rendererErrors.push(message.text());
      });

      const startup = await app.evaluate(({ BrowserWindow, nativeTheme }) => {
        const window = BrowserWindow.getAllWindows()[0];
        return {
          source: nativeTheme.themeSource,
          windowBackground: window?.getBackgroundColor() ?? null,
        };
      });
      const startupTheme = THEMES[startupThemeId];
      assert(startupTheme, `${label} has no startup theme fixture`);
      assert(
        startup.source === startupSource,
        `${label} startup native source mismatch`,
        startup
      );
      assert(
        normalizeHex(startup.windowBackground) === startupTheme.bootstrap,
        `${label} startup background mismatch`,
        startup
      );

      if (mockAuto) await setMockSystemAppearance(app, osAppearance);
      const result = await body(app, page, startup);
      assert(
        rendererErrors.length === 0,
        `${label} emitted renderer errors`,
        rendererErrors
      );
      return result;
    },
    { maxMs: 90_000, firstWindowMs: 30_000 }
  );
}

try {
  const freshLight = scenarioUserData('fresh-light');
  const freshDark = scenarioUserData('fresh-dark');
  const defaultAppearance = autoPreferences();

  await launch(
    {
      label: 'fresh-auto-light',
      userData: freshLight,
      osAppearance: 'light',
      startupThemeId: 'exawatt-air-light',
      startupSource: 'system',
      mockAuto: true,
    },
    (app, page) =>
      inspectRenderer(app, page, 'fresh-auto-light', {
        themeId: 'exawatt-air-light',
        nativeSource: 'light',
        settingsAppearance: null,
        mirrorAppearance: defaultAppearance,
      })
  );
  await launch(
    {
      label: 'fresh-auto-dark',
      userData: freshDark,
      osAppearance: 'dark',
      startupThemeId: 'exawatt-night-dark',
      startupSource: 'system',
      mockAuto: true,
    },
    (app, page) =>
      inspectRenderer(app, page, 'fresh-auto-dark', {
        themeId: 'exawatt-night-dark',
        nativeSource: 'dark',
        settingsAppearance: null,
        mirrorAppearance: defaultAppearance,
      })
  );

  const selectionData = scenarioUserData('selection-round-trip');
  const settingsFile = join(selectionData, 'settings.json');

  await launch(
    {
      label: 'manual-classic-commit',
      userData: selectionData,
      osAppearance: 'light',
      startupThemeId: 'exawatt-air-light',
      startupSource: 'system',
      mockAuto: true,
    },
    async (app, page) => {
      await page.locator('[data-command-altitude]').waitFor();
      const preferences = manualPreferences('exawatt-classic-dark');
      await commitAppearance(page, preferences);
      return inspectRenderer(app, page, 'manual-classic-commit', {
        themeId: 'exawatt-classic-dark',
        nativeSource: 'dark',
        settingsAppearance: preferences,
        mirrorAppearance: preferences,
      });
    }
  );
  const classicFile = readFileSync(settingsFile, 'utf8');

  await launch(
    {
      label: 'manual-classic-relaunch-dark',
      userData: selectionData,
      osAppearance: 'dark',
      startupThemeId: 'exawatt-classic-dark',
      startupSource: 'dark',
    },
    async (app, page) => {
      assert(
        readFileSync(settingsFile, 'utf8') === classicFile,
        'Classic relaunch rewrote settings'
      );
      const classic = manualPreferences('exawatt-classic-dark');
      await inspectRenderer(app, page, 'manual-classic-relaunch-dark', {
        themeId: 'exawatt-classic-dark',
        nativeSource: 'dark',
        settingsAppearance: classic,
        mirrorAppearance: classic,
      });

      const air = manualPreferences('exawatt-air-light');
      await commitAppearance(page, air);
      return inspectRenderer(app, page, 'manual-air-commit', {
        themeId: 'exawatt-air-light',
        nativeSource: 'light',
        settingsAppearance: air,
        mirrorAppearance: air,
      });
    }
  );
  const airFile = readFileSync(settingsFile, 'utf8');

  await launch(
    {
      label: 'manual-air-relaunch-dark',
      userData: selectionData,
      osAppearance: 'dark',
      startupThemeId: 'exawatt-air-light',
      startupSource: 'light',
    },
    async (app, page) => {
      assert(
        readFileSync(settingsFile, 'utf8') === airFile,
        'Air relaunch rewrote settings'
      );
      const air = manualPreferences('exawatt-air-light');
      await inspectRenderer(app, page, 'manual-air-relaunch-dark', {
        themeId: 'exawatt-air-light',
        nativeSource: 'light',
        settingsAppearance: air,
        mirrorAppearance: air,
      });

      const night = manualPreferences('exawatt-night-dark');
      await commitAppearance(page, night);
      return inspectRenderer(app, page, 'manual-night-commit', {
        themeId: 'exawatt-night-dark',
        nativeSource: 'dark',
        settingsAppearance: night,
        mirrorAppearance: night,
      });
    }
  );
  const nightFile = readFileSync(settingsFile, 'utf8');

  await launch(
    {
      label: 'manual-night-relaunch-light',
      userData: selectionData,
      osAppearance: 'light',
      startupThemeId: 'exawatt-night-dark',
      startupSource: 'dark',
    },
    async (app, page) => {
      assert(
        readFileSync(settingsFile, 'utf8') === nightFile,
        'Night relaunch rewrote settings'
      );
      const night = manualPreferences('exawatt-night-dark');
      await inspectRenderer(app, page, 'manual-night-relaunch-light', {
        themeId: 'exawatt-night-dark',
        nativeSource: 'dark',
        settingsAppearance: night,
        mirrorAppearance: night,
      });

      await commitAppearance(page, autoPreferences());
      const manual = manualPreferences('exawatt-classic-dark');
      await commitAppearance(page, manual);
      return inspectRenderer(app, page, 'auto-pair-preserved-in-manual', {
        themeId: 'exawatt-classic-dark',
        nativeSource: 'dark',
        settingsAppearance: manual,
        mirrorAppearance: manual,
      });
    }
  );
  const manualRoundTripFile = readFileSync(settingsFile, 'utf8');

  await launch(
    {
      label: 'auto-pair-manual-relaunch',
      userData: selectionData,
      osAppearance: 'dark',
      startupThemeId: 'exawatt-classic-dark',
      startupSource: 'dark',
    },
    async (app, page) => {
      assert(
        readFileSync(settingsFile, 'utf8') === manualRoundTripFile,
        'Manual Auto-pair relaunch rewrote settings'
      );
      const manual = manualPreferences('exawatt-classic-dark');
      await inspectRenderer(app, page, 'auto-pair-manual-relaunch', {
        themeId: 'exawatt-classic-dark',
        nativeSource: 'dark',
        settingsAppearance: manual,
        mirrorAppearance: manual,
      });
      await commitAppearance(page, autoPreferences());
    }
  );
  const autoFile = readFileSync(settingsFile, 'utf8');

  await launch(
    {
      label: 'auto-relaunch-dark',
      userData: selectionData,
      osAppearance: 'dark',
      startupThemeId: 'exawatt-night-dark',
      startupSource: 'system',
      mockAuto: true,
    },
    async (app, page) => {
      assert(
        readFileSync(settingsFile, 'utf8') === autoFile,
        'Auto dark relaunch rewrote settings'
      );
      return inspectRenderer(app, page, 'auto-relaunch-dark', {
        themeId: 'exawatt-night-dark',
        nativeSource: 'dark',
        settingsAppearance: defaultAppearance,
        mirrorAppearance: defaultAppearance,
      });
    }
  );

  await launch(
    {
      label: 'auto-relaunch-light',
      userData: selectionData,
      osAppearance: 'light',
      startupThemeId: 'exawatt-air-light',
      startupSource: 'system',
      mockAuto: true,
    },
    async (app, page) => {
      assert(
        readFileSync(settingsFile, 'utf8') === autoFile,
        'Auto light relaunch rewrote settings'
      );
      return inspectRenderer(app, page, 'auto-relaunch-light', {
        themeId: 'exawatt-air-light',
        nativeSource: 'light',
        settingsAppearance: defaultAppearance,
        mirrorAppearance: defaultAppearance,
      });
    }
  );

  await launch(
    {
      label: 'safe-theme',
      userData: selectionData,
      osAppearance: 'light',
      startupThemeId: 'exawatt-classic-dark',
      startupSource: 'dark',
      args: ['.', '--safe-theme'],
    },
    async (app, page) => {
      const snapshot = await inspectRenderer(app, page, 'safe-theme', {
        themeId: 'exawatt-classic-dark',
        nativeSource: 'dark',
        settingsAppearance: defaultAppearance,
        mirrorAppearance: defaultAppearance,
        safeTheme: true,
      });
      assert(
        readFileSync(settingsFile, 'utf8') === autoFile,
        '--safe-theme rewrote the stored Auto selection'
      );
      return snapshot;
    }
  );

  const corruptData = scenarioUserData('corrupt-recovery');
  await launch(
    {
      label: 'corrupt-mirror-seed',
      userData: corruptData,
      osAppearance: 'light',
      startupThemeId: 'exawatt-air-light',
      startupSource: 'system',
      mockAuto: true,
    },
    async (_app, page) => {
      await page.locator('[data-command-altitude]').waitFor();
      await page.evaluate(() =>
        localStorage.setItem('exawatt.appearance.v1', '{')
      );
    }
  );

  const corruptSettingsFile = join(corruptData, 'settings.json');
  const corruptSeed = `${JSON.stringify(
    {
      terminal: { fontSize: 15 },
      notifications: { attention: true },
      appearance: {
        ...classicRecovery,
        injectedCss: 'body{}',
      },
    },
    null,
    2
  )}\n`;
  writeFileSync(corruptSettingsFile, corruptSeed);

  await launch(
    {
      label: 'corrupt-recovery',
      userData: corruptData,
      osAppearance: 'light',
      startupThemeId: 'exawatt-classic-dark',
      startupSource: 'dark',
    },
    async (app, page) => {
      const snapshot = await inspectRenderer(app, page, 'corrupt-recovery', {
        themeId: 'exawatt-classic-dark',
        nativeSource: 'dark',
        settingsAppearance: classicRecovery,
        mirrorAppearance: classicRecovery,
        settingsSubset: {
          terminal: { fontSize: 15 },
          notifications: { attention: true },
        },
      });
      assert(
        readFileSync(corruptSettingsFile, 'utf8') === corruptSeed,
        'corrupt recovery rewrote the settings file'
      );
      return snapshot;
    }
  );

  console.log(
    JSON.stringify(
      {
        result: 'PASS',
        freshDefault: {
          light: 'exawatt-air-light',
          dark: 'exawatt-night-dark',
        },
        manualRelaunch: [
          'exawatt-classic-dark',
          'exawatt-air-light',
          'exawatt-night-dark',
        ],
        autoRoundTrip: AUTO_PAIR,
        corruptRecovery: 'exawatt-classic-dark',
        safeTheme: 'one launch, stored Auto unchanged',
        screenshots,
      },
      null,
      2
    )
  );
} finally {
  rmSync(root, { recursive: true, force: true });
}
