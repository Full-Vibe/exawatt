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

function session({ id, harness, title, cwd, projectName, contextSummary }) {
  return {
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
    harnessSessionId: null,
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
  }),
  session({
    id: 'exawatt-session',
    harness: 'codex',
    title: 'Codex',
    cwd: '/tmp/exawatt',
    projectName: 'exawatt',
    contextSummary: 'Updating tests for harness command permission flags',
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
        pasteClipboard: async () => ({ ok: true }),
        copyText: async () => undefined,
        openExternal: async () => undefined,
        openPath: async () => undefined,
        listResumeCandidates: async () => [],
        createWorktree: async () => ({ ok: true, path: '/tmp/worktree' }),
        onData: off,
        onExit: off,
        onContext: off,
        onRecap: off,
        onAttention: off,
        onIdentity: off,
        onNotificationClick: off,
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
  // D18: the composer is summoned, not permanent — expand it for the panel
  // geometry checks below
  const composerToggle = page.locator('[data-composer-toggle]');
  await composerToggle.waitFor();
  await composerToggle.click();
  const composer = page.locator('[data-agent-composer]');
  await composer.waitFor();

  const results = [];
  for (const width of [800, 1024, 1312, 1400, 1600]) {
    await page.setViewportSize({ width, height: 700 });
    await page.evaluate(
      () =>
        new Promise(resolve =>
          requestAnimationFrame(() => requestAnimationFrame(resolve))
        )
    );

    const metrics = await page.evaluate(() => {
      const chromeElement = document.querySelector('[data-workspace-chrome]');
      const panelElement = document.querySelector(
        '[data-agent-composer-panel]'
      );
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

  await page.setViewportSize({ width: 800, height: 700 });
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
