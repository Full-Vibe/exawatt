#!/usr/bin/env node

import { _electron as electron } from 'playwright-core';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = process.env.EXA_BASE || 'http://localhost:7000';
const SCREENSHOT_DIR =
  process.env.NAV_SCREENSHOT_DIR || '/tmp/exawatt-electron-altitude';
const userData = mkdtempSync(join(tmpdir(), 'exawatt-nav-eval-'));
mkdirSync(SCREENSHOT_DIR, { recursive: true });

const app = await electron.launch({
  args: ['.'],
  cwd: process.cwd(),
  env: {
    ...process.env,
    NODE_ENV: 'development',
    EXAWATT_TEST: '1',
    EXAWATT_USER_DATA: userData,
    EXAWATT_DEV_URL: `${BASE}/workspace`,
  },
});

try {
  const page = await app.firstWindow();
  page.setDefaultTimeout(15_000);
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

  await page.locator('[data-command-altitude]').waitFor();
  console.log('[electron-navigation] workspace ready');
  await page.evaluate(dir => {
    window.dispatchEvent(
      new CustomEvent('exawatt:open-project', { detail: dir })
    );
  }, process.cwd());
  await page.locator('[data-agent-composer]').waitFor();
  await page.getByRole('button', { name: /Open shell in / }).click();
  await page.waitForFunction(async () => {
    const sessions = await window.electron?.pty?.list();
    return sessions?.length === 1;
  });
  console.log('[electron-navigation] PTY launched');
  const sessionId = await page.evaluate(async () => {
    const [session] = (await window.electron?.pty?.list()) ?? [];
    if (!session) throw new Error('Launched PTY was not available');
    await window.electron?.pty?.write(
      session.id,
      "printf '\\033[2J\\033[HSESSION_PREVIEW_READY\\033[0 q\\n'\r"
    );
    return session.id;
  });
  await page.waitForFunction(id => {
    const terminal = window.__XTERMS__?.[id];
    if (!terminal) return false;
    const buffer = terminal.buffer.active;
    for (let i = 0; i < buffer.length; i += 1) {
      if (
        buffer.getLine(i)?.translateToString(true).trim() ===
        'SESSION_PREVIEW_READY'
      ) {
        return true;
      }
    }
    return false;
  }, sessionId);
  await page.screenshot({
    path: join(SCREENSHOT_DIR, 'after-launch.png'),
    fullPage: true,
  });
  await page
    .locator('[data-project]')
    .waitFor()
    .catch(async error => {
      console.error(
        '[electron-navigation] terminal launch debug',
        JSON.stringify({
          errors,
          sessions: await page.evaluate(() => window.electron?.pty?.list()),
        })
      );
      throw error;
    });
  await page.screenshot({
    path: join(SCREENSHOT_DIR, 'terminal.png'),
    fullPage: true,
  });

  await page.locator('[data-command-altitude-level="sessions"]').click();
  await page.waitForURL('**/workspace?view=sessions');
  // On failure, capture the sessions surface: a missing tile usually means
  // the PTY spawn failed upstream (e.g. node-pty built for the wrong ABI in
  // a fresh worktree — run `pnpm electron:rebuild`), and the screenshot
  // shows the spawn-error banner that explains it.
  await page
    .locator('[data-expose-tile]')
    .waitFor()
    .catch(async error => {
      await page.screenshot({
        path: join(SCREENSHOT_DIR, 'sessions-failure.png'),
        fullPage: true,
      });
      throw error;
    });
  await page.waitForTimeout(650); // entrance stagger + opacity transition
  console.log('[electron-navigation] session overview ready');
  const card = page.locator('[data-expose-tile]').first();
  const previewText = await card.innerText();
  if (
    previewText.includes('SESSION_PREVIEW_READY') ||
    previewText.includes('[0 q') ||
    previewText.includes('[2J')
  ) {
    throw new Error(`Sessions leaked terminal output: ${previewText}`);
  }
  if (
    !previewText.includes('Shell is active') &&
    !previewText.includes('Shell is idle')
  ) {
    throw new Error(`Sessions omitted truthful current state: ${previewText}`);
  }
  const cardType = await card.evaluate(element => {
    const title = element.querySelector('[data-session-overview-title]');
    const current = element.querySelector('[data-session-current]');
    const next = element.querySelector('[data-session-next-copy]');
    if (
      !(title instanceof HTMLElement) ||
      !(current instanceof HTMLElement) ||
      !(next instanceof HTMLElement)
    ) {
      throw new Error('Sessions card typography hooks did not render');
    }
    const metrics = node => {
      const style = getComputedStyle(node);
      return {
        size: Number.parseFloat(style.fontSize),
        family: style.fontFamily,
      };
    };
    return {
      title: metrics(title),
      current: metrics(current),
      next: metrics(next),
    };
  });
  if (
    cardType.title.size < 16 ||
    cardType.current.size < 15 ||
    cardType.next.size < 14
  ) {
    throw new Error(
      `Sessions card copy is too small: ${JSON.stringify(cardType)}`
    );
  }
  if (
    cardType.current.family === cardType.next.family &&
    /mono/i.test(cardType.current.family)
  ) {
    throw new Error(
      `Sessions operational copy still uses mono: ${JSON.stringify(cardType)}`
    );
  }
  await page.screenshot({
    path: join(SCREENSHOT_DIR, 'sessions.png'),
    fullPage: true,
  });

  await page.locator('[data-command-altitude-level="spatial"]').click();
  await page.waitForURL('**/fleet/spatial');
  await page
    .locator('[data-command-altitude-level="spatial"][aria-current="page"]')
    .waitFor();
  console.log('[electron-navigation] spatial board ready');
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
  const agentControl = page.locator('[data-board-agent]').first();
  await agentControl.waitFor();
  const agentId = await agentControl.getAttribute('data-board-agent');
  if (!agentId) throw new Error('Spatial board did not expose the live Agent');
  await agentControl.click();
  await page.waitForURL(url => url.searchParams.get('altitude') === 'agent');
  console.log('[electron-navigation] Agent selected');
  const returnAddress =
    new URL(page.url()).pathname + new URL(page.url()).search;
  await page.locator(`[data-open-agent-session="${agentId}"]`).click();
  await page.waitForURL('**/workspace');
  await page.locator('[data-active="true"]').waitFor();
  console.log('[electron-navigation] same PTY activated');
  await page.locator('[data-command-altitude-level="spatial"]').click();
  await page.waitForURL(
    url => `${url.pathname}${url.search}` === returnAddress
  );
  console.log('[electron-navigation] exact board address restored');

  await page.keyboard.press('Control+Meta+1');
  await page.waitForURL('**/workspace');
  await page.locator('[data-project]').waitFor();
  const sessionCount = await page.evaluate(async () => {
    const sessions = await window.electron?.pty?.list();
    return sessions?.length ?? 0;
  });
  if (sessionCount !== 1) {
    throw new Error(
      `Expected the live PTY to survive navigation; found ${sessionCount}`
    );
  }
  if (errors.length > 0) {
    throw new Error(`Electron errors: ${errors.join(' | ')}`);
  }

  console.log(
    'PASS Electron navigation: live terminal → Spatial Agent → same PTY → exact board return'
  );
  console.log(`Screenshots: ${SCREENSHOT_DIR}`);
} finally {
  await app.close();
  rmSync(userData, { recursive: true, force: true });
}
