#!/usr/bin/env node

import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { resolveQaBrowserLaunchOptions } from './lib/qa-browser.mjs';

const BASE = process.env.EXA_BASE || 'http://localhost:7000';
const SCREENSHOT_DIR =
  process.env.EXAWATT_CHROME_SCREENSHOTS ||
  '/tmp/exawatt-workspace-chrome-layout';

function session({
  id,
  harness,
  title,
  cwd,
  projectName,
  contextSummary,
  engaged = false,
  working = false,
}) {
  return {
    engaged,
    working,
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
  // A freshly launched agent — no task, no summary, never engaged. It keeps
  // fresh turn truth while visible identity falls back to "New agent".
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
        // a stopped Session restored from a previous run (D24/D42):
        // renders as a title-less chip with badge; identity via tooltip
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
          // D33: a persisted model preamble must be rejected during
          // hydration, not shown or allowed to imply this tab was started.
          contextSummary: "Based on my exploration, here's what I found:",
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

mkdirSync(SCREENSHOT_DIR, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  ...(await resolveQaBrowserLaunchOptions(chromium)),
});
const page = await browser.newPage({ viewport: { width: 1312, height: 700 } });
const errors = [];
// This geometry eval is intentionally unauthenticated. The admin feedback
// badge is outside its contract and Supabase correctly rejects that request;
// stub only that unrelated read so renderer-error capture stays meaningful.
await page.route('**/rest/v1/product_feedback**', route =>
  route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
);
page.on('pageerror', error => errors.push(String(error.message || error)));
page.on('console', message => {
  if (
    message.type() === 'error' &&
    !message.text().includes('eval() is not supported')
  ) {
    errors.push(
      `${message.text()}${message.location().url ? ` (${message.location().url})` : ''}`
    );
  }
});

await page.addInitScript(
  ({ sessions, layout }) => {
    const off = () => () => undefined;
    // A late eval step reloads while one session is already working. This
    // exercises D29's pty:list hydration path without weakening the initial
    // explicit-false fixtures used by the switcher parity assertions.
    const hydrateWorkingId = window.localStorage.getItem(
      'exawatt-eval-working-session'
    );
    const hydrateWorkingSession = sessions.find(
      session => session.id === hydrateWorkingId
    );
    if (hydrateWorkingSession) hydrateWorkingSession.working = true;
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
        restoreContext: async (_durableSessionId, summary) =>
          summary.startsWith('Based on my exploration') ? null : summary,
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
        onAttention: handler => {
          window.__fireAttention = handler;
          return () => undefined;
        },
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
  // Single-row ribbon (D45): the Project you are IN is the one drawn with
  // full tabs — there is no manual keep-expanded any more, so the stopped
  // lifecycle specimen lives in exawatt, the Project this sweep stands in.
  // ⌘T pops a REAL tab (D24): the New Agent button creates a draft tab
  // whose pane hosts the composer — geometry checks run against that pane
  const composerToggle = page.locator('[data-composer-toggle]');
  await composerToggle.waitFor();
  await composerToggle.click();
  const composer = page.locator('[data-agent-composer]');
  await composer.waitFor();
  if (
    !(await page.locator('[data-workspace-tab-strip]').innerText()).includes(
      'New agent'
    )
  ) {
    throw new Error('⌘T must create a visible draft tab in the strip');
  }

  const results = [];
  const viewports = [
    { width: 560, height: 400 },
    { width: 800, height: 600 },
    { width: 1024, height: 700 },
    { width: 1312, height: 700 },
    { width: 1400, height: 900 },
    { width: 1600, height: 900 },
  ];
  for (const { width, height } of viewports) {
    await page.setViewportSize({ width, height });
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
      const modelElement = document.querySelector('[aria-label="Agent model"]');
      const effortElement = document.querySelector(
        '[aria-label="Agent effort"]'
      );
      const permissionElement = document.querySelector(
        '[aria-label="Agent permissions"]'
      );
      const optionsElement = document.querySelector(
        '[aria-label="Agent launch options"]'
      );
      if (
        !(chromeElement instanceof HTMLElement) ||
        !(panelElement instanceof HTMLElement) ||
        !(taskElement instanceof HTMLTextAreaElement) ||
        !(sourceElement instanceof HTMLElement) ||
        !(modelElement instanceof HTMLElement) ||
        !(effortElement instanceof HTMLElement) ||
        !(permissionElement instanceof HTMLElement) ||
        !(optionsElement instanceof HTMLElement)
      ) {
        throw new Error('Workspace chrome fixture did not render');
      }
      const chromeRect = chromeElement.getBoundingClientRect();
      const panelRect = panelElement.getBoundingClientRect();
      const taskRect = taskElement.getBoundingClientRect();
      const subtitleElement = document.querySelector('[data-subtitle]');
      const readFontSize = selector => {
        const element = document.querySelector(selector);
        if (!(element instanceof HTMLElement)) {
          throw new Error(`Missing chrome type fixture: ${selector}`);
        }
        return Number.parseFloat(getComputedStyle(element).fontSize);
      };
      return {
        chrome: {
          left: chromeRect.left,
          right: chromeRect.right,
          width: chromeRect.width,
          height: chromeRect.height,
          scrollWidth: chromeElement.scrollWidth,
        },
        ribbon: {
          rows: Number(
            document
              .querySelector('[data-workspace-tab-strip]')
              ?.getAttribute('data-ribbon-rows') ?? 0
          ),
          hidden: Number(
            document
              .querySelector('[data-workspace-tab-strip]')
              ?.getAttribute('data-ribbon-hidden') ?? 0
          ),
        },
        panel: {
          left: panelRect.left,
          right: panelRect.right,
          width: panelRect.width,
          viewportWidth: window.innerWidth,
        },
        sourceWidth: sourceElement.getBoundingClientRect().width,
        modelWidth: modelElement.getBoundingClientRect().width,
        effortWidth: effortElement.getBoundingClientRect().width,
        permissionWidth: permissionElement.getBoundingClientRect().width,
        options: {
          left: optionsElement.getBoundingClientRect().left,
          right: optionsElement.getBoundingClientRect().right,
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
        fontSizes: {
          brand: readFontSize('[data-chrome-brand]'),
          altitude: readFontSize('[data-command-altitude-level="terminal"]'),
          project: readFontSize('[data-project-chrome]'),
          tab: readFontSize('[data-tab-chrome]'),
          subtitle: readFontSize('[data-subtitle]'),
          path: readFontSize('[data-active-session-path]'),
          lifecycle: readFontSize('[aria-label="Stopped"]'),
          footer: readFontSize('[data-key-hints]'),
        },
      };
    });

    await page.screenshot({
      path: join(SCREENSHOT_DIR, `workspace-${width}x${height}.png`),
    });

    if (metrics.chrome.scrollWidth > metrics.chrome.width + 1) {
      throw new Error(
        `Workspace chrome overflows at ${width}px: ${JSON.stringify(metrics)}`
      );
    }
    if (metrics.chrome.height > 82 || metrics.ribbon.rows > 2) {
      throw new Error(
        `Elastic ribbon exceeded its two-row chrome budget at ${width}px: ${JSON.stringify(metrics)}`
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
    if (metrics.sourceWidth < 135) {
      throw new Error(
        `Agent Source collapsed at ${width}px: ${JSON.stringify(metrics)}`
      );
    }
    if (metrics.modelWidth < (width === 560 ? 151 : 167)) {
      throw new Error(
        `Agent model collapsed at ${width}px: ${JSON.stringify(metrics)}`
      );
    }
    if (metrics.effortWidth < (width === 560 ? 95 : 111)) {
      throw new Error(
        `Agent effort collapsed at ${width}px: ${JSON.stringify(metrics)}`
      );
    }
    if (metrics.permissionWidth < 79) {
      throw new Error(
        `Agent permission policy collapsed at ${width}px: ${JSON.stringify(metrics)}`
      );
    }
    if (
      metrics.options.left < metrics.panel.left - 1 ||
      metrics.options.right > metrics.panel.right + 1
    ) {
      throw new Error(
        `Agent launch options are clipped at ${width}px: ${JSON.stringify(metrics)}`
      );
    }
    // subtitles no longer yield to the composer: the strip owns its row and
    // the panel floats above it (D18)
    if (metrics.subtitleDisplay === 'none') {
      throw new Error(
        `Session subtitle hidden at ${width}px: ${JSON.stringify(metrics)}`
      );
    }
    const minimumFontSizes = {
      brand: 13,
      altitude: 12,
      project: 12,
      tab: 13,
      subtitle: 12,
      path: 12,
      lifecycle: 11,
      footer: 11,
    };
    for (const [role, minimum] of Object.entries(minimumFontSizes)) {
      if (metrics.fontSizes[role] < minimum) {
        throw new Error(
          `Chrome ${role} text fell below ${minimum}px at ${width}x${height}: ${JSON.stringify(metrics.fontSizes)}`
        );
      }
    }
    results.push({ width, height, metrics });
  }

  // ── Turn-state legibility: spinning / finished / unstarted render
  // distinctly, and even the unstarted Agent retains a visible title.
  // Turn-state parity needs every individual status trigger mounted. The
  // production readability floor intentionally folds inactive Projects at
  // ordinary widths, so run this semantic sweep in a wide viewport; density
  // and folded-summary truth are covered by the ribbon evals.
  await page.setViewportSize({ width: 2400, height: 700 });
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
  const freshTabCopy = await page
    .locator('[data-tab-id="fresh-tab"] [data-tab-chrome]')
    .innerText();
  if (!freshTabCopy.includes('New agent')) {
    throw new Error(
      `Fresh tab collapsed to icons instead of New agent: ${freshTabCopy}`
    );
  }
  if (turnState.text.includes('Based on my exploration')) {
    throw new Error(`Rejected persisted subtitle leaked: ${turnState.text}`);
  }
  await page.screenshot({
    path: join(SCREENSHOT_DIR, 'turn-states-rest.png'),
  });
  // D33/D40: explicit input attention is a quiet needs-you marker. Ordinary
  // turn completion is a Result light and must not enter the ⌘J queue. The
  // needs-you marker must explain itself on
  // hover, carry no alarm animation, and disappear before the selected tab
  // can paint — never flash bell → working → done during one click.
  await page.evaluate(() => {
    window.__fireAttention?.({
      id: 'gpa-session',
      attention: { kind: 'bell', since: Date.now() },
    });
  });
  const gpaTab = page.locator(
    '[data-project-parent="/tmp/gpagent"][data-tab-id="gpa-tab"]'
  );
  const attentionMarker = gpaTab.locator('[data-attention]');
  await attentionMarker.waitFor();
  if (
    (await attentionMarker.locator('.animate-ping, .lucide-bell').count()) > 0
  ) {
    throw new Error('Attention marker must be static and bell-free');
  }
  await attentionMarker.hover();
  const statusTooltip = page.getByRole('tooltip');
  await statusTooltip.waitFor();
  if (
    !(await statusTooltip.innerText()).includes(
      'Needs you — Agent requested input or hit a roadmap block. Open this Session to respond.'
    )
  ) {
    throw new Error(
      `Attention tooltip is unclear: ${await statusTooltip.innerText()}`
    );
  }
  await page.screenshot({
    path: join(SCREENSHOT_DIR, 'attention-tooltip.png'),
  });
  await page.mouse.move(650, 400);
  await page.evaluate(() => {
    window.__activeAttentionPaints = 0;
    window.__sampleActiveAttention = true;
    const sample = () => {
      const active = document.querySelector(
        '[data-workspace-tab-strip] [data-tab-id][data-active]'
      );
      if (active?.querySelector('[data-attention]')) {
        window.__activeAttentionPaints += 1;
      }
      if (window.__sampleActiveAttention) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await gpaTab.locator('button').first().click();
  await settle();
  const activeAttentionPaints = await page.evaluate(() => {
    window.__sampleActiveAttention = false;
    return window.__activeAttentionPaints;
  });
  if (activeAttentionPaints !== 0 || (await attentionMarker.count()) !== 0) {
    throw new Error(
      `Selecting a tab painted stale attention ${activeAttentionPaints} time(s)`
    );
  }
  // Return to the original fixture state for the remaining parity checks.
  await page
    .locator('[data-project-parent="/tmp/exawatt"][data-tab-id="exawatt-tab"]')
    .locator('button')
    .first()
    .click();
  await settle();
  // D29: the empty-query switcher consumes the same turn-state truth and
  // renders the same glyph vocabulary as the strip and Sessions tiles.
  await page.keyboard.press('Meta+KeyK');
  const palette = page.locator('[cmdk-root]');
  await palette.waitFor();
  const expectedSwitcherStates = {
    'gpa-session': 'done',
    'exawatt-session': 'done',
    'fresh-session': 'fresh',
  };
  await page.waitForFunction(expected => {
    const rows = Array.from(document.querySelectorAll('[data-session-id]'));
    return Object.entries(expected).every(([id, status]) =>
      rows.some(
        row =>
          row.getAttribute('data-session-id') === id &&
          row
            .querySelector('[data-session-status]')
            ?.getAttribute('data-session-status') === status
      )
    );
  }, expectedSwitcherStates);
  const switcherStates = await palette
    .locator('[data-session-id]')
    .evaluateAll(rows =>
      Object.fromEntries(
        rows.map(row => [
          row.getAttribute('data-session-id'),
          row
            .querySelector('[data-session-status]')
            ?.getAttribute('data-session-status'),
        ])
      )
    );
  if (
    Object.entries(expectedSwitcherStates).some(
      ([id, status]) => switcherStates[id] !== status
    )
  ) {
    throw new Error(
      `Switcher turn-state parity failed: ${JSON.stringify(switcherStates)}`
    );
  }
  await page.screenshot({
    path: join(SCREENSHOT_DIR, 'switcher-turn-states.png'),
  });
  await page.keyboard.press('Escape');
  await palette.waitFor({ state: 'detached' });
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
  // tabs and drafts discard instantly. A stopped tab drops its inline
  // title entirely (D42 review round, amends the D23 hover-unfurl —
  // reveals must not shift layout or feed the width model); its badge,
  // close affordance, aria-label, and tooltip identity remain.
  const frozen = page.locator(
    '[data-project-parent="/tmp/exawatt"][data-tab-id="frozen-tab"]'
  );
  await frozen.waitFor({ state: 'attached' });
  await page.mouse.click(650, 400);
  await page.waitForTimeout(320);
  const frozenShape = await frozen.evaluate(node => ({
    text: node.textContent ?? '',
    badge: !!node.querySelector('[aria-label="Stopped"]'),
    close: !!node.querySelector('button[title^="Close — kept"]'),
  }));
  if (
    frozenShape.text.includes('billing migration') ||
    !frozenShape.badge ||
    !frozenShape.close
  ) {
    throw new Error(
      `Stopped chip must be title-less with badge and close: ${JSON.stringify(frozenShape)}`
    );
  }
  await page.screenshot({
    path: join(SCREENSHOT_DIR, 'stopped-condensed.png'),
  });
  // 1. keycap hints overlay without shifting layout (D24). Park the
  // pointer away from the strip first.
  await page.mouse.move(650, 400);
  await page.waitForTimeout(320);
  const tabWidthBefore = await page
    .locator('[data-tab-id]')
    .first()
    .evaluate(el => el.getBoundingClientRect().width);
  await page.keyboard.down('Meta');
  await page.waitForTimeout(200); // 120ms reveal + margin
  await page.locator('[data-tab-ordinal]').first().waitFor();
  const ordinalFontSize = await page
    .locator('[data-tab-ordinal]')
    .first()
    .evaluate(element =>
      Number.parseFloat(getComputedStyle(element.firstElementChild).fontSize)
    );
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
  if (ordinalFontSize !== 10) {
    throw new Error(
      `Shortcut ordinals alone should use the 10px micro role: ${ordinalFontSize}px`
    );
  }
  // 2. right-click menus (D27): a tab offers its verbs, esc dismisses
  await page
    .locator('[data-project-parent="/tmp/gpagent"][data-tab-id]')
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
  // esc keeps it open the first time, ⏎ presses the default the second.
  // A close button only exists on the Project you are in (D45), so stand
  // in gpagent to reach its started Agent.
  await page.locator('[data-project="gpagent"] [data-project-chrome]').click();
  await page.waitForTimeout(320);
  const gpaClose = page
    .locator('[data-project-parent="/tmp/gpagent"][data-tab-id="gpa-tab"]')
    .getByRole('button', {
      name: 'Close Testing UTC date parsing fix and seeding demo org',
    });
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
    (!toastText.includes('Recently closed') &&
      !toastText.includes('kept for 14 days')) ||
    !toastText.includes('reopen')
  ) {
    throw new Error(`Close toast does not narrate the outcome: ${toastText}`);
  }
  await page.screenshot({ path: join(SCREENSHOT_DIR, 'close-toast.png') });
  // 4. ⌘T ⌘W is a friction-free no-op: the draft discards, no dialog.
  // The draft lives in exawatt; stand back in it to reach its affordance.
  await page.locator('[data-project="exawatt"] [data-project-chrome]').click();
  await page.waitForTimeout(320);
  const draftClose = page.getByTitle('Discard (⌘W)');
  await draftClose.click();
  await draftClose.waitFor({ state: 'detached' });
  if (await closeConfirm.count()) {
    throw new Error('draft discard must never confirm');
  }
  // 5. back stack (D27): reselect the codex tab, then ⌘[ returns to the
  // previously active tab — tab switches are history stops now
  const codexTab = page
    .locator('[data-project-parent="/tmp/exawatt"][data-tab-id]')
    .first();
  const freshTab = page
    .locator('[data-project-parent="/tmp/exawatt"][data-tab-id]')
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
      '[data-project-parent="/tmp/exawatt"][data-tab-id]'
    );
    return !!tabs[tabs.length - 1]?.hasAttribute('data-active');
  });
  // 6. cross-route back (D27 review): Settings → esc returns to the EXACT
  // tab, not just the workspace — the pending tab-select applies against
  // the freshly mounted layout
  await page
    .locator('[data-project-parent="/tmp/exawatt"][data-tab-id]')
    .first()
    .locator('button')
    .first()
    .click(); // codex active again
  await page.keyboard.press('Meta+KeyK');
  await page.locator('[cmdk-root]').waitFor();
  await page.locator('[cmdk-input]').fill('settings');
  await page.getByText('Go to Settings').waitFor();
  // session rows outrank navigation in the list — arrow down to Settings
  const settingsWalkBudget = (await page.locator('[cmdk-item]').count()) + 1;
  let selectedSettings = false;
  for (let i = 0; i < settingsWalkBudget; i += 1) {
    const selected = await page.evaluate(
      () =>
        document.querySelector('[cmdk-item][aria-selected="true"]')
          ?.textContent ?? ''
    );
    if (selected.includes('Go to Settings')) {
      selectedSettings = true;
      break;
    }
    await page.keyboard.press('ArrowDown');
  }
  if (!selectedSettings) {
    throw new Error('Keyboard walk never selected Go to Settings');
  }
  await page.keyboard.press('Enter');
  // SPA pushState: assert the location directly (waitForURL can hang on
  // same-document navigations here)
  await page.waitForFunction(() => window.location.pathname === '/settings');
  await page.locator('[data-workspace-chrome]').waitFor({ state: 'detached' });
  // Escape returns to the workspace (D27). Settings' esc listener attaches
  // in a mount effect — wait for the settings chrome to be interactive, and
  // retry the press so a slow hydration cannot race the keydown.
  await page.locator('aside').waitFor();
  let escapedToWorkspace = false;
  for (let attempt = 0; attempt < 5 && !escapedToWorkspace; attempt += 1) {
    await page.keyboard.press('Escape');
    escapedToWorkspace = await page
      .waitForFunction(
        () => window.location.pathname.startsWith('/workspace'),
        undefined,
        { timeout: 2000 }
      )
      .then(() => true)
      .catch(() => false);
  }
  if (!escapedToWorkspace) {
    throw new Error('escape-from-settings did not return to /workspace');
  }
  await page.waitForFunction(() =>
    document
      .querySelector('[data-workspace-tab-strip] [data-tab-id][data-active]')
      ?.textContent?.includes('Updating tests')
  );

  // ── Move tab verbs: the ⌘K row and the ⌘⌥[/⌘⌥] fixed family drive the
  // same pure move (D20 chords surfaced as palette/menu verbs) ──
  const exawattTabOrder = () =>
    page.evaluate(() =>
      Array.from(
        document.querySelectorAll(
          '[data-project-parent="/tmp/exawatt"][data-tab-id]'
        )
      )
        .map(node => ({
          id: node.getAttribute('data-tab-id'),
          x: node.getBoundingClientRect().x,
          y: node.getBoundingClientRect().y,
        }))
        .sort((a, b) => (Math.abs(a.y - b.y) > 8 ? a.y - b.y : a.x - b.x))
        .map(entry => entry.id)
    );
  const orderBeforeMove = await exawattTabOrder();
  if (orderBeforeMove[0] !== 'exawatt-tab') {
    throw new Error(
      `Move-tab fixture expectation drifted: ${JSON.stringify(orderBeforeMove)}`
    );
  }
  await page.keyboard.press('Meta+KeyK');
  await page.locator('[cmdk-root]').waitFor();
  await page.locator('[cmdk-input]').fill('move tab right');
  await page.getByText('Move tab right').waitFor();
  for (let i = 0; i < 8; i += 1) {
    const selected = await page.evaluate(
      () =>
        document.querySelector('[cmdk-item][aria-selected="true"]')
          ?.textContent ?? ''
    );
    if (selected.includes('Move tab right')) break;
    await page.keyboard.press('ArrowDown');
  }
  await page.keyboard.press('Enter');
  await page.locator('[cmdk-root]').waitFor({ state: 'detached' });
  await page.waitForTimeout(350);
  const orderAfterPalette = await exawattTabOrder();
  if (
    orderAfterPalette[0] !== orderBeforeMove[1] ||
    orderAfterPalette[1] !== orderBeforeMove[0]
  ) {
    throw new Error(
      `Palette Move tab right did not reorder: ${JSON.stringify({ orderBeforeMove, orderAfterPalette })}`
    );
  }
  // the fixed chord moves it back — palette and chord are one verb
  await page.keyboard.press('Meta+Alt+BracketLeft');
  await page.waitForTimeout(350);
  const orderAfterChord = await exawattTabOrder();
  if (orderAfterChord.join() !== orderBeforeMove.join()) {
    throw new Error(
      `⌘⌥[ did not restore the order: ${JSON.stringify({ orderBeforeMove, orderAfterChord })}`
    );
  }

  // ── Move Project verbs: the new ⌘K rows and the existing ⌘⌥⇧ chord now
  // share the same event/action seam, just like the tab arrangement family. ──
  const projectOrder = () =>
    page.evaluate(() =>
      Array.from(
        document.querySelectorAll('[data-ribbon-item="project"]')
      ).map(node => node.getAttribute('data-project-dir'))
    );
  const projectOrderBeforeMove = await projectOrder();
  if (projectOrderBeforeMove[1] !== '/tmp/exawatt') {
    throw new Error(
      `Move-Project fixture expectation drifted: ${JSON.stringify(projectOrderBeforeMove)}`
    );
  }
  await page.keyboard.press('Meta+KeyK');
  await page.locator('[cmdk-root]').waitFor();
  await page.locator('[cmdk-input]').fill('move project right');
  await page.getByText('Move Project right').waitFor();
  for (let i = 0; i < 8; i += 1) {
    const selected = await page.evaluate(
      () =>
        document.querySelector('[cmdk-item][aria-selected="true"]')
          ?.textContent ?? ''
    );
    if (selected.includes('Move Project right')) break;
    await page.keyboard.press('ArrowDown');
  }
  await page.keyboard.press('Enter');
  await page.locator('[cmdk-root]').waitFor({ state: 'detached' });
  await page.waitForTimeout(350);
  const projectOrderAfterPalette = await projectOrder();
  if (
    projectOrderAfterPalette[1] !== projectOrderBeforeMove[2] ||
    projectOrderAfterPalette[2] !== projectOrderBeforeMove[1]
  ) {
    throw new Error(
      `Palette Move Project right did not reorder: ${JSON.stringify({ projectOrderBeforeMove, projectOrderAfterPalette })}`
    );
  }
  const projectMoveStatus = await page
    .locator('[role="status"]', { hasText: 'Moved Project' })
    .last()
    .textContent();
  if (!projectMoveStatus?.includes('position 3 of 3')) {
    throw new Error(
      `Project reorder status was not announced: ${JSON.stringify(projectMoveStatus)}`
    );
  }

  // Movement stops at edges: the impossible direction stays visible for
  // learning, but is disabled with a concrete reason and cannot close/no-op.
  await page.keyboard.press('Meta+KeyK');
  await page.locator('[cmdk-root]').waitFor();
  await page.locator('[cmdk-input]').fill('move project right');
  const rightEdgeRow = page
    .locator('[cmdk-item]', { hasText: 'Move Project right' })
    .first();
  await rightEdgeRow.waitFor();
  if ((await rightEdgeRow.getAttribute('data-disabled')) !== 'true') {
    throw new Error('Move Project right stayed enabled at the right edge');
  }
  if (
    !(await rightEdgeRow.textContent())?.includes(
      'Already the last open Project'
    )
  ) {
    throw new Error('Move Project right did not explain its edge constraint');
  }
  await page.keyboard.press('Escape');
  await page.locator('[cmdk-root]').waitFor({ state: 'detached' });

  await page.keyboard.press('Meta+Alt+Shift+BracketLeft');
  await page.waitForTimeout(350);
  const projectOrderAfterChord = await projectOrder();
  if (projectOrderAfterChord.join() !== projectOrderBeforeMove.join()) {
    throw new Error(
      `⌘⌥⇧[ did not restore Project order: ${JSON.stringify({ projectOrderBeforeMove, projectOrderAfterChord })}`
    );
  }

  // The help modal is the exhaustive face of both the registry and manifest.
  await page.setViewportSize({ width: 1312, height: 1000 });
  await page.keyboard.press('Meta+Slash');
  const shortcutDialog = page.getByRole('dialog');
  await shortcutDialog.waitFor();
  for (const label of [
    'Move focus between the Session and app controls',
    'Jump to Session 1–8, or 9 for the last Session',
    'Return focus to the Session',
  ]) {
    await shortcutDialog.getByText(label).waitFor();
  }
  await shortcutDialog
    .getByText('Return focus to the Session')
    .scrollIntoViewIfNeeded();
  await page.screenshot({
    path: join(SCREENSHOT_DIR, 'shortcut-help-all-families.png'),
  });
  await page.keyboard.press('Escape');
  await shortcutDialog.waitFor({ state: 'detached' });

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

  // D29 hydration parity: activity already true before the renderer mounts
  // must seed the strip from pty:list; main will not repeat the transition.
  await page.evaluate(() =>
    window.localStorage.setItem('exawatt-eval-working-session', 'fresh-session')
  );
  await page.reload({ waitUntil: 'networkidle' });
  const hydratedWorkingTab = page.locator(
    '[data-project-parent="/tmp/exawatt"][data-tab-id="fresh-tab"] [data-status="working"]'
  );
  await hydratedWorkingTab.waitFor();
  await page.screenshot({
    path: join(SCREENSHOT_DIR, 'turn-state-hydrated-working.png'),
  });

  // E1.1 Sessions comparison projection: default Agents always keep visible
  // identity, operational copy uses the readable sans tier, and raw terminal
  // buffers never become card content.
  await page.setViewportSize({ width: 1312, height: 800 });
  await page.locator('[data-command-altitude-level="sessions"]').click();
  await page.locator('[data-expose]').waitFor();
  await page.waitForTimeout(650); // entrance stagger + opacity transition
  const freshSessionTile = page.locator('[data-expose-tab="fresh-tab"]');
  const contextSessionTile = page.locator('[data-expose-tab="exawatt-tab"]');
  await freshSessionTile.waitFor();
  const freshSessionText = await freshSessionTile.innerText();
  const contextSessionText = await contextSessionTile.innerText();
  if (!freshSessionText.includes('New agent')) {
    throw new Error(`Sessions lost the fallback title: ${freshSessionText}`);
  }
  if (!contextSessionText.includes('Updating tests for harness command')) {
    throw new Error(
      `Sessions lost durable context identity: ${contextSessionText}`
    );
  }
  if (
    freshSessionText.includes('Workspace chrome ready') ||
    contextSessionText.includes('$ exawatt')
  ) {
    throw new Error(
      `Sessions leaked terminal buffer content: ${freshSessionText} | ${contextSessionText}`
    );
  }
  const sessionsType = await contextSessionTile.evaluate(element => {
    const title = element.querySelector('[data-session-goal-summary]');
    const current = element.querySelector('[data-session-current]');
    const next = element.querySelector('[data-session-next-copy]');
    if (
      !(title instanceof HTMLElement) ||
      !(current instanceof HTMLElement) ||
      !(next instanceof HTMLElement)
    ) {
      throw new Error('Sessions type fixtures are missing');
    }
    const read = node => {
      const style = getComputedStyle(node);
      return {
        family: style.fontFamily,
        size: Number.parseFloat(style.fontSize),
        lineHeight: Number.parseFloat(style.lineHeight),
      };
    };
    return { title: read(title), current: read(current), next: read(next) };
  });
  if (
    sessionsType.title.size < 16 ||
    sessionsType.current.size < 15 ||
    sessionsType.next.size < 14 ||
    sessionsType.current.lineHeight < 24 ||
    /mono/i.test(sessionsType.current.family)
  ) {
    throw new Error(
      `Sessions readable type contract regressed: ${JSON.stringify(sessionsType)}`
    );
  }
  await page.screenshot({
    path: join(SCREENSHOT_DIR, 'sessions-readable-cards.png'),
  });
  await page.locator('[data-command-altitude-level="terminal"]').click();
  await page.locator('[data-workspace-chrome]').waitFor();

  // The stopped pane must not impersonate an interactive terminal. Its action
  // is scoped to this Agent and retained output is explicitly read-only. Keep
  // this navigation last so it cannot perturb the back-stack assertions above.
  // At the readable floor an inactive Project may be folded, so disclose the
  // fixture's owning Project before addressing its stopped tab directly.
  await page.getByRole('button', { name: 'exawatt', exact: true }).click();
  await page.locator('[data-tab-id="frozen-tab"]').click();
  const stoppedPane = page.locator('[data-session-restore="frozen-tab"]');
  await stoppedPane.waitFor();
  await stoppedPane
    .getByRole('button', { name: 'Resume This Agent' })
    .waitFor();
  await page.getByText('Saved terminal history · read-only').waitFor();
  await page.screenshot({
    path: join(SCREENSHOT_DIR, 'stopped-pane-read-only.png'),
  });

  if (errors.length > 0) {
    throw new Error(`Renderer errors:\n${errors.join('\n')}`);
  }

  console.log(`PASS workspace chrome layout: ${JSON.stringify(results)}`);
  console.log(`Screenshots: ${SCREENSHOT_DIR}`);
} finally {
  await browser.close();
}
