#!/usr/bin/env node

import { createServer } from 'node:http';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { withElectronApp } from './lib/electron-eval.mjs';

const userData = mkdtempSync(join(tmpdir(), 'exawatt-context-eval-user-'));
const projectDir = mkdtempSync(join(tmpdir(), 'exawatt-context-eval-project-'));
const harnessDir = mkdtempSync(join(tmpdir(), 'exawatt-context-eval-harness-'));
const screenshotDir =
  process.env.CONTEXT_SCREENSHOT_DIR || '/tmp/exawatt-context-label-eval';
mkdirSync(screenshotDir, { recursive: true });

for (const harness of ['codex', 'claude']) {
  const executable = join(harnessDir, harness);
  writeFileSync(
    executable,
    '#!/bin/sh\nprintf "fake harness ready\\n"\nwhile IFS= read -r line; do printf "%s\\n" "$line"; done\n',
    { mode: 0o700 }
  );
  chmodSync(executable, 0o700);
}

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
    response.writeHead(503, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: 'simulated failure' }));
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
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(JSON.stringify(result));
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
      const signedOutMenu = await app.evaluate(({ Menu }) => {
        const help = Menu.getApplicationMenu()?.items.find(
          item => item.label === 'Help'
        );
        const feedback = help?.submenu?.items[0];
        return { label: feedback?.label, enabled: feedback?.enabled };
      });
      check(
        'signed-out Help menu names the sign-in requirement and is disabled',
        signedOutMenu.enabled === false &&
          signedOutMenu.label?.includes('Sign in required')
      );

      await page.evaluate(() => {
        window.dispatchEvent(
          new CustomEvent('exawatt:test-feedback-auth', {
            detail: { accessToken: 'test-jwt' },
          })
        );
      });
      await page.waitForTimeout(100);
      const signedInMenu = await app.evaluate(({ Menu }) => {
        const help = Menu.getApplicationMenu()?.items.find(
          item => item.label === 'Help'
        );
        const feedback = help?.submenu?.items[0];
        return { label: feedback?.label, enabled: feedback?.enabled };
      });
      check(
        'signed-in Help menu enables Submit Feedback',
        signedInMenu.enabled === true &&
          signedInMenu.label === 'Submit Feedback…'
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
      await page.waitForFunction(async durableId => {
        const session = (await window.electron.pty.list()).find(
          item => item.durableSessionId === durableId
        );
        return (
          session?.contextSummary === 'Implement cmd+shift+t to reopen tabs'
        );
      }, first.durableSessionId);

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
      await page.waitForFunction(async durableId => {
        const session = (await window.electron.pty.list()).find(
          item => item.durableSessionId === durableId
        );
        return session?.contextSummary === 'Improve agent context summaries';
      }, first.durableSessionId);
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
      await page.waitForFunction(async durableId => {
        const session = (await window.electron.pty.list()).find(
          item => item.durableSessionId === durableId
        );
        return session?.contextSummary === 'MVP of Widget Checkout';
      }, first.durableSessionId);

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
        'hosted evidence redacts the local image path',
        requests.some(body =>
          body.recentInstructions?.some(item => item.text === '[Attachment]')
        ) && !JSON.stringify(requests).includes(attachmentPath)
      );

      const feedbackPayloads = [];
      await page.route('**/api/feedback', async route => {
        feedbackPayloads.push(JSON.parse(route.request().postData() || '{}'));
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({
            id: `feedback-${feedbackPayloads.length}`,
            duplicate: false,
            attachmentStored: !!feedbackPayloads.at(-1)?.attachment,
          }),
        });
      });
      await page.evaluate(
        ({ cwd }) =>
          window.electron.workspace.save({
            v: 6,
            lastUsedDir: cwd,
            activeDir: cwd,
            pinnedTabId: null,
            recentProjects: [],
            projects: [
              {
                dir: cwd,
                name: 'Exawatt',
                color: '#F34A9D',
                activeTabId: 'tab-context-a',
                tabs: [
                  {
                    id: 'tab-context-a',
                    durableSessionId: 'persisted-context-a',
                    harness: 'codex',
                    title: 'Codex',
                    titleKind: 'default',
                    cwd,
                    sessionId: null,
                    harnessSessionId: 'provider-context-a',
                    roadmapItemId: null,
                    lifecycle: 'stopped-clean',
                    exitCode: null,
                    initialTask: 'Improve agent context summaries',
                    contextSummary: 'Improve agent context summaries',
                  },
                  {
                    id: 'tab-context-b',
                    durableSessionId: 'persisted-context-b',
                    harness: 'codex',
                    title: 'Codex',
                    titleKind: 'default',
                    cwd,
                    sessionId: null,
                    harnessSessionId: 'provider-context-b',
                    roadmapItemId: null,
                    lifecycle: 'stopped-clean',
                    exitCode: null,
                    initialTask: 'Fix auth redirect loop',
                    contextSummary: 'Fix auth redirect loop',
                  },
                ],
              },
            ],
          }),
        { cwd: projectDir }
      );
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.locator('[data-workspace-stage]').waitFor();
      await page.evaluate(() => {
        window.dispatchEvent(
          new CustomEvent('exawatt:test-feedback-auth', {
            detail: { accessToken: 'test-jwt' },
          })
        );
      });
      await page.waitForTimeout(200);

      const staleTab = page.locator('[data-tab-id="tab-context-b"]');
      const controls = staleTab.locator('[data-context-label-feedback]');
      await controls.waitFor();
      await staleTab.hover();
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
      await staleTab
        .getByRole('button', {
          name: /Improve context label: Fix auth redirect loop/,
        })
        .click();
      const correction = page.getByLabel('Better context');
      await correction.fill('Improve agent context summaries');
      await correction.press('Enter');
      await page.waitForFunction(() =>
        Array.from(document.querySelectorAll('[data-subtitle]')).some(
          node => node.textContent?.trim() === 'Improve agent context summaries'
        )
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

      await app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0].webContents.send(
          'menu:command',
          'submit-feedback'
        );
      });
      const dialog = page.getByRole('dialog', { name: 'Submit feedback' });
      await dialog.waitFor();
      await dialog
        .getByLabel('What should we know?')
        .fill('The label should pivot when the Session changes purpose.');
      await dialog.getByRole('button', { name: 'Capture this window' }).click();
      await page.getByAltText('Feedback attachment preview').waitFor();
      await page.screenshot({
        path: join(screenshotDir, 'general-feedback-dialog.png'),
      });
      await dialog.getByRole('button', { name: 'Send feedback' }).click();
      await page.waitForFunction(
        () => !document.querySelector('[role="dialog"]')
      );
      check(
        'general feedback submits text, context, and an explicit screenshot',
        feedbackPayloads.some(
          payload =>
            payload.kind === 'general' &&
            payload.attachment?.dataUrl?.startsWith('data:image/jpeg;base64,')
        )
      );

      check(
        'renderer emitted no uncaught page errors',
        pageErrors.length === 0
      );

      await page.goto(
        `${process.env.EXA_BASE ?? 'http://localhost:7000'}/workspace`,
        { waitUntil: 'domcontentloaded' }
      );
      await page.waitForTimeout(900);
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
      await page
        .getByText('Improve agent context summaries', { exact: true })
        .first()
        .waitFor();
      check(
        'corrected context survives a full Electron relaunch',
        (await page
          .getByText('Improve agent context summaries', { exact: true })
          .count()) >= 2
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
