#!/usr/bin/env node

/**
 * ENG-032 T5 production-surface acceptance evaluator.
 *
 * Run a dev server from the checkout under test, then point EXA_BASE at it:
 *   pnpm dev -p 7092
 *   EXA_BASE=http://localhost:7092 pnpm eval:theme-system
 *
 * This intentionally exercises the real Settings and command-palette UI. The
 * retired gallery study is not an acceptance surface and is never visited.
 */

import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { resolveQaBrowserLaunchOptions } from './lib/qa-browser.mjs';

const BASE = process.env.EXA_BASE || 'http://localhost:7000';
const OUTPUT = resolve(
  process.env.EXAWATT_THEME_SCREENSHOTS || '.artifacts/eng-032-t5'
);
const APPEARANCE_MIRROR_KEY = 'exawatt.appearance.v1';
const ACTIVE_WORKSPACE_KEY = 'exawatt:active-workspace:v1';

const THEMES = [
  {
    key: 'classic',
    label: 'Classic Dark',
    id: 'exawatt-classic-dark',
    appearance: 'dark',
    typography: 'classic',
    chromeOpacity: '0.94',
    chromeBlur: '18px',
  },
  {
    key: 'air',
    label: 'Air',
    id: 'exawatt-air-light',
    appearance: 'light',
    typography: 'air',
    chromeOpacity: '0.78',
    chromeBlur: '24px',
  },
  {
    key: 'night',
    label: 'Night',
    id: 'exawatt-night-dark',
    appearance: 'dark',
    typography: 'night',
    chromeOpacity: '0.88',
    chromeBlur: '22px',
  },
];

const SURFACES = [
  {
    key: 'workspace',
    path: '/workspace',
    mounts: [
      '[data-demo-workspace]',
      '[data-workspace-chrome]',
      '[data-workspace-stage]',
    ],
  },
  {
    key: 'usage',
    path: '/usage',
    mounts: ['main'],
    heading: 'Usage',
  },
  {
    key: 'fleet',
    path: '/fleet/spatial',
    mounts: ['[data-spatial-command]', '[data-spatial-board]'],
    canvas: true,
  },
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const contractFailures = [];
function check(condition, message) {
  if (condition) return;
  contractFailures.push(message);
  console.error(`FAIL theme system: ${message}`);
}

function expectedSelection(themeId) {
  return { mode: 'manual', themeId };
}

mkdirSync(OUTPUT, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  ...(await resolveQaBrowserLaunchOptions(chromium)),
});
const context = await browser.newContext({
  viewport: { width: 1400, height: 900 },
  colorScheme: 'light',
});
const page = await context.newPage();
page.setDefaultTimeout(30_000);

// Populated Demo surfaces make the production route checks deterministic
// without inventing a theme-only fixture or crossing the source boundary.
await page.addInitScript(
  ({ activeWorkspaceKey }) => {
    window.localStorage.setItem(activeWorkspaceKey, 'demo');
  },
  { activeWorkspaceKey: ACTIVE_WORKSPACE_KEY }
);

const errors = [];
page.on('pageerror', error => {
  errors.push(`${page.url()}: ${String(error.message || error)}`);
});
page.on('console', message => {
  if (
    message.type() === 'error' &&
    !message.text().includes('eval() is not supported')
  ) {
    errors.push(`${page.url()}: ${message.text()}`);
  }
});

async function readRootState() {
  return page.evaluate(appearanceMirrorKey => {
    const root = document.documentElement;
    const rootStyle = getComputedStyle(root);
    const bodyStyle = getComputedStyle(document.body);
    const mirror = window.localStorage.getItem(appearanceMirrorKey);
    return {
      theme: root.dataset.exaTheme,
      appearance: root.dataset.exaAppearance,
      contrast: root.dataset.exaContrast,
      transparency: root.dataset.exaTransparency,
      font: root.dataset.exaFont,
      typography: root.dataset.exaTypography,
      darkClass: root.classList.contains('dark'),
      lightClass: root.classList.contains('light'),
      colorScheme: rootStyle.colorScheme,
      scale: rootStyle.getPropertyValue('--exa-interface-scale').trim(),
      fontFamily: bodyStyle.fontFamily,
      material: {
        opacity: rootStyle
          .getPropertyValue('--exa-material-chrome-opacity')
          .trim(),
        blur: rootStyle.getPropertyValue('--exa-material-chrome-blur').trim(),
        saturation: rootStyle
          .getPropertyValue('--exa-material-chrome-saturation')
          .trim(),
        tint: rootStyle.getPropertyValue('--exa-material-chrome-tint').trim(),
        fallback: rootStyle
          .getPropertyValue('--exa-material-chrome-fallback')
          .trim(),
      },
      mirror: mirror ? JSON.parse(mirror) : null,
    };
  }, APPEARANCE_MIRROR_KEY);
}

async function waitForCommittedState({
  themeId,
  mode = 'manual',
  interfaceFont,
  interfaceScale,
  contrast,
  transparency,
}) {
  await page.waitForFunction(
    ({
      appearanceMirrorKey,
      themeId: expectedThemeId,
      mode: expectedMode,
      interfaceFont: expectedFont,
      interfaceScale: expectedScale,
      contrast: expectedContrast,
      transparency: expectedTransparency,
    }) => {
      const raw = window.localStorage.getItem(appearanceMirrorKey);
      if (!raw) return false;
      const mirror = JSON.parse(raw);
      const selectionMatches =
        expectedMode === 'auto'
          ? mirror.selection?.mode === 'auto'
          : mirror.selection?.mode === 'manual' &&
            mirror.selection.themeId === expectedThemeId;
      return (
        selectionMatches &&
        document.documentElement.dataset.exaTheme === expectedThemeId &&
        (expectedFont === undefined || mirror.interfaceFont === expectedFont) &&
        (expectedScale === undefined ||
          mirror.interfaceScale === expectedScale) &&
        (expectedContrast === undefined ||
          mirror.contrast === expectedContrast) &&
        (expectedTransparency === undefined ||
          mirror.transparency === expectedTransparency)
      );
    },
    {
      appearanceMirrorKey: APPEARANCE_MIRROR_KEY,
      themeId,
      mode,
      interfaceFont,
      interfaceScale,
      contrast,
      transparency,
    }
  );
}

async function assertRootAppearance(
  theme,
  {
    selection = expectedSelection(theme.id),
    font = 'theme',
    scale = 100,
    contrast = 'standard',
    transparency = 'standard',
    reducedMaterial = false,
  } = {}
) {
  await page.waitForFunction(
    ({ themeId, expectedScale }) => {
      const root = document.documentElement;
      return (
        root.dataset.exaTheme === themeId &&
        getComputedStyle(root)
          .getPropertyValue('--exa-interface-scale')
          .trim() === String(expectedScale / 100)
      );
    },
    { themeId: theme.id, expectedScale: scale }
  );

  const state = await readRootState();
  const detail = JSON.stringify(state);
  assert(state.theme === theme.id, `root theme mismatch: ${detail}`);
  assert(
    state.appearance === theme.appearance,
    `root appearance mismatch: ${detail}`
  );
  assert(
    state.typography === theme.typography,
    `root typography mismatch: ${detail}`
  );
  assert(
    state.colorScheme === theme.appearance,
    `color-scheme mismatch: ${detail}`
  );
  assert(
    state.darkClass === (theme.appearance === 'dark') &&
      state.lightClass === (theme.appearance === 'light'),
    `root light/dark classes mismatch: ${detail}`
  );
  assert(state.contrast === contrast, `root contrast mismatch: ${detail}`);
  assert(
    state.transparency === transparency,
    `root transparency mismatch: ${detail}`
  );
  assert(state.font === font, `root font mode mismatch: ${detail}`);
  assert(state.scale === String(scale / 100), `root scale mismatch: ${detail}`);
  assert(
    state.fontFamily.trim().length > 0,
    `resolved font is empty: ${detail}`
  );
  if (font === 'geist') {
    check(
      state.fontFamily.toLowerCase().includes('geist'),
      `Geist override did not reach body font: ${detail}`
    );
  }
  assert(state.material.tint.length > 0, `material tint is empty: ${detail}`);
  assert(
    state.material.fallback.length > 0,
    `material fallback is empty: ${detail}`
  );
  assert(
    state.material.saturation.length > 0,
    `material saturation is empty: ${detail}`
  );
  assert(
    state.material.opacity === (reducedMaterial ? '1' : theme.chromeOpacity),
    `material opacity mismatch: ${detail}`
  );
  assert(
    state.material.blur === (reducedMaterial ? '0px' : theme.chromeBlur),
    `material blur mismatch: ${detail}`
  );
  assert(state.mirror !== null, `appearance mirror is missing: ${detail}`);
  assert(
    JSON.stringify(state.mirror.selection) === JSON.stringify(selection),
    `appearance mirror selection mismatch: ${detail}`
  );
  assert(
    state.mirror.interfaceFont === font &&
      state.mirror.interfaceScale === scale,
    `appearance mirror font/scale mismatch: ${detail}`
  );
}

async function openAppearanceSettings() {
  await page.goto(`${BASE}/settings`, {
    waitUntil: 'domcontentloaded',
    timeout: 30_000,
  });
  await page.locator('[data-settings-shell]').waitFor();
  const preferences = page.getByRole('button', {
    name: 'Preferences',
    exact: true,
  });
  // The Settings shell is server-rendered. Prove the client handler has
  // accepted the click instead of racing hydration and mistaking inert HTML
  // for an interactive production surface.
  const hydrationDeadline = Date.now() + 30_000;
  while (
    (await preferences.getAttribute('aria-current')) !== 'page' &&
    Date.now() < hydrationDeadline
  ) {
    await preferences.click();
    await page.waitForTimeout(100);
  }
  assert(
    (await preferences.getAttribute('aria-current')) === 'page',
    'Preferences navigation never became interactive'
  );
  const appearance = page.locator('[data-appearance-settings]');
  await appearance.waitFor();
  await appearance
    .getByRole('button', { name: 'Manual', exact: true })
    .waitFor();
  return appearance;
}

async function setMode(appearance, mode) {
  const button = appearance.getByRole('button', {
    name: mode === 'auto' ? 'Auto' : 'Manual',
    exact: true,
  });
  if ((await button.getAttribute('aria-pressed')) !== 'true') {
    await button.click();
  }
}

async function commitPreset(appearance, theme) {
  await setMode(appearance, 'manual');
  const card = appearance.getByRole('button', {
    name: theme.label,
    exact: true,
  });
  await card.click();
  await waitForCommittedState({ themeId: theme.id });
  assert(
    (await card.getAttribute('aria-pressed')) === 'true',
    `${theme.label} card did not expose its committed state`
  );
}

async function chooseSetting(appearance, label, option) {
  await appearance.getByRole('combobox', { name: label, exact: true }).click();
  const listbox = page.getByRole('listbox');
  await page.getByRole('option', { name: option, exact: true }).click();
  // Radix keeps its positioned portal mounted for the close transition. Do
  // not count that transient overlay as document layout overflow.
  await listbox.waitFor({ state: 'detached' });
}

async function assertNoHorizontalOverflow(label) {
  const metrics = await page.evaluate(() => {
    const viewport = document.documentElement.clientWidth;
    return {
      viewport,
      root: document.documentElement.scrollWidth,
      body: document.body.scrollWidth,
      offenders: [...document.querySelectorAll('*')]
        .map(element => {
          const bounds = element.getBoundingClientRect();
          return {
            tag: element.tagName,
            text: element.textContent?.trim().slice(0, 80),
            left: Math.round(bounds.left),
            right: Math.round(bounds.right),
            width: Math.round(bounds.width),
          };
        })
        .filter(item => item.left < viewport && item.right > viewport + 1)
        .slice(0, 12),
    };
  });
  assert(
    Math.max(metrics.root, metrics.body) <= metrics.viewport + 1,
    `${label} overflows horizontally: ${JSON.stringify(metrics)}`
  );
}

async function openThemePicker() {
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  const shortcutDeadline = Date.now() + 30_000;
  while (!(await palette.isVisible()) && Date.now() < shortcutDeadline) {
    await page.keyboard.press('Meta+k');
    await page.waitForTimeout(100);
  }
  await palette.waitFor();
  const input = palette.getByPlaceholder('Type a command or search...');
  await input.fill('Change theme');
  await palette.getByText('Change theme…', { exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'Change theme' });
  await picker.waitFor();
  return picker;
}

async function highlightDifferentTheme(picker, committedThemeId) {
  const input = picker.getByPlaceholder('Search themes…');
  for (let attempt = 0; attempt < THEMES.length + 1; attempt += 1) {
    await input.press('ArrowDown');
    const selected = picker.locator('[data-theme-id][data-selected="true"]');
    await selected.waitFor();
    const themeId = await selected.getAttribute('data-theme-id');
    if (themeId && themeId !== committedThemeId) return themeId;
  }
  throw new Error('Arrow navigation never highlighted a different theme');
}

async function assertCommandPickerContract(appearance) {
  const classic = THEMES[0];
  await commitPreset(appearance, classic);
  await assertRootAppearance(classic);

  const focusTarget = page.getByRole('button', {
    name: 'Preferences',
    exact: true,
  });
  await focusTarget.focus();
  const persistedBeforePreview = await page.evaluate(
    key => window.localStorage.getItem(key),
    APPEARANCE_MIRROR_KEY
  );

  let picker = await openThemePicker();
  const previewThemeId = await highlightDifferentTheme(picker, classic.id);
  await page.waitForFunction(
    themeId => document.documentElement.dataset.exaTheme === themeId,
    previewThemeId
  );
  const persistedDuringPreview = await page.evaluate(
    key => window.localStorage.getItem(key),
    APPEARANCE_MIRROR_KEY
  );
  assert(
    persistedDuringPreview === persistedBeforePreview,
    'Arrow highlight persisted a preview before Enter'
  );

  await picker.getByPlaceholder('Search themes…').press('Escape');
  await picker.waitFor({ state: 'detached' });
  await waitForCommittedState({ themeId: classic.id });
  await page.waitForFunction(
    element => document.activeElement === element,
    await focusTarget.elementHandle()
  );
  assert(
    (await page.evaluate(
      key => window.localStorage.getItem(key),
      APPEARANCE_MIRROR_KEY
    )) === persistedBeforePreview,
    'Escape changed persisted appearance state'
  );

  picker = await openThemePicker();
  const commitThemeId = await highlightDifferentTheme(picker, classic.id);
  await picker.getByPlaceholder('Search themes…').press('Enter');
  await picker.waitFor({ state: 'detached' });
  await waitForCommittedState({ themeId: commitThemeId });
  const committedTheme = THEMES.find(theme => theme.id === commitThemeId);
  assert(
    committedTheme,
    `command picker committed unknown theme ${commitThemeId}`
  );
  await assertRootAppearance(committedTheme);
}

async function assertAppearanceControlsAndLayout() {
  const appearance = await openAppearanceSettings();

  for (const theme of THEMES) {
    await commitPreset(appearance, theme);
    await assertRootAppearance(theme);
  }

  await setMode(appearance, 'auto');
  await waitForCommittedState({
    mode: 'auto',
    themeId: 'exawatt-air-light',
  });
  const autoSelection = {
    mode: 'auto',
    lightThemeId: 'exawatt-air-light',
    darkThemeId: 'exawatt-night-dark',
  };
  await assertRootAppearance(THEMES[1], { selection: autoSelection });

  await setMode(appearance, 'manual');
  await commitPreset(appearance, THEMES[0]);

  await chooseSetting(appearance, 'Interface font', 'Geist');
  await waitForCommittedState({
    themeId: THEMES[0].id,
    interfaceFont: 'geist',
  });
  await assertRootAppearance(THEMES[0], { font: 'geist' });

  const contrastSwitch = appearance.getByRole('switch', {
    name: 'Enhanced contrast',
  });
  await contrastSwitch.click();
  await waitForCommittedState({
    themeId: THEMES[0].id,
    interfaceFont: 'geist',
    contrast: 'enhanced',
  });
  await assertRootAppearance(THEMES[0], {
    font: 'geist',
    contrast: 'enhanced',
  });
  await contrastSwitch.click();

  const transparencySwitch = appearance.getByRole('switch', {
    name: 'Reduce transparency',
  });
  await transparencySwitch.click();
  await waitForCommittedState({
    themeId: THEMES[0].id,
    interfaceFont: 'geist',
    contrast: 'system',
    transparency: 'reduced',
  });
  await assertRootAppearance(THEMES[0], {
    font: 'geist',
    transparency: 'reduced',
    reducedMaterial: true,
  });
  await transparencySwitch.click();
  await waitForCommittedState({
    themeId: THEMES[0].id,
    interfaceFont: 'geist',
    transparency: 'system',
  });

  for (const viewport of [560, 900, 1400]) {
    await page.setViewportSize({ width: viewport, height: 900 });
    for (const scale of [90, 120]) {
      await chooseSetting(appearance, 'Interface text size', `${scale}%`);
      await waitForCommittedState({
        themeId: THEMES[0].id,
        interfaceFont: 'geist',
        interfaceScale: scale,
      });
      await assertRootAppearance(THEMES[0], { font: 'geist', scale });
      await assertNoHorizontalOverflow(`Settings at ${viewport}px/${scale}%`);
      await page.screenshot({
        path: join(OUTPUT, `settings-${viewport}-scale-${scale}.png`),
        fullPage: true,
      });
    }
  }

  await page.setViewportSize({ width: 1400, height: 900 });
  await chooseSetting(appearance, 'Interface text size', '100%');
  await chooseSetting(appearance, 'Interface font', 'Theme default');
  await waitForCommittedState({
    themeId: THEMES[0].id,
    interfaceFont: 'theme',
    interfaceScale: 100,
  });
  await assertCommandPickerContract(appearance);
}

async function assertSurface(theme, surface) {
  await page.goto(`${BASE}${surface.path}`, {
    waitUntil: 'domcontentloaded',
    timeout: 30_000,
  });
  for (const selector of surface.mounts) {
    await page.locator(selector).first().waitFor();
  }
  if (surface.heading) {
    await page
      .getByRole('heading', { name: surface.heading, exact: true })
      .waitFor();
  }
  await assertRootAppearance(theme);

  if (surface.canvas) {
    const board = page.locator('[data-spatial-board]');
    const canvas = board.locator('canvas');
    const canvasTheme = board.locator('[data-board-canvas-theme]');
    await canvas.waitFor({ timeout: 20_000 });
    await canvasTheme.waitFor({ timeout: 20_000 });
    check(
      (await board.getAttribute('data-spatial-theme')) === theme.id,
      `Fleet DOM theme did not match ${theme.id}`
    );
    check(
      (await board.getAttribute('data-exa-theme')) === theme.id,
      `Fleet appearance snapshot did not match ${theme.id}`
    );
    check(
      ['on', 'off'].includes(
        (await board.getAttribute('data-spatial-bloom')) ?? ''
      ),
      `Fleet bloom policy is missing for ${theme.id}`
    );
    check(
      (await canvasTheme.getAttribute('data-board-canvas-theme')) === theme.id,
      `Fleet canvas theme did not match ${theme.id}`
    );
  }

  await page.screenshot({
    path: join(OUTPUT, `${theme.key}-${surface.key}.png`),
    fullPage: surface.key !== 'fleet',
  });
}

async function assertProductionSurfaces() {
  for (const theme of THEMES) {
    const appearance = await openAppearanceSettings();
    await commitPreset(appearance, theme);
    await assertRootAppearance(theme);
    for (const surface of SURFACES) {
      await assertSurface(theme, surface);
    }
  }
}

try {
  await assertAppearanceControlsAndLayout();
  await assertProductionSurfaces();
  if (errors.length > 0) {
    contractFailures.push(`page errors:\n${errors.join('\n')}`);
  }
  assert(
    contractFailures.length === 0,
    `theme-system contract failures:\n${contractFailures.join('\n')}`
  );
  console.log(
    `PASS theme system: Settings, Auto/Manual, ⌘K preview/cancel/commit, ` +
      `560/900/1400 layouts at 90/120%, and production surfaces; ` +
      `screenshots: ${OUTPUT}`
  );
} finally {
  await context.close();
  await browser.close();
}
