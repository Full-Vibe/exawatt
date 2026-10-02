#!/usr/bin/env node

import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  seedWorkspaceLayout,
  waitForPageCondition,
  withElectronApp,
} from './lib/electron-eval.mjs';
import { writeFakeHarness } from './lib/harness-probe-fixture.mjs';
import {
  evaluateFeedbackReporting,
  installFeedbackTransport,
} from './lib/feedback-reporting-eval.mjs';

const userData = mkdtempSync(join(tmpdir(), 'exawatt-context-eval-user-'));
const projectDir = mkdtempSync(join(tmpdir(), 'exawatt-context-eval-project-'));
const harnessDir = mkdtempSync(join(tmpdir(), 'exawatt-context-eval-harness-'));
const screenshotDir =
  process.env.CONTEXT_SCREENSHOT_DIR || '/tmp/exawatt-context-label-eval';
mkdirSync(screenshotDir, { recursive: true });

// The Help menu's feedback row, named by the verb manifest main builds the
// menu from. A community build carries no row at all, so reading the Help
// menu by position read the next item instead (BUG-216); the id cannot move.
const { getCommandVerb } = createRequire(import.meta.url)('@exawatt/core');
const feedbackVerb = getCommandVerb('submit-feedback').menu;

// Since agent-source truth fails closed (e21b4a2), a launchable fake harness
// must answer the readiness probes before falling through to the interactive
// echo loop the PTY scenes rely on; the shared fixture owns those answers.
for (const harness of ['codex', 'claude']) {
  writeFakeHarness(harnessDir, harness, {
    launch: [
      'printf "fake harness ready\\n"',
      'while IFS= read -r line; do printf "%s\\n" "$line"; done',
    ].join('\n'),
  });
}

// Two stopped Sessions with persisted labels, seeded before the app first
// runs. The eval used to write this layout through `workspace.save` into a
// LIVE renderer and reload; the renderer's own debounced save of the Sessions
// it had just launched could land after it, so the relaunch found a layout
// without either tab and timed out on the restored chip (BUG-216). While the
// app runs, the renderer is the layout's only writer.
const CORRECTED = 'Improve agent context summaries';
const fixtureTab = (id, task) => ({
  id: `tab-context-${id}`,
  durableSessionId: `persisted-context-${id}`,
  harness: 'codex',
  title: 'Codex',
  titleKind: 'default',
  cwd: projectDir,
  sessionId: null,
  harnessSessionId: `provider-context-${id}`,
  roadmapItemId: null,
  lifecycle: 'stopped-clean',
  exitCode: null,
  initialTask: task,
  contextSummary: task,
});
seedWorkspaceLayout(userData, {
  v: 6,
  lastUsedDir: projectDir,
  activeDir: projectDir,
  pinnedTabId: null,
  recentProjects: [],
  projects: [
    {
      dir: projectDir,
      name: 'Exawatt',
      color: '#F34A9D',
      activeTabId: 'tab-context-a',
      tabs: [
        fixtureTab('a', CORRECTED),
        fixtureTab('b', 'Fix auth redirect loop'),
      ],
    },
  ],
});
const requests = [];
const server = createServer(async (request, response) => {
  if (request.method !== 'POST') {
    response.writeHead(404).end();
    return;
  }
  let raw = '';
  for await (const chunk of request) raw += chunk;
  const body = JSON.parse(raw);
  requests.push(body);
  const latest = body.recentInstructions?.at(-1)?.text ?? '';
  if (/service failure/i.test(latest)) {
    response.writeHead(503, {
      'content-type': 'application/problem+json',
      'Exawatt-Service-Version': '1',
    });
    response.end(
      JSON.stringify({
        schemaVersion: 1,
        type: 'about:blank',
        title: 'Context service unavailable',
        status: 503,
        code: 'service_unavailable',
        detail: 'Simulated failure',
        retryable: true,
      })
    );
    return;
  }
  const result = /widget checkout/i.test(latest)
    ? {
        label: 'MVP of Widget Checkout',
        relationship: 'new_context',
        confidence: 0.96,
      }
    : /improve agent context/i.test(latest)
      ? {
          label: 'Improve agent context summaries',
          relationship: 'new_context',
          confidence: 0.98,
        }
      : /\[Attachment\]/.test(latest)
        ? {
            label: 'New agent',
            relationship: 'new_context',
            confidence: 0.4,
          }
        : {
            label: body.currentLabel || 'New agent',
            relationship: body.currentLabel ? 'same_context' : 'new_context',
            confidence: 0.9,
          };
  response.writeHead(200, {
    'content-type': 'application/json',
    'Exawatt-Service-Version': '1',
  });
  response.end(JSON.stringify({ schemaVersion: 1, ...result }));
});
await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});
const endpoint = `http://127.0.0.1:${server.address().port}/context-labels`;

const failures = [];
function check(name, condition) {
  console.log(`${condition ? 'PASS' : 'FAIL'} ${name}`);
  if (!condition) failures.push(name);
}

const launchOptions = {
  args: ['.'],
  cwd: process.cwd(),
  env: {
    ...process.env,
    NODE_ENV: 'development',
    EXAWATT_TEST: '1',
    EXAWATT_USER_DATA: userData,
    EXAWATT_TEST_HARNESS_BIN: harnessDir,
    // Poisoned legacy input on purpose. Community distribution must ignore it;
    // only the resolved contract returned below may enable the fake service.
    EXAWATT_CONTEXT_LABEL_ENDPOINT: endpoint,
    EXAWATT_DEV_URL: `${process.env.EXA_BASE ?? 'http://localhost:7000'}/workspace`,
  },
};

try {
  await withElectronApp(
    launchOptions,
    async (app, page) => {
      page.setDefaultTimeout(20_000);
      const pageErrors = [];
      page.on('pageerror', error => pageErrors.push(error.message));

      await page.locator('[data-workspace-stage]').waitFor();
      const contract = await page.evaluate(
        async () =>
          (await window.electron.app.getBuildInfo()).distribution.contract
      );
      const enrichment = contract.enrichment;
      const configuredContextEndpoint = enrichment.contextLabels?.url ?? null;
      const hostedLabelsConfigured = configuredContextEndpoint === endpoint;
      // Main-process context inference uses Node's transport, so a renderer
      // route cannot intercept it. Keep the exact renderer/main distribution
      // and use the product's privacy boundary in this throwaway profile:
      // only our loopback fixture may infer; real configured services stay off.
      const fixturePolicy = await page.evaluate(async useFixture => {
        const settings = window.electron.settings;
        await settings.setHostedContextLabels(useFixture);
        await settings.setGoalVisualsEnabled(false);
        await settings.setHostedConversationSummaries(false);
        await settings.setReentryRecap(false);
        return settings.get();
      }, hostedLabelsConfigured);
      check(
        'eval inference is confined to its loopback fixture through the real privacy policy',
        fixturePolicy.contextLabels?.hosted === hostedLabelsConfigured &&
          fixturePolicy.goalVisuals?.enabled === false &&
          fixturePolicy.conversationSummaries?.hosted === false &&
          fixturePolicy.reentryRecap?.enabled === false
      );
      console.log(
        hostedLabelsConfigured
          ? 'COVERAGE hosted context inference uses the loopback fixture'
          : 'COVERAGE context persistence and privacy-off behavior; hosted inference is not exercised'
      );
      const feedbackConfigured = contract.services.productFeedback !== null;
      const transport = await installFeedbackTransport(
        page,
        contract.services.productFeedback?.url ?? null
      );
      const feedbackPayloads = transport.payloads;
      const feedbackMenuItem = () =>
        app.evaluate(({ Menu }, id) => {
          const item = Menu.getApplicationMenu()?.getMenuItemById(id);
          return item ? { label: item.label, enabled: item.enabled } : null;
        }, feedbackVerb.commandId);
      const signedOutMenu = await feedbackMenuItem();
      check(
        feedbackConfigured
          ? 'signed-out Help menu names the sign-in requirement and is disabled'
          : 'community contract publishes no Help feedback item',
        feedbackConfigured
          ? signedOutMenu?.enabled === false &&
              signedOutMenu.label.includes('Sign in required')
          : signedOutMenu === null
      );

      await page.evaluate(() => {
        window.dispatchEvent(
          new CustomEvent('exawatt:test-feedback-auth', {
            detail: { accessToken: 'test-jwt' },
          })
        );
      });
      await page.waitForTimeout(100);
      const menuAfterTestAuth = await feedbackMenuItem();
      check(
        feedbackConfigured
          ? 'signed-in Help menu enables Submit Feedback'
          : 'community contract ignores the feedback test-auth bridge',
        feedbackConfigured
          ? menuAfterTestAuth?.enabled === true &&
              menuAfterTestAuth.label === feedbackVerb.label
          : menuAfterTestAuth === null
      );

      const first = await page.evaluate(async cwd => {
        const result = await window.electron.pty.create({
          harness: 'codex',
          cwd,
          durableSessionId: 'context-main-session',
          initialPrompt: 'Implement cmd+shift+t to reopen tabs',
        });
        if (!result.ok) throw new Error(result.error);
        return result.session;
      }, projectDir);
      await waitForPageCondition(
        page,
        async durableId =>
          (await window.electron.pty.list()).find(
            item => item.durableSessionId === durableId
          )?.contextSummary === 'Implement cmd+shift+t to reopen tabs',
        first.durableSessionId,
        { label: 'the launch label' }
      );

      const beforePassive = requests.length;
      await page.evaluate(
        ({ id }) =>
          window.electron.pty.write(id, 'passive provider output\n', false),
        { id: first.id }
      );
      await page.waitForTimeout(350);
      check(
        'PTY output does not trigger context inference',
        requests.length === beforePassive
      );

      await page.evaluate(
        ({ id }) =>
          window.electron.pty.write(
            id,
            'Improve agent context summaries\r',
            true
          ),
        { id: first.id }
      );
      if (hostedLabelsConfigured) {
        await waitForPageCondition(
          page,
          async durableId =>
            (await window.electron.pty.list()).find(
              item => item.durableSessionId === durableId
            )?.contextSummary === 'Improve agent context summaries',
          first.durableSessionId,
          { label: 'the hosted label "Improve agent context summaries"' }
        );
        check(
          'submitted pivot replaces the stale reopen-tabs label',
          requests.some(
            body =>
              body.currentLabel === 'Implement cmd+shift+t to reopen tabs' &&
              body.recentInstructions?.at(-1)?.text ===
                'Improve agent context summaries'
          )
        );

        await page.evaluate(
          ({ id }) =>
            window.electron.pty.write(
              id,
              'Simulate label service failure\r',
              true
            ),
          { id: first.id }
        );
        await page.waitForTimeout(250);
        const afterFailure = await page.evaluate(
          async durableId =>
            (await window.electron.pty.list()).find(
              item => item.durableSessionId === durableId
            )?.contextSummary,
          first.durableSessionId
        );
        check(
          'hosted failure retains the last good label',
          afterFailure === 'Improve agent context summaries'
        );

        await page.evaluate(
          ({ id }) =>
            window.electron.pty.write(
              id,
              'Return to the MVP of Widget Checkout\r',
              true
            ),
          { id: first.id }
        );
        await waitForPageCondition(
          page,
          async durableId =>
            (await window.electron.pty.list()).find(
              item => item.durableSessionId === durableId
            )?.contextSummary === 'MVP of Widget Checkout',
          first.durableSessionId,
          { label: 'the hosted label "MVP of Widget Checkout"' }
        );
      } else {
        await page.waitForTimeout(250);
        const localSummary = await page.evaluate(
          async durableId =>
            (await window.electron.pty.list()).find(
              item => item.durableSessionId === durableId
            )?.contextSummary,
          first.durableSessionId
        );
        check(
          configuredContextEndpoint
            ? 'privacy-off configured service retains the local label and ignores poisoned endpoint env'
            : 'community contract retains the local label and ignores poisoned endpoint env',
          localSummary === 'Implement cmd+shift+t to reopen tabs' &&
            requests.length === 0
        );
      }

      const attachmentPath =
        '/var/folders/example/T/exawatt-clipboard/screenshot.png';
      const attachment = await page.evaluate(
        async ({ cwd, attachmentPath }) => {
          const result = await window.electron.pty.create({
            harness: 'codex',
            cwd,
            durableSessionId: 'context-image-session',
            initialPrompt: attachmentPath,
          });
          if (!result.ok) throw new Error(result.error);
          const session = (await window.electron.pty.list()).find(
            item => item.durableSessionId === 'context-image-session'
          );
          return { id: result.session.id, summary: session?.contextSummary };
        },
        { cwd: projectDir, attachmentPath }
      );
      check(
        'image-only launch immediately shows New agent, never a temp URI',
        attachment.summary === 'New agent'
      );
      await page.waitForTimeout(250);
      check(
        hostedLabelsConfigured
          ? 'hosted evidence redacts the local image path'
          : 'community image launch sends no hosted evidence',
        hostedLabelsConfigured
          ? requests.some(body =>
              body.recentInstructions?.some(
                item => item.text === '[Attachment]'
              )
            ) && !JSON.stringify(requests).includes(attachmentPath)
          : requests.length === 0
      );

      if (feedbackConfigured) {
        // The provider's auth listener mounts in an effect after hydration; a
        // single early dispatch can be missed, so re-dispatch (idempotent)
        // until the authenticated controls render.
        await page.waitForFunction(() => {
          window.dispatchEvent(
            new CustomEvent('exawatt:test-feedback-auth', {
              detail: { accessToken: 'test-jwt' },
            })
          );
          return !!document.querySelector('[data-context-label-feedback]');
        });

        const staleTab = page.locator('[data-tab-id="tab-context-b"]');
        // Feedback controls intentionally ride the active Session only. Select
        // the stale label before asserting/revising it; merely hovering an
        // inactive ribbon item cannot reveal controls by product contract.
        await staleTab.click();
        const controls = staleTab.locator('[data-context-label-feedback]');
        await controls.waitFor();
        try {
          await staleTab.hover();
        } catch (cause) {
          // Observe a failed pointer action before changing it: a screenshot
          // cannot distinguish moving geometry from a transparent interceptor.
          const geometry = await staleTab
            .evaluate(async element => {
              const frames = [];
              for (let frame = 0; frame < 3; frame++) {
                await new Promise(resolve => requestAnimationFrame(resolve));
                const rect = element.getBoundingClientRect();
                frames.push({
                  x: rect.x,
                  y: rect.y,
                  width: rect.width,
                  height: rect.height,
                });
              }
              const rect = element.getBoundingClientRect();
              const style = getComputedStyle(element);
              const controls = element.querySelector(
                '[data-context-label-feedback]'
              );
              return {
                frames,
                connected: element.isConnected,
                display: style.display,
                visibility: style.visibility,
                pointerEvents: style.pointerEvents,
                transform: style.transform,
                controlsOpacity: controls
                  ? getComputedStyle(controls).opacity
                  : null,
                hitTest: document
                  .elementsFromPoint(
                    rect.x + rect.width / 2,
                    rect.y + rect.height / 2
                  )
                  .slice(0, 6)
                  .map(hit => ({
                    tag: hit.tagName,
                    role: hit.getAttribute('role'),
                    tab:
                      hit
                        .closest('[data-tab-id]')
                        ?.getAttribute('data-tab-id') ?? null,
                  })),
                animations: element
                  .getAnimations({ subtree: true })
                  .map(animation => ({
                    state: animation.playState,
                    currentTime: animation.currentTime,
                    timing: animation.effect?.getComputedTiming(),
                  })),
              };
            })
            .catch(error => ({ diagnosticError: String(error) }));
          console.error('[context-feedback-hover]', JSON.stringify(geometry));
          throw cause;
        }
        const controlsElement = await controls.elementHandle();
        await page
          .waitForFunction(
            element => getComputedStyle(element).opacity === '1',
            controlsElement,
            { timeout: 2_000 }
          )
          .catch(() => {});
        check(
          'authenticated context controls reveal on tab hover',
          (await controls.count()) === 1 &&
            (await controls.evaluate(
              element => getComputedStyle(element).opacity
            )) === '1'
        );
        // Programmatic click: at eval window widths the hover-revealed close ×
        // overlaps this control's hit target (ribbon layout, not under test).
        await staleTab
          .getByRole('button', {
            name: /Improve context label: Fix auth redirect loop/,
          })
          .dispatchEvent('click');
        const correction = page.getByLabel('Better context');
        await correction.fill('Improve agent context summaries');
        await correction.press('Enter');
        // An accepted correction closes the popover (stopped chips no longer
        // render their title — D42 review round — so the durable-store
        // round-trip is observed through the accepted send itself).
        await page.waitForFunction(
          () => !document.querySelector('[data-context-label-feedback-popover]')
        );
        check(
          'exact correction updates immediately and uploads label evidence',
          feedbackPayloads.some(
            payload =>
              payload.kind === 'context_label' &&
              payload.sentiment === -1 &&
              payload.message === 'Improve agent context summaries'
          )
        );

        await evaluateFeedbackReporting({
          app,
          page,
          transport,
          check,
          screenshotDir,
          originSessionId: fixtureTab('b', CORRECTED).durableSessionId,
          alternateTabId: fixtureTab('a', CORRECTED).id,
        });
      } else {
        check(
          'community build renders no hosted context-feedback controls',
          (await page.locator('[data-context-label-feedback]').count()) === 0
        );
        const acceptedCorrection = await page.evaluate(
          ({ durableSessionId, label }) =>
            window.electron.pty.correctContext(durableSessionId, label),
          {
            durableSessionId: 'persisted-context-b',
            label: 'Improve agent context summaries',
          }
        );
        check(
          'community build keeps operator corrections local and available',
          acceptedCorrection === 'Improve agent context summaries' &&
            feedbackPayloads.length === 0
        );
      }
      // The relaunch reads what the layout persisted, so wait for the
      // correction to reach it rather than for a number of milliseconds.
      await waitForPageCondition(
        page,
        async label => {
          const layout = await window.electron.workspace.load();
          const tabs = layout?.projects?.flatMap(project => project.tabs) ?? [];
          return ['tab-context-a', 'tab-context-b'].every(
            id => tabs.find(tab => tab.id === id)?.contextSummary === label
          );
        },
        CORRECTED,
        { label: 'the corrected label in the persisted layout' }
      );

      check(
        'renderer emitted no uncaught page errors',
        pageErrors.length === 0
      );

      // the page is already on /workspace; a re-goto can swap the renderer
      // process and orphan the Playwright target — clean up in place
      await page.evaluate(async () => {
        for (const session of await window.electron.pty.list()) {
          if (!session.exited) await window.electron.pty.kill(session.id);
        }
      });
    },
    { maxMs: 120_000 }
  );

  await withElectronApp(
    launchOptions,
    async (_app, page) => {
      page.setDefaultTimeout(20_000);
      await page.locator('[data-workspace-stage]').waitFor();
      // stopped chips no longer render their title (D42 review round) —
      // identity lives in the chip's aria-label/tooltip
      const restoredChips = page.locator(
        '[data-tab-id] [aria-label*="Improve agent context summaries"]'
      );
      await restoredChips
        .first()
        .waitFor()
        .catch(async error => {
          const layout = (() => {
            try {
              return JSON.parse(
                readFileSync(join(userData, 'workspace.json'), 'utf8')
              );
            } catch (readError) {
              return { unreadable: String(readError) };
            }
          })();
          const ribbon = await page.evaluate(() => ({
            url: location.href,
            tabs: Array.from(document.querySelectorAll('[data-tab-id]')).map(
              tab => ({
                id: tab.getAttribute('data-tab-id'),
                labels: Array.from(tab.querySelectorAll('[aria-label]')).map(
                  node => node.getAttribute('aria-label')
                ),
              })
            ),
          }));
          throw new Error(
            `No restored chip carries the corrected context. Persisted: ${JSON.stringify(
              layout.projects?.map(project => ({
                dir: project.dir,
                active: project.activeTabId,
                tabs: project.tabs?.map(tab => ({
                  id: tab.id,
                  summary: tab.contextSummary,
                  lifecycle: tab.lifecycle,
                })),
              })) ?? layout
            )}; activeDir ${layout.activeDir}; rendered: ${JSON.stringify(ribbon)}`,
            { cause: error }
          );
        });
      check(
        'corrected context survives a full Electron relaunch',
        (await restoredChips.count()) >= 2
      );
      check(
        'no clipboard temp path reappears after relaunch',
        !(await page.locator('body').innerText()).includes('exawatt-clipboard')
      );
    },
    { maxMs: 60_000 }
  );
} finally {
  await new Promise(resolve => server.close(resolve));
  rmSync(userData, { recursive: true, force: true });
  rmSync(projectDir, { recursive: true, force: true });
  rmSync(harnessDir, { recursive: true, force: true });
}

if (failures.length) {
  console.error(`FAIL context label + feedback eval: ${failures.join('; ')}`);
  process.exit(1);
}
console.log(
  `PASS context label + feedback eval; screenshots: ${screenshotDir}`
);
