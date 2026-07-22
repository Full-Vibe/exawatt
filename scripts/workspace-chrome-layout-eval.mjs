#!/usr/bin/env node

import { chromium } from 'playwright-core';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.env.EXA_BASE || 'http://localhost:7000';
const SCREENSHOT_DIR =
  process.env.EXAWATT_CHROME_SCREENSHOTS ||
  '/tmp/exawatt-workspace-chrome-layout';

function resolveChromium() {
  try {
    const expected = chromium.executablePath();
    if (expected && existsSync(expected)) return undefined;
  } catch {
    // Fall through to cache scan.
  }

  const home = process.env.HOME || '';
  for (const root of [
    join(home, 'Library/Caches/ms-playwright'),
    join(home, '.cache/ms-playwright'),
  ]) {
    if (!existsSync(root)) continue;
    for (const dir of readdirSync(root)) {
      if (!dir.startsWith('chromium')) continue;
      for (const candidate of [
        join(root, dir, 'chrome-mac/Chromium.app/Contents/MacOS/Chromium'),
        join(root, dir, 'chrome-linux/chrome'),
      ]) {
        if (existsSync(candidate)) return candidate;
      }
    }
  }
  return null;
}

function session({
  id,
  harness,
  title,
  cwd,
  projectName,
  contextSummary,
  engaged = false,
}) {
  return {
    engaged,
    id,
    durableSessionId: id,
    harness,
    title,
    cwd,
    projectDir: cwd,
    projectName,
    cols: 120,
    rows: 40,
    startedAt: Date.now(),
    exited: false,
    exitCode: null,
    lastDataAt: Date.now(),
    contextSummary,
    harnessSessionId: `provider-${id}`,
    attention: null,
  };
}

const liveSessions = [
  session({
    id: 'gpa-session',
    harness: 'claude',
    title: 'Claude Code',
    cwd: '/tmp/gpagent',
    projectName: 'gpagent',
    contextSummary: 'Testing UTC date parsing fix and seeding demo org',
    engaged: true,
  }),
  session({
    id: 'exawatt-session',
    harness: 'codex',
    title: 'Codex',
    cwd: '/tmp/exawatt',
    projectName: 'exawatt',
    contextSummary: 'Updating tests for harness command permission flags',
    engaged: true,
  }),
  // D22: a freshly launched agent — no task, no summary, never engaged.
  // Must read as "fresh" and render glyph-only (no "Claude Code" text).
  session({
    id: 'fresh-session',
    harness: 'claude',
    title: 'Claude Code',
    cwd: '/tmp/exawatt',
    projectName: 'exawatt',
  }),
];

const persistedLayout = {
  v: 5,
  lastUsedDir: '/tmp/exawatt',
  activeDir: '/tmp/exawatt',
  pinnedTabId: null,
  projects: [
    {
      dir: '/tmp/gpagent',
      name: 'gpagent',
      color: '#50e6ff',
      activeTabId: 'gpa-tab',
      tabs: [
        {
          id: 'gpa-tab',
          durableSessionId: 'gpa-session',
          harness: 'claude',
          title: 'Claude Code',
          cwd: '/tmp/gpagent',
          sessionId: 'gpa-session',
          harnessSessionId: null,
          roadmapItemId: null,
          lifecycle: 'running',
          exitCode: null,
        },
        // a stopped Session restored from a previous run (D24): renders as
        // a condensed frozen chip until hover/focus unfurls it
        {
          id: 'frozen-tab',
          durableSessionId: 'frozen-session',
          harness: 'claude',
          title: 'billing migration',
          cwd: '/tmp/gpagent',
          sessionId: null,
          harnessSessionId: 'provider-frozen',
          roadmapItemId: null,
          lifecycle: 'stopped-clean',
          exitCode: 0,
          initialTask: null,
          contextSummary: 'Migrate billing to usage-based',
        },
      ],
    },
    {
      dir: '/tmp/exawatt',
      name: 'exawatt',
      color: '#ff3b8b',
      activeTabId: 'exawatt-tab',
      tabs: [
        {
          id: 'exawatt-tab',
          durableSessionId: 'exawatt-session',
          harness: 'codex',
          title: 'Codex',
          cwd: '/tmp/exawatt',
          sessionId: 'exawatt-session',
          harnessSessionId: null,
          roadmapItemId: null,
          lifecycle: 'running',
          exitCode: null,
        },
        {
          id: 'fresh-tab',
          durableSessionId: 'fresh-session',
          harness: 'claude',
          title: 'Claude Code',
          cwd: '/tmp/exawatt',
          sessionId: 'fresh-session',
          harnessSessionId: null,
          roadmapItemId: null,
          lifecycle: 'running',
          exitCode: null,
        },
      ],
    },
    {
      dir: '/tmp/cortex-ehr',
      name: 'cortex-ehr',
      color: '#ffb02e',
      activeTabId: null,
      tabs: [],
    },
  ],
};

const executablePath = resolveChromium();
if (executablePath === null) {
  throw new Error(
    'Chromium is unavailable. Run `pnpm exec playwright install chromium`.'
  );
}

mkdirSync(SCREENSHOT_DIR, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath: executablePath || undefined,
});
const page = await browser.newPage({ viewport: { width: 1312, height: 700 } });
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

await page.addInitScript(
  ({ sessions, layout }) => {
    const off = () => () => undefined;
    window.electron = {
      isElectron: true,
      platform: 'darwin',
      settings: {
        get: async () => ({}),
        set: async () => undefined,
        onChanged: off,
      },
      workspace: {
        load: async () => layout,
        save: async () => undefined,
        recovery: async () => ({ previousRunInterrupted: false }),
        onChanged: off,
      },
      projects: {
        resolve: async dir => ({
          projectDir: dir,
          projectName: dir.split('/').filter(Boolean).at(-1) || dir,
        }),
      },
      pty: {
        create: async () => ({ ok: true, session: sessions[0] }),
        write: async () => undefined,
        engage: async () => undefined,
        resize: async () => undefined,
        kill: async () => undefined,
        rename: async () => undefined,
        focus: async () => undefined,
        list: async () => sessions,
        buffer: async () => '$ exawatt\nWorkspace chrome ready.\n',
        bufferSnapshot: async () => ({
          text: 'Workspace chrome ready.',
          cursor: 0,
        }),
        bufferSince: async () => ({ data: '', cursor: 0 }),
        retainedHistory: async () => ({
          text: 'Workspace chrome ready.',
          cursor: 0,
          updatedAt: 1,
          corrupt: false,
        }),
        pasteClipboard: async () => ({ ok: true }),
        copyText: async () => undefined,
        openExternal: async () => undefined,
        openPath: async () => undefined,
        listResumeCandidates: async () => [],
        createWorktree: async () => ({ ok: true, path: '/tmp/worktree' }),
        // D24 chrome-model close: confirm is native in main — the mock
        // records calls and consents; closeSession stops via the captured
        // exit handler, exactly like main's stop → natural-exit path
        closeSession: async durableSessionId => {
          const session = sessions.find(
            s => s.durableSessionId === durableSessionId
          );
          if (session) {
            window.__fireExit?.({
              id: session.id,
              durableSessionId,
              exitCode: 0,
            });
          }
          return true;
        },
        clipboardRead: async () => ({ kind: 'empty' }),
        archiveSession: async entry => ({ ...entry, closedAt: 1 }),
        closedSessions: async () => [],
        reopenSession: async () => null,
        onData: off,
        onExit: handler => {
          window.__fireExit = handler;
          return () => undefined;
        },
        onContext: off,
        onRecap: off,
        onAttention: off,
        onIdentity: off,
        onNotificationClick: off,
        // captured so the eval can drive turn-state transitions (D22)
        onActivity: handler => {
          window.__fireActivity = handler;
          return () => undefined;
        },
        onEngaged: handler => {
          window.__fireEngaged = handler;
          return () => undefined;
        },
      },
    };
  },
  { sessions: liveSessions, layout: persistedLayout }
);

try {
  await page.goto(`${BASE}/workspace`, { waitUntil: 'networkidle' });
  const chrome = page.locator('[data-workspace-chrome]');
  await chrome.waitFor();
  await page.locator('[data-project="cortex-ehr"]').waitFor();
  // ⌘T pops a REAL tab (D24): the New Agent button creates a draft tab
  // whose pane hosts the composer — geometry checks run against that pane
  const composerToggle = page.locator('[data-composer-toggle]');
  await composerToggle.waitFor();
  await composerToggle.click();
  const composer = page.locator('[data-agent-composer]');
  await composer.waitFor();
  if (!(await page.locator('[data-workspace-tab-strip]').innerText()).includes('New agent')) {
    throw new Error('⌘T must create a visible draft tab in the strip');
  }

  const results = [];
  for (const width of [560, 800, 1024, 1312, 1400, 1600]) {
    await page.setViewportSize({ width, height: 700 });
    await page.evaluate(
      () =>
        new Promise(resolve =>
          requestAnimationFrame(() => requestAnimationFrame(resolve))
        )
    );

    const metrics = await page.evaluate(() => {
      const chromeElement = document.querySelector('[data-workspace-chrome]');
      const panelElement = document.querySelector('[data-agent-composer]');
      const taskElement = document.querySelector(
        '[aria-label="Initial task for the new Agent"]'
      );
      const sourceElement = document.querySelector(
        '[aria-label="Agent Source"]'
      );
      const permissionElement = document.querySelector(
        '[aria-label="Agent permissions"]'
      );
      if (
        !(chromeElement instanceof HTMLElement) ||
        !(panelElement instanceof HTMLElement) ||
        !(taskElement instanceof HTMLTextAreaElement) ||
        !(sourceElement instanceof HTMLElement) ||
        !(permissionElement instanceof HTMLElement)
      ) {
        throw new Error('Workspace chrome fixture did not render');
      }
      const chromeRect = chromeElement.getBoundingClientRect();
      const panelRect = panelElement.getBoundingClientRect();
      const taskRect = taskElement.getBoundingClientRect();
      const subtitleElement = document.querySelector('[data-subtitle]');
      return {
        chrome: {
          left: chromeRect.left,
          right: chromeRect.right,
          width: chromeRect.width,
          scrollWidth: chromeElement.scrollWidth,
        },
        panel: {
          left: panelRect.left,
          right: panelRect.right,
          width: panelRect.width,
          viewportWidth: window.innerWidth,
        },
        sourceWidth: sourceElement.getBoundingClientRect().width,
        permissionWidth: permissionElement.getBoundingClientRect().width,
        task: {
          width: taskRect.width,
          clientHeight: taskElement.clientHeight,
          scrollHeight: taskElement.scrollHeight,
        },
        subtitleDisplay:
          subtitleElement instanceof HTMLElement
            ? getComputedStyle(subtitleElement).display
            : null,
      };
    });

    await page.screenshot({
      path: join(SCREENSHOT_DIR, `workspace-${width}x700.png`),
    });

    if (metrics.chrome.scrollWidth > metrics.chrome.width + 1) {
      throw new Error(
        `Workspace chrome overflows at ${width}px: ${JSON.stringify(metrics)}`
      );
    }
    if (
      metrics.panel.left < 0 ||
      metrics.panel.right > metrics.panel.viewportWidth + 1
    ) {
      throw new Error(
        `Composer panel exceeds the viewport at ${width}px: ${JSON.stringify(metrics)}`
      );
    }
    if (metrics.task.width < 320) {
      throw new Error(
        `Agent task field is too narrow at ${width}px: ${JSON.stringify(metrics)}`
      );
    }
    if (metrics.task.scrollHeight > metrics.task.clientHeight + 1) {
      throw new Error(
        `Agent task placeholder is clipped at ${width}px: ${JSON.stringify(metrics)}`
      );
    }
    if (metrics.sourceWidth < 147) {
      throw new Error(
        `Agent Source collapsed at ${width}px: ${JSON.stringify(metrics)}`
      );
    }
    if (metrics.permissionWidth < 79) {
      throw new Error(
        `Agent permission policy collapsed at ${width}px: ${JSON.stringify(metrics)}`
      );
    }
    // subtitles no longer yield to the composer: the strip owns its row and
    // the panel floats above it (D18)
    if (metrics.subtitleDisplay === 'none') {
      throw new Error(
        `Session subtitle hidden at ${width}px: ${JSON.stringify(metrics)}`
      );
    }
    results.push({ width, metrics });
  }

  // ── Turn-state legibility (D22): spinning / finished / unstarted must
  // each render distinctly, and a fresh agent tab stays glyph-only.
  await page.setViewportSize({ width: 1312, height: 700 });
  const strip = page.locator('[data-workspace-tab-strip]');
  const settle = () =>
    page.evaluate(
      () =>
        new Promise(resolve =>
          requestAnimationFrame(() => requestAnimationFrame(resolve))
        )
    );
  const stripState = async () =>
    strip.evaluate(element => ({
      done: element.querySelectorAll('[data-status="done"]').length,
      fresh: element.querySelectorAll('[data-status="fresh"]').length,
      working: element.querySelectorAll('[data-status="working"]').length,
      text: element.innerText,
    }));
  let turnState = await stripState();
  // fresh = the unstarted agent + the ⌘T draft chip (D24)
  if (turnState.done !== 2 || turnState.fresh !== 2) {
    throw new Error(
      `Rest state wrong — expected 2 done + 2 fresh: ${JSON.stringify(turnState)}`
    );
  }
  if (turnState.text.includes('Claude Code')) {
    throw new Error(
      `Fresh tab leaked its default harness title: ${turnState.text}`
    );
  }
  await page.screenshot({
    path: join(SCREENSHOT_DIR, 'turn-states-rest.png'),
  });
  // the fresh agent starts streaming → its ring becomes the spinner
  await page.evaluate(() => {
    window.__fireActivity?.({ id: 'fresh-session', working: true });
  });
  await settle();
  turnState = await stripState();
  if (turnState.working !== 1 || turnState.fresh !== 1) {
    throw new Error(
      `Working state did not take over the fresh tab: ${JSON.stringify(turnState)}`
    );
  }
  await page.screenshot({
    path: join(SCREENSHOT_DIR, 'turn-states-working.png'),
  });
  // it goes quiet again without ever being engaged → back to fresh
  await page.evaluate(() => {
    window.__fireActivity?.({ id: 'fresh-session', working: false });
  });
  await settle();
  turnState = await stripState();
  if (turnState.fresh !== 2) {
    throw new Error(
      `Quiet unstarted session must return to fresh: ${JSON.stringify(turnState)}`
    );
  }
  // first work given (pty:engaged) → it rests as done from now on
  await page.evaluate(() => {
    window.__fireEngaged?.({ id: 'fresh-session' });
  });
  await settle();
  turnState = await stripState();
  if (turnState.done !== 3 || turnState.fresh !== 1) {
    throw new Error(
      `Engaged session must rest as done: ${JSON.stringify(turnState)}`
    );
  }

  // ── Close grammar (D24, chrome model): every ⌘W CLOSES. Started live
  // agents get one native confirm (mocked here, calls recorded); fresh
  // tabs and drafts discard instantly; a stopped tab condenses at rest,
  // unfurls on hover, and closes straight to the ledger.
  const condensed = strip.locator('[data-condensed]');
  // 0. the persisted stopped tab renders as a condensed frozen chip
  // (folded = zero-size, so wait for attachment, not visibility)
  await condensed.waitFor({ state: 'attached' });
  await page.mouse.click(650, 400);
  await page.waitForTimeout(320); // let the 200ms fold transition finish
  await page.screenshot({ path: join(SCREENSHOT_DIR, 'stopped-condensed.png') });
  await page
    .locator('[data-project="gpagent"]')
    .getByRole('button', { name: 'Close billing migration' })
    .hover();
  await settle();
  await page.screenshot({ path: join(SCREENSHOT_DIR, 'stopped-unfurled.png') });
  // 1. keycap hints overlay without shifting layout (D24). Park the
  // pointer first — the hover from the unfurl step would hold the frozen
  // chip open and muddy the screenshot.
  await page.mouse.move(650, 400);
  await page.waitForTimeout(320);
  const tabWidthBefore = await page
    .locator('[data-tab-id]')
    .first()
    .evaluate(el => el.getBoundingClientRect().width);
  await page.keyboard.down('Meta');
  await page.waitForTimeout(200); // 120ms reveal + margin
  await page.locator('[data-tab-ordinal]').first().waitFor();
  const tabWidthDuring = await page
    .locator('[data-tab-id]')
    .first()
    .evaluate(el => el.getBoundingClientRect().width);
  await page.screenshot({ path: join(SCREENSHOT_DIR, 'keycap-overlay.png') });
  await page.keyboard.up('Meta');
  if (Math.abs(tabWidthBefore - tabWidthDuring) > 0.5) {
    throw new Error(
      `Keycap hints must not shift layout: ${tabWidthBefore} → ${tabWidthDuring}`
    );
  }
  // 2. right-click menus (D27): a tab offers its verbs, esc dismisses
  await page
    .locator('[data-project="gpagent"] [data-tab-id]')
    .first()
    .click({ button: 'right' });
  const stripMenu = page.locator('[data-strip-menu]');
  await stripMenu.waitFor();
  const menuText = await stripMenu.innerText();
  if (!menuText.includes('Rename') || !menuText.includes('Close')) {
    throw new Error(`tab context menu incomplete: ${menuText}`);
  }
  await page.screenshot({ path: join(SCREENSHOT_DIR, 'context-menu.png') });
  await page.keyboard.press('Escape');
  await stripMenu.waitFor({ state: 'detached' });
  // 3. a STARTED agent pops the in-app confirm: default-highlighted Close,
  // esc keeps it open the first time, ⏎ presses the default the second
  const gpaClose = page
    .locator('[data-project="gpagent"]')
    .getByRole('button', { name: 'Close Claude Code' });
  await gpaClose.click();
  const closeConfirm = page.locator('[data-close-confirm]');
  await closeConfirm.waitFor();
  const confirmText = await closeConfirm.innerText();
  if (
    !confirmText.includes('Recently closed') ||
    !confirmText.includes('14 days')
  ) {
    throw new Error(`confirm copy misses the recovery path: ${confirmText}`);
  }
  await page.screenshot({ path: join(SCREENSHOT_DIR, 'close-confirm.png') });
  await page.keyboard.press('Escape');
  await closeConfirm.waitFor({ state: 'detached' });
  await gpaClose.waitFor(); // still open — esc cancelled
  await gpaClose.click();
  await closeConfirm.waitFor();
  await page.keyboard.press('Enter');
  await closeConfirm.waitFor({ state: 'detached' });
  await gpaClose.waitFor({ state: 'detached' }); // optimistic: gone at once
  const toast = page.locator('[data-close-toast]');
  await toast.waitFor();
  const toastText = await toast.innerText();
  if (
    !toastText.includes('Recently closed') ||
    !toastText.includes('reopen')
  ) {
    throw new Error(`Close toast does not narrate the outcome: ${toastText}`);
  }
  await page.screenshot({ path: join(SCREENSHOT_DIR, 'close-toast.png') });
  // 4. ⌘T ⌘W is a friction-free no-op: the draft discards, no dialog
  const draftClose = page.getByRole('button', { name: 'Close New agent' });
  await draftClose.click();
  await draftClose.waitFor({ state: 'detached' });
  if (await closeConfirm.count()) {
    throw new Error('draft discard must never confirm');
  }
  // 5. back stack (D27): reselect the codex tab, then ⌘[ returns to the
  // previously active tab — tab switches are history stops now
  const codexTab = page
    .locator('[data-project="exawatt"] [data-tab-id]')
    .first();
  const freshTab = page
    .locator('[data-project="exawatt"] [data-tab-id]')
    .last();
  await codexTab.locator('button').first().click();
  await freshTab.locator('button').first().click();
  await page.keyboard.press('Meta+BracketLeft');
  await page.waitForFunction(() => {
    const active = document.querySelector(
      '[data-workspace-tab-strip] [data-tab-id][data-active]'
    );
    return !!active?.textContent?.includes('Updating tests');
  });
  await page.keyboard.press('Meta+BracketRight');
  await page.waitForFunction(() => {
    const tabs = document.querySelectorAll(
      '[data-project="exawatt"] [data-tab-id]'
    );
    return !!tabs[tabs.length - 1]?.hasAttribute('data-active');
  });
  // 6. cross-route back (D27 review): Settings → esc returns to the EXACT
  // tab, not just the workspace — the pending tab-select applies against
  // the freshly mounted layout
  await page
    .locator('[data-project="exawatt"] [data-tab-id]')
    .first()
    .locator('button')
    .first()
    .click(); // codex active again
  await page.keyboard.press('Meta+KeyK');
  await page.locator('[cmdk-root]').waitFor();
  await page.locator('[cmdk-input]').fill('settings');
  await page.getByText('Go to Settings').waitFor();
  // session rows outrank navigation in the list — arrow down to Settings
  for (let i = 0; i < 8; i += 1) {
    const selected = await page.evaluate(
      () =>
        document.querySelector('[cmdk-item][aria-selected="true"]')
          ?.textContent ?? ''
    );
    if (selected.includes('Go to Settings')) break;
    await page.keyboard.press('ArrowDown');
  }
  await page.keyboard.press('Enter');
  // SPA pushState: assert the location directly (waitForURL can hang on
  // same-document navigations here)
  await page.waitForFunction(() => window.location.pathname === '/settings');
  await page.locator('[data-workspace-chrome]').waitFor({ state: 'detached' });
  await page.keyboard.press('Escape');
  await page.waitForFunction(
    () => window.location.pathname.startsWith('/workspace')
  );
  await page.waitForFunction(() =>
    document
      .querySelector('[data-workspace-tab-strip] [data-tab-id][data-active]')
      ?.textContent?.includes('Updating tests')
  );

  await page.setViewportSize({ width: 800, height: 700 });
  // the strip clicks above click-away-collapsed the summoned composer —
  // reopen it for the permission-menu geometry checks
  if (!(await page.locator('[data-agent-composer]').count())) {
    await page.locator('[data-composer-toggle]').click();
    await page.locator('[data-agent-composer]').waitFor();
  }
  const permissionTrigger = page.getByLabel('Agent permissions');
  await permissionTrigger.focus();
  await page.keyboard.press('Space');
  const permissionMenu = page.getByRole('listbox');
  await permissionMenu.waitFor();
  const permissionMenuBounds = await permissionMenu.evaluate(element => {
    const rect = element.getBoundingClientRect();
    return {
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    };
  });
  const permissionMenuText = await permissionMenu.innerText();
  if (
    permissionMenuBounds.left < 0 ||
    permissionMenuBounds.right > permissionMenuBounds.viewportWidth ||
    permissionMenuBounds.top < 0 ||
    permissionMenuBounds.bottom > permissionMenuBounds.viewportHeight
  ) {
    throw new Error(
      `Permission menu exceeds the viewport: ${JSON.stringify(permissionMenuBounds)}`
    );
  }
  if (
    (await page.getByRole('option').count()) !== 3 ||
    !permissionMenuText.includes('Ask first') ||
    !permissionMenuText.includes('Keep harness protections on') ||
    !permissionMenuText.includes('Auto-review') ||
    !permissionMenuText.includes('Routine work proceeds') ||
    !permissionMenuText.includes('YOLO') ||
    !permissionMenuText.includes('No approvals or sandbox')
  ) {
    throw new Error(
      `Permission menu does not explain all policies: ${permissionMenuText}`
    );
  }
  await page.screenshot({
    path: join(SCREENSHOT_DIR, 'workspace-800x700-permissions.png'),
  });
  await page.keyboard.press('Escape');
  if (
    !(await permissionTrigger.evaluate(
      element => document.activeElement === element
    ))
  ) {
    throw new Error('Permission menu did not restore keyboard focus');
  }

  if (errors.length > 0) {
    throw new Error(`Renderer errors:\n${errors.join('\n')}`);
  }

  console.log(`PASS workspace chrome layout: ${JSON.stringify(results)}`);
  console.log(`Screenshots: ${SCREENSHOT_DIR}`);
} finally {
  await browser.close();
}
