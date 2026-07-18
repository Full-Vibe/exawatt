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
  const composer = page.locator('[data-agent-composer]');
  await chrome.waitFor();
  await composer.waitFor();
  await page.locator('[data-project="cortex-ehr"]').waitFor();

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
      const composerElement = document.querySelector('[data-agent-composer]');
      const taskElement = document.querySelector(
        '[aria-label="Initial task for the new Agent"]'
      );
      if (
        !(chromeElement instanceof HTMLElement) ||
        !(composerElement instanceof HTMLElement) ||
        !(taskElement instanceof HTMLTextAreaElement)
      ) {
        throw new Error('Workspace chrome fixture did not render');
      }
      const chromeRect = chromeElement.getBoundingClientRect();
      const composerRect = composerElement.getBoundingClientRect();
      const taskRect = taskElement.getBoundingClientRect();
      const subtitleElement = document.querySelector('[data-subtitle]');
      return {
        chrome: {
          left: chromeRect.left,
          right: chromeRect.right,
          width: chromeRect.width,
          scrollWidth: chromeElement.scrollWidth,
        },
        composer: {
          left: composerRect.left,
          right: composerRect.right,
          width: composerRect.width,
          controls: Array.from(composerElement.children).map(element => {
            const rect = element.getBoundingClientRect();
            return {
              label: element.getAttribute('aria-label') || element.tagName,
              width: rect.width,
            };
          }),
        },
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
      metrics.composer.left < metrics.chrome.left ||
      metrics.composer.right > metrics.chrome.right + 1
    ) {
      throw new Error(
        `Agent composer exceeds chrome at ${width}px: ${JSON.stringify(metrics)}`
      );
    }
    if (metrics.task.width < 240) {
      throw new Error(
        `Agent task field is too narrow at ${width}px: ${JSON.stringify(metrics)}`
      );
    }
    if (metrics.task.scrollHeight > metrics.task.clientHeight + 1) {
      throw new Error(
        `Agent task placeholder is clipped at ${width}px: ${JSON.stringify(metrics)}`
      );
    }
    const sourceWidth =
      metrics.composer.controls.find(
        control => control.label === 'Agent Source'
      )?.width ?? 0;
    if (sourceWidth < 147) {
      throw new Error(
        `Agent Source collapsed at ${width}px: ${JSON.stringify(metrics)}`
      );
    }
    const compact = width <= 1520;
    if (
      (compact && metrics.subtitleDisplay !== 'none') ||
      (!compact && metrics.subtitleDisplay === 'none')
    ) {
      throw new Error(
        `Session subtitle priority is wrong at ${width}px: ${JSON.stringify(metrics)}`
      );
    }
    results.push({ width, metrics });
  }

  if (errors.length > 0) {
    throw new Error(`Renderer errors:\n${errors.join('\n')}`);
  }

  console.log(`PASS workspace chrome layout: ${JSON.stringify(results)}`);
  console.log(`Screenshots: ${SCREENSHOT_DIR}`);
} finally {
  await browser.close();
}
