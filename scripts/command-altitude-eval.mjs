#!/usr/bin/env node

import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { resolveQaBrowserLaunchOptions } from './lib/qa-browser.mjs';

const BASE = process.env.EXA_BASE || 'http://localhost:7000';
const SCREENSHOT_DIR =
  process.env.NAV_SCREENSHOT_DIR || '/tmp/exawatt-command-altitude';

function requireState(condition, message) {
  if (!condition) throw new Error(message);
}

const browser = await chromium.launch({
  headless: true,
  ...(await resolveQaBrowserLaunchOptions(chromium)),
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', error => errors.push(String(error.message || error)));
page.on('console', message => {
  if (
    message.type() === 'error' &&
    !message.text().includes('eval() is not supported')
  ) {
    errors.push(message.text());
  }
});

await page.addInitScript(() => {
  const session = {
    id: 'nav-eval-session',
    durableSessionId: 'nav-eval-session',
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
    harnessSessionId: null,
    attention: null,
  };
  const secondSession = {
    ...session,
    id: 'nav-eval-session-2',
    durableSessionId: 'nav-eval-session-2',
    title: 'Secondary navigation evaluation',
    contextSummary: 'Keep the overview keyboard model deterministic',
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
      recovery: async () => ({ previousRunInterrupted: false }),
    },
    pty: {
      create: async () => ({ ok: true, session }),
      write: async () => undefined,
      engage: async () => undefined,
      resize: async () => undefined,
      kill: async () => undefined,
      rename: async () => undefined,
      focus: async () => undefined,
      list: async () => [session, secondSession],
      buffer: async () => '$ exawatt\nNavigation continuum ready.\n',
      bufferSnapshot: async () => ({
        text: 'Navigation continuum ready.',
        cursor: 0,
      }),
      bufferSince: async () => ({ data: '', cursor: 0 }),
      pasteClipboard: async () => ({ ok: true }),
      copyText: async () => undefined,
      openExternal: async () => undefined,
      openPath: async () => undefined,
      listResumeCandidates: async () => [],
      createWorktree: async () => ({ ok: true, path: session.cwd }),
      onData: off,
      onExit: off,
      onContext: off,
      onRecap: off,
      onAttention: off,
      onNotificationClick: off,
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
  requireState(
    (await page
      .locator('[data-command-altitude-level="terminal"]')
      .getAttribute('aria-keyshortcuts')) === 'Control+Meta+1',
    'Terminal altitude did not advertise its absolute shortcut'
  );
  requireState(
    (await page
      .locator('[data-command-altitude-level="sessions"]')
      .getAttribute('aria-keyshortcuts')) === 'Control+Meta+2',
    'Sessions altitude did not advertise its absolute shortcut'
  );
  requireState(
    (await page
      .locator('[data-command-altitude-level="spatial"]')
      .getAttribute('aria-keyshortcuts')) === 'Control+Meta+3',
    'Spatial altitude did not advertise its absolute shortcut'
  );
  const initialTabText = await page
    .locator('[data-active="true"]')
    .textContent();
  await page.keyboard.press('Meta+Shift+BracketLeft');
  await page.waitForFunction(
    previous =>
      document.querySelector('[data-active="true"]')?.textContent !== previous,
    initialTabText
  );
  await page.keyboard.press('Meta+Shift+BracketRight');
  await page.waitForFunction(
    initial =>
      document.querySelector('[data-active="true"]')?.textContent === initial,
    initialTabText
  );
  await page.screenshot({
    path: join(SCREENSHOT_DIR, 'terminal.png'),
    fullPage: true,
  });

  await page.locator('[data-command-altitude-level="sessions"]').click();
  await page.waitForURL('**/workspace?view=sessions');
  await page.locator('[data-expose]').waitFor();
  await page.waitForTimeout(400);
  requireState(
    (await page.locator('[data-expose]').getAttribute('role')) === 'region',
    'Sessions overview still exposed modal semantics'
  );
  requireState(
    (await page.locator('[data-workspace-underlay]').getAttribute('inert')) !==
      null,
    'Obscured workspace controls were not inert'
  );
  const originTile = page.locator('[data-expose-tile][data-selected="true"]');
  requireState(
    await originTile.evaluate(element => element === document.activeElement),
    'Sessions overview did not focus the originating Session'
  );
  const originText = await originTile.textContent();
  await page.keyboard.press(
    originText?.includes('Secondary navigation evaluation')
      ? 'ArrowLeft'
      : 'ArrowRight'
  );
  requireState(
    (await page
      .locator('[data-expose-tile][data-selected="true"]')
      .textContent()) !== originText,
    'Sessions arrow navigation did not move the roving selection'
  );
  await page.keyboard.press('Tab');
  requireState(
    !(await page.evaluate(() =>
      document.activeElement?.closest('[data-workspace-underlay]')
    )),
    'Tab reached obscured workspace controls'
  );
  await page.keyboard.press('Escape');
  await page.waitForURL(url => !url.searchParams.has('view'));
  await page.keyboard.press('Control+Meta+2');
  await page.waitForURL('**/workspace?view=sessions');
  await page.locator('[data-expose]').waitFor();
  await page.keyboard.press('Control+Meta+2');
  requireState(
    await page
      .locator('[data-expose-tile][data-selected="true"]')
      .evaluate(element => element === document.activeElement),
    'Active Sessions click did not restore overview focus'
  );
  // The stage recedes via a 300ms CSS transition; a single instantaneous
  // read races it (D19: the read landed mid-flight and flaked). Poll until
  // the SETTLED state proves both scale and opacity de-emphasis.
  let stageStyle = { scale: 'none', opacity: 1 };
  const stageDeadline = Date.now() + 2000;
  while (Date.now() < stageDeadline) {
    stageStyle = await page
      .locator('[data-workspace-stage]')
      .evaluate(element => ({
        scale: getComputedStyle(element).scale,
        opacity: Number(getComputedStyle(element).opacity),
      }));
    if (
      stageStyle.scale !== 'none' &&
      stageStyle.scale !== '1' &&
      stageStyle.opacity < 0.7
    ) {
      break;
    }
    await page.waitForTimeout(50);
  }
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

  await page.keyboard.press('Escape');
  await page.waitForURL(url => !url.searchParams.has('view'));
  requireState(
    (await page.locator('[data-active="true"]').textContent())?.includes(
      originText?.includes('Secondary navigation evaluation')
        ? 'Secondary navigation evaluation'
        : 'Navigation evaluation'
    ),
    'Escape from Sessions changed the originating Session'
  );
  await page.locator('[data-command-altitude-level="terminal"]').click();
  requireState(
    await page.evaluate(() =>
      document.activeElement?.classList.contains('xterm-helper-textarea')
    ),
    'Active Terminal click did not restore xterm focus'
  );

  await page.locator('[data-command-altitude-level="spatial"]').click();
  const commandTransition = page.locator('[data-command-transition]');
  await commandTransition.waitFor();
  requireState(
    (await commandTransition.getAttribute('data-command-transition-target')) ===
      'spatial',
    'Shared transition did not identify the Spatial destination'
  );
  await page.locator('[data-command-transition="traversing"]').waitFor();
  await page.screenshot({
    path: join(SCREENSHOT_DIR, 'transition-to-spatial.png'),
    fullPage: true,
  });
  await page.waitForURL('**/fleet/spatial');
  requireState(
    (await page
      .locator('[data-command-altitude-level="spatial"][aria-current="page"]')
      .count()) === 1,
    'Spatial altitude was not active'
  );
  await page.locator('[data-spatial-board]').waitFor();
  await commandTransition.waitFor({ state: 'detached' });
  await page.waitForTimeout(800);
  await page.screenshot({
    path: join(SCREENSHOT_DIR, 'spatial.png'),
    fullPage: true,
  });

  await page.getByRole('button', { name: 'Zoom in' }).click();
  await page.waitForTimeout(500);
  const zoomedViewport = await page.evaluate(() => {
    const value = window.sessionStorage.getItem(
      'exawatt:spatial-viewport:v2:fleet:~:~:top-down'
    );
    return value ? JSON.parse(value) : null;
  });
  requireState(
    zoomedViewport?.width > 0,
    'Spatial camera viewport was not stored for the renderer session'
  );
  await page.locator('[data-command-altitude-level="spatial"]').click();
  await page.waitForFunction(zoomedWidth => {
    const value = window.sessionStorage.getItem(
      'exawatt:spatial-viewport:v2:fleet:~:~:top-down'
    );
    if (!value) return false;
    return JSON.parse(value).width > zoomedWidth;
  }, zoomedViewport.width);
  const recenteredViewport = await page.evaluate(() => {
    const value = window.sessionStorage.getItem(
      'exawatt:spatial-viewport:v2:fleet:~:~:top-down'
    );
    return value ? JSON.parse(value) : null;
  });
  requireState(
    recenteredViewport?.width > zoomedViewport.width,
    `Active Spatial click did not recenter the board (${JSON.stringify({ zoomedViewport, recenteredViewport })})`
  );

  await page.setViewportSize({ width: 1000, height: 800 });
  const shortcutHelpButton = page.getByRole('button', {
    name: 'Keyboard shortcuts',
  });
  requireState(
    await shortcutHelpButton.isVisible(),
    'Narrow Spatial layout did not expose shortcut help'
  );
  await shortcutHelpButton.click();
  await page.getByLabel('Filter shortcuts').waitFor();
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 1440, height: 900 });

  const spatialSearch = page.getByLabel('Search agents');
  await spatialSearch.fill('navigation');
  await page.waitForURL(url => url.searchParams.get('q') === 'navigation');
  // exact: the Team altitude button's accessible name ("...the Agents working
  // them") substring-matches 'working' under Playwright's default matching.
  await page.getByRole('button', { name: 'working', exact: true }).click();
  await page.waitForURL(url => url.searchParams.get('status') === 'working');
  const filteredAddress =
    new URL(page.url()).pathname + new URL(page.url()).search;
  await page.locator('[data-command-altitude-level="terminal"]').click();
  await page.waitForURL('**/workspace');
  await page.locator('[data-command-altitude-level="spatial"]').click();
  await page.waitForURL(
    url => `${url.pathname}${url.search}` === filteredAddress
  );
  await page.getByTitle('Clear search and filters').click();
  await page.waitForURL(
    url => !url.searchParams.has('q') && !url.searchParams.has('status')
  );
  const fleetAddress =
    new URL(page.url()).pathname + new URL(page.url()).search;

  await spatialSearch.focus();
  await page.keyboard.press('Control+Meta+1');
  await page.waitForURL('**/workspace');
  await page
    .locator('[data-command-altitude-level="terminal"][aria-current="page"]')
    .waitFor();
  await page
    .locator('.xterm-helper-textarea')
    .first()
    .waitFor({ state: 'attached' });
  await page.keyboard.press('Control+Meta+1');
  await page.waitForFunction(() =>
    document.activeElement?.classList.contains('xterm-helper-textarea')
  );
  requireState(
    await page.evaluate(() =>
      document.activeElement?.classList.contains('xterm-helper-textarea')
    ),
    'Repeated Terminal shortcut did not restore xterm focus'
  );

  await page.keyboard.press('Control+Meta+2');
  await page.waitForURL('**/workspace?view=sessions');
  await page.locator('[data-expose]').waitFor();
  await page.keyboard.press('Control+Meta+2');
  requireState(
    await page
      .locator('[data-expose-tile][data-selected="true"]')
      .evaluate(element => element === document.activeElement),
    'Repeated Sessions shortcut did not restore overview focus'
  );

  await page.keyboard.press('Control+Meta+3');
  await page.waitForURL(url => `${url.pathname}${url.search}` === fleetAddress);
  await page
    .locator('[data-command-altitude-level="spatial"][aria-current="page"]')
    .waitFor();
  await page.keyboard.press('Control+Meta+3');
  requireState(
    page.url().includes('/fleet/spatial'),
    'Repeated Spatial shortcut left Spatial instead of recentering it'
  );

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

  await page.keyboard.press('Control+Meta+1');
  await page.waitForURL('**/workspace');
  await page.keyboard.press('Control+Meta+3');
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

  await page.evaluate(() => {
    window.localStorage.setItem(
      'exawatt:last-command-surface:v1',
      '/fleet/spatial?projection=fixed-angle'
    );
  });
  await page.goto(`${BASE}/workspace`, { waitUntil: 'networkidle' });
  await page.waitForURL(
    url =>
      url.pathname === '/fleet/spatial' &&
      url.searchParams.get('projection') === 'fixed-angle'
  );

  requireState(errors.length === 0, `Browser errors: ${errors.join(' | ')}`);
  console.log(
    'PASS command altitude: Terminal → Sessions → Spatial → shortcut round trip'
  );
  console.log(`Screenshots: ${SCREENSHOT_DIR}`);
} finally {
  await browser.close();
}
