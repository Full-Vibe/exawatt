#!/usr/bin/env node

import { chromium } from 'playwright-core';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.env.EXA_BASE || 'http://localhost:7000';
const SCREENSHOT_DIR =
  process.env.NAV_SCREENSHOT_DIR || '/tmp/exawatt-command-altitude';

function resolveChromium() {
  try {
    const expected = chromium.executablePath();
    if (expected && existsSync(expected)) return undefined;
  } catch {
    // Fall through to cache scan.
  }

  const home = process.env.HOME || '';
  const roots = [
    join(home, 'Library/Caches/ms-playwright'),
    join(home, '.cache/ms-playwright'),
  ];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const dir of readdirSync(root)) {
      if (!dir.startsWith('chromium')) continue;
      const candidates = [
        join(root, dir, 'chrome-mac/Chromium.app/Contents/MacOS/Chromium'),
        join(root, dir, 'chrome-linux/chrome'),
      ];
      for (const candidate of candidates) {
        if (existsSync(candidate)) return candidate;
      }
    }
  }
  return null;
}

function requireState(condition, message) {
  if (!condition) throw new Error(message);
}

const executablePath = resolveChromium();
if (executablePath === null) {
  throw new Error(
    'Chromium is unavailable. Run `pnpm exec playwright install chromium`.'
  );
}

const browser = await chromium.launch({
  headless: true,
  executablePath: executablePath || undefined,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', error => errors.push(String(error.message || error)));
page.on('console', message => {
  if (message.type() === 'error') errors.push(message.text());
});

await page.addInitScript(() => {
  const session = {
    id: 'nav-eval-session',
    harness: 'shell',
    title: 'Navigation evaluation',
    cwd: '/tmp/exawatt-navigation-eval',
    projectDir: '/tmp/exawatt-navigation-eval',
    projectName: 'Navigation evaluation',
    cols: 120,
    rows: 40,
    startedAt: Date.now(),
    exited: false,
    exitCode: null,
    lastDataAt: Date.now(),
    contextSummary: 'Verify the command altitude continuum',
    attention: null,
  };
  const off = () => () => undefined;
  window.electron = {
    isElectron: true,
    platform: 'darwin',
    settings: {
      get: async () => ({}),
      onChanged: off,
    },
    workspace: {
      load: async () => null,
      save: async () => undefined,
    },
    pty: {
      create: async () => ({ ok: true, session }),
      write: async () => undefined,
      engage: async () => undefined,
      resize: async () => undefined,
      kill: async () => undefined,
      rename: async () => undefined,
      focus: async () => undefined,
      list: async () => [session],
      buffer: async () => '$ exawatt\nNavigation continuum ready.\n',
      createWorktree: async () => ({ ok: true, path: session.cwd }),
      onData: off,
      onExit: off,
      onContext: off,
      onRecap: off,
      onAttention: off,
    },
  };
});

mkdirSync(SCREENSHOT_DIR, { recursive: true });

try {
  await page.goto(`${BASE}/workspace`, { waitUntil: 'networkidle' });
  const altitude = page.locator('[data-command-altitude]');
  await altitude.waitFor();
  requireState(
    (await altitude.locator('button').count()) === 3,
    'Expected three command altitude controls'
  );
  requireState(
    (await page
      .locator('[data-command-altitude-level="terminal"][aria-current="page"]')
      .count()) === 1,
    'Terminal altitude was not active'
  );
  await page.screenshot({
    path: join(SCREENSHOT_DIR, 'terminal.png'),
    fullPage: true,
  });

  await page.locator('[data-command-altitude-level="sessions"]').click();
  await page.waitForURL('**/workspace?view=sessions');
  await page.locator('[data-expose]').waitFor();
  await page.waitForTimeout(400);
  const stageStyle = await page
    .locator('[data-workspace-stage]')
    .evaluate(element => ({
      scale: getComputedStyle(element).scale,
      opacity: Number(getComputedStyle(element).opacity),
    }));
  requireState(
    stageStyle.scale !== 'none' && stageStyle.scale !== '1',
    'Terminal did not visually recede'
  );
  requireState(
    stageStyle.opacity < 0.7,
    'Terminal did not de-emphasize under overview'
  );
  requireState(
    (await page
      .locator('[data-command-altitude-level="sessions"][aria-current="page"]')
      .count()) === 1,
    'Sessions altitude was not active'
  );
  await page.screenshot({
    path: join(SCREENSHOT_DIR, 'sessions.png'),
    fullPage: true,
  });

  await page.locator('[data-command-altitude-level="spatial"]').click();
  await page.waitForURL('**/fleet/spatial');
  requireState(
    (await page
      .locator('[data-command-altitude-level="spatial"][aria-current="page"]')
      .count()) === 1,
    'Spatial altitude was not active'
  );
  await page.screenshot({
    path: join(SCREENSHOT_DIR, 'spatial.png'),
    fullPage: true,
  });

  await page.getByRole('button', { name: 'Angle' }).click();
  await page.waitForURL(
    url => url.searchParams.get('projection') === 'fixed-angle'
  );
  await page.locator('[data-board-zone]').first().click();
  await page.waitForURL(url => url.searchParams.get('altitude') === 'project');
  await page.locator('[data-board-agent="nav-eval-session"]').click();
  await page.waitForURL(url => url.searchParams.get('altitude') === 'agent');
  const returnAddress =
    new URL(page.url()).pathname + new URL(page.url()).search;
  requireState(
    returnAddress.includes('altitude=agent') &&
      returnAddress.includes('projection=fixed-angle'),
    'Agent board address did not preserve altitude and projection'
  );
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.locator('[data-open-agent-session="nav-eval-session"]').click();
  await page.waitForURL('**/workspace');
  await page.locator('[data-active="true"]').waitFor();
  requireState(
    (await page.locator('[data-active="true"]').textContent())?.includes(
      'Navigation evaluation'
    ),
    'Session handoff did not activate the selected PTY'
  );
  await page.locator('[data-command-altitude-level="spatial"]').click();
  await page.waitForURL(
    url => `${url.pathname}${url.search}` === returnAddress
  );
  await page.emulateMedia({ reducedMotion: 'no-preference' });

  await page.keyboard.press('Meta+Shift+M');
  await page.waitForURL('**/workspace');
  await page
    .locator('[data-command-altitude-level="terminal"][aria-current="page"]')
    .waitFor();

  await page.keyboard.press('Meta+Shift+M');
  await page.waitForURL(
    url => `${url.pathname}${url.search}` === returnAddress
  );
  await page
    .locator('[data-command-altitude-level="spatial"][aria-current="page"]')
    .waitFor();

  await page.locator('[data-command-altitude-level="terminal"]').click();
  await page.waitForURL('**/workspace');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.locator('[data-command-altitude-level="sessions"]').click();
  await page.waitForURL('**/workspace?view=sessions');
  await page.locator('[data-expose]').waitFor();
  await page.waitForTimeout(400);
  const reducedStageStyle = await page
    .locator('[data-workspace-stage]')
    .evaluate(element => ({
      scale: getComputedStyle(element).scale,
      opacity: Number(getComputedStyle(element).opacity),
    }));
  requireState(
    reducedStageStyle.scale === 'none' || reducedStageStyle.scale === '1',
    'Reduced-motion overview still used spatial scaling'
  );
  requireState(
    reducedStageStyle.opacity < 0.7,
    'Reduced-motion overview lost visual de-emphasis'
  );

  requireState(errors.length === 0, `Browser errors: ${errors.join(' | ')}`);
  console.log(
    'PASS command altitude: Terminal → Sessions → Spatial → shortcut round trip'
  );
  console.log(`Screenshots: ${SCREENSHOT_DIR}`);
} finally {
  await browser.close();
}
