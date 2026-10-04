import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

// A real PNG carried by File/DataTransfer in the page. These scenes never
// modify the operator's system clipboard or send evidence to a hosted service.
const IMAGE = {
  name: 'feedback-evidence.png',
  mimeType: 'image/png',
  buffer: Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNImHDgPwAFtAKwqMGMygAAAABJRU5ErkJggg==',
    'base64'
  ),
};

/** Intercept exactly the distribution-selected V1 operation, including custom
 * endpoint paths. A queued response may be held until the UI proves pending
 * ownership; normal label votes use the same complete receipt by default. */
export async function installFeedbackTransport(page, endpoint) {
  const payloads = [];
  const requests = [];
  const queued = [];
  const ids = new Map();
  const headers = {
    'Exawatt-Service-Version': '1',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers':
      'authorization, content-type, exawatt-service-version',
    'Access-Control-Expose-Headers': 'Exawatt-Service-Version',
  };
  const handler = async route => {
    const method = route.request().method();
    if (method === 'OPTIONS') {
      await route.fulfill({ status: 204, headers, body: '' });
      return;
    }
    if (method === 'GET') {
      await route.fulfill({
        status: 200,
        headers,
        contentType: 'application/json',
        body: JSON.stringify({
          schemaVersion: 1,
          canTriage: false,
          untriagedCount: null,
        }),
      });
      return;
    }
    if (method !== 'POST') {
      await route.fulfill({ status: 405, headers, body: '' });
      return;
    }
    const payload = JSON.parse(route.request().postData() || '{}');
    const duplicate = ids.has(payload.idempotencyKey);
    if (!duplicate) ids.set(payload.idempotencyKey, randomUUID());
    payloads.push(payload);
    const plan = queued.shift() ?? {};
    const observed = { payload, index: payloads.length - 1 };
    requests.push(observed);
    plan.observe?.(observed);
    if (plan.released) await plan.released;
    if (plan.abort) {
      await route.abort('failed');
      return;
    }
    const failed = !!plan.error;
    await route.fulfill({
      status: failed ? 503 : duplicate ? 200 : 201,
      headers,
      contentType: failed ? 'application/problem+json' : 'application/json',
      body: JSON.stringify(
        failed
          ? {
              schemaVersion: 1,
              type: 'about:blank',
              title: 'Reporting service unavailable',
              status: 503,
              code: 'service_unavailable',
              detail: plan.error,
              retryable: true,
            }
          : {
              schemaVersion: 1,
              id: ids.get(payload.idempotencyKey),
              duplicate,
              attachmentStored: plan.attachmentStored ?? !!payload.attachment,
            }
      ),
    });
  };
  const matcher = endpoint ? new URL(endpoint).href : null;
  if (matcher) await page.route(matcher, handler);
  return {
    payloads,
    requests,
    enqueue(plan = {}) {
      queued.push(plan);
    },
    hold(plan = {}) {
      let release;
      let observe;
      const released = new Promise(resolve => {
        release = resolve;
      });
      const accepted = new Promise(resolve => {
        observe = resolve;
      });
      // Playwright's bounded request wait reports a mismatched endpoint
      // instead of leaving an eval parked forever on an unhandled promise.
      const observed = page
        .waitForRequest(
          request => request.method() === 'POST' && request.url() === matcher
        )
        .then(() => accepted);
      queued.push({ ...plan, released, observe });
      return { observed, release };
    },
    async dispose() {
      if (matcher) await page.unroute(matcher, handler);
    },
  };
}

async function injectImage(form, eventType) {
  // Paste/drop originates at the editing target, then bubbles to the shared
  // composer's handlers. Dispatching on its Radix ancestor cannot reach down.
  await form.getByRole('textbox', { name: 'Feedback', exact: true }).evaluate(
    (element, { eventType, bytes, name }) => {
      const transfer = new DataTransfer();
      transfer.items.add(
        new File([new Uint8Array(bytes)], name, { type: 'image/png' })
      );
      element.dispatchEvent(
        eventType === 'paste'
          ? new ClipboardEvent('paste', {
              clipboardData: transfer,
              bubbles: true,
              cancelable: true,
            })
          : new DragEvent('drop', {
              dataTransfer: transfer,
              bubbles: true,
              cancelable: true,
            })
      );
    },
    { eventType, bytes: [...IMAGE.buffer], name: IMAGE.name }
  );
  await form.getByAltText('Feedback attachment preview').waitFor();
  await form
    .getByAltText('Feedback attachment preview')
    .evaluate(image => image.decode());
}

function attempt(page, id) {
  return page.locator(`[data-feedback-attempt="${id}"]`);
}

async function waitForState(page, id, state) {
  await page
    .locator(`[data-feedback-attempt="${id}"][data-feedback-state="${state}"]`)
    .waitFor();
}

async function dismissReceipt(page, id) {
  await attempt(page, id)
    .getByRole('button', { name: 'Done', exact: true })
    .click();
}

/** Reporting-only native scenes. Service persistence has its own deliberate live
 * probe; these deterministic scenes own interaction, evidence and retry truth. */
export async function evaluateFeedbackReporting({
  app, page, transport, check, screenshotDir, originSessionId, alternateTabId,
}) {
  const composer = page.getByRole('dialog', { name: 'Submit feedback', exact: true });
  const field = () => composer.getByLabel('Feedback', { exact: true });
  const openComposerShortcut = async () => {
    await page.keyboard.press('Meta+Shift+KeyF');
    await composer.waitFor();
  };
  const waitForEditingFocus = async () => {
    try {
      await page.waitForFunction(element =>
        document.activeElement === element && !element.disabled && !element.readOnly,
        await field().elementHandle());
    } catch (cause) {
      const state = await composer.evaluate(element => {
        const input = element.querySelector('textarea');
        const active = document.activeElement;
        return {
          activeTag: active?.tagName,
          activeLabel: active?.getAttribute('aria-label'),
          activeSlot: active?.getAttribute('data-slot'),
          dialogState: element.getAttribute('data-state'),
          inert: element.hasAttribute('inert'),
          inputDisabled: input?.disabled,
          inputReadOnly: input?.readOnly,
          focusedInDialog: !!active && element.contains(active),
        };
      });
      throw new Error(`Feedback editor did not acquire focus: ${JSON.stringify(state)}`, { cause });
    }
  };
  const done = async id => {
    await dismissReceipt(page, id);
    await composer.waitFor({ state: 'hidden' });
  };
  const settlePanel = () => composer.evaluate(async element => {
    // Await the actual finite presentation effects, not a guessed duration.
    await Promise.all(element.getAnimations({ subtree: true })
      .filter(animation => Number.isFinite(animation.effect?.getComputedTiming().iterations ?? 1))
      .map(animation => animation.finished.catch(() => undefined)));
  });
  const toolbarInlineBounds = () => composer.locator('[data-feedback-toolbar]').evaluate(element => {
    const { left, right } = element.getBoundingClientRect();
    const actions = [...element.querySelectorAll('button')].map(button => {
      const rect = button.getBoundingClientRect();
      return { label: button.getAttribute('aria-label') || button.textContent?.trim(), left: rect.left, right: rect.right, top: rect.top };
    });
    return { left, right, actions, viewport: window.innerWidth };
  });
  const checkToolbar = async (before, label) => {
    await settlePanel();
    const after = await toolbarInlineBounds();
    const stableActions = before.actions.every(original => {
      const current = after.actions.find(action => action.label === original.label);
      return current && current.left === original.left && current.right === original.right &&
        current.top - after.actions[0].top === original.top - before.actions[0].top;
    });
    check(label, before.left === after.left && before.right === after.right &&
      after.left >= 0 && after.right <= after.viewport &&
      after.actions.every(action => action.left >= after.left && action.right <= after.right) && stableActions);
  };

  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].webContents.send('menu:command', 'submit-feedback');
  });
  await composer.waitFor();
  // fill() would supply the very focus this cold-open case needs to prove.
  await waitForEditingFocus();
  const helpMessage = 'The label should pivot when the Session changes purpose.';
  await page.keyboard.type(helpMessage);
  check('cold Help opens a ready keyboard editor without click or fill', (await field().inputValue()) === helpMessage);
  await settlePanel();
  const toolbar = await toolbarInlineBounds();
  await page.keyboard.press('Meta+Digit2');
  await checkToolbar(toolbar, 'switching feedback kind keeps the evidence toolbar within its original inline bounds');
  await page.keyboard.press('Meta+Digit1');
  await composer.locator('[data-feedback-image-input]').setInputFiles(IMAGE);
  await composer.getByAltText('Feedback attachment preview').waitFor();
  const chosenImage = await composer.getByAltText('Feedback attachment preview').getAttribute('src');
  check('Help accepts a local image through its file picker', chosenImage?.startsWith('data:image/png;base64,'));
  await field().press('Escape');
  await composer.waitFor({ state: 'hidden' });
  await page.locator(`[data-tab-id="${alternateTabId}"]`).click();
  await openComposerShortcut();
  check('the global shortcut reopens the Help draft with its chosen evidence',
    (await field().inputValue()) === helpMessage &&
    (await composer.getByAltText('Feedback attachment preview').getAttribute('src')) === chosenImage);
  await field().press('Escape');
  await composer.waitFor({ state: 'hidden' });
  await page.keyboard.press('Meta+KeyK');
  const palette = page.getByRole('dialog', { name: 'Command palette', exact: true });
  await palette.waitFor();
  await palette.getByRole('combobox').fill('Send feedback');
  await palette.getByRole('option', { name: /^Send feedback/ }).click();
  await composer.waitFor();
  check('the palette feedback action reaches that same draft and evidence',
    (await field().inputValue()) === helpMessage &&
    (await composer.getByAltText('Feedback attachment preview').getAttribute('src')) === chosenImage);
  const capture = composer.getByRole('button', { name: 'Screenshot', exact: true });
  const beforeCapture = transport.payloads.length;
  await capture.focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => [...document.querySelectorAll('img[alt="Feedback attachment preview"]')]
    .some(image => image.getAttribute('src')?.startsWith('data:image/jpeg;base64,')));
  check('Enter activates focused window capture without submitting', transport.payloads.length === beforeCapture);
  await waitForEditingFocus();
  await page.keyboard.press('Meta+KeyS');
  await waitForEditingFocus();
  await checkToolbar(toolbar, 'replacing evidence by capture preserves toolbar inline bounds');
  await page.screenshot({ path: join(screenshotDir, 'feedback-composer.png') });

  const helpResponse = transport.hold();
  const originalDialog = await composer.elementHandle();
  const originalField = await field().elementHandle();
  await field().press('Enter');
  const helpRequest = await helpResponse.observed;
  const helpId = helpRequest.payload.idempotencyKey;
  await waitForState(page, helpId, 'sending');
  check('sending remains in the same mounted dialog with a focused read-only report',
    await originalDialog.evaluate(element => element.isConnected && element.contains(document.activeElement)) &&
    await originalField.evaluate(element => element.isConnected && element.readOnly && !element.disabled));
  await page.screenshot({ path: join(screenshotDir, 'feedback-pending.png') });
  helpResponse.release();
  await waitForState(page, helpId, 'sent');
  check('the saved outcome stays in that dialog beside the submitted report',
    await originalDialog.evaluate(element => element.isConnected) && (await field().inputValue()) === helpMessage);
  check('general feedback submits originating context and its explicit screenshot',
    helpRequest.payload.kind === 'general' && helpRequest.payload.message === helpMessage &&
    helpRequest.payload.context?.durableSessionId === originSessionId &&
    helpRequest.payload.attachment?.dataUrl?.startsWith('data:image/jpeg;base64,'));
  await page.screenshot({ path: join(screenshotDir, 'feedback-saved.png') });
  await done(helpId);

  const focusTarget = page.locator('[data-command-altitude-level="terminal"]');
  await focusTarget.focus();
  await openComposerShortcut();
  await waitForEditingFocus();
  const barColors = await composer.evaluate(element => {
    const probe = document.createElement('div');
    probe.className = 'exa-material-overlay';
    document.body.append(probe);
    const panel = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return { background: getComputedStyle(element).backgroundColor, panel };
  });
  check('feedback uses the active appearance overlay material', barColors.background === barColors.panel);
  const report = 'Quick capture keeps its immutable evidence';
  await page.keyboard.type(report);
  await injectImage(composer, 'paste');
  check('image paste preserves report text', (await field().inputValue()) === report);
  await composer.getByRole('button', { name: 'Remove attached image', exact: true }).click();
  await injectImage(composer, 'drop');
  await composer.locator('[data-feedback-image-input]').setInputFiles(IMAGE);
  await composer.getByAltText('Feedback attachment preview').waitFor();
  await page.screenshot({ path: join(screenshotDir, 'feedback-composer-images.png') });
  const pending = transport.hold();
  await composer.getByRole('button', { name: 'Send feedback', exact: true }).evaluate(button => {
    button.click(); button.click();
  });
  const first = await pending.observed;
  const firstId = first.payload.idempotencyKey;
  await waitForState(page, firstId, 'sending');
  check('one pending attempt prevents duplicate activation',
    transport.payloads.filter(payload => payload.idempotencyKey === firstId).length === 1);
  check('payload stamps build attribution and chosen local image',
    typeof first.payload.surface === 'string' && first.payload.surface.length > 0 &&
    typeof first.payload.appVersion === 'string' && first.payload.appVersion.length > 0 &&
    first.payload.buildSha === 'development' && first.payload.context?.buildDelivery === 'dogfood' &&
    first.payload.attachment?.dataUrl?.startsWith('data:image/png;base64,'));
  await field().press('Escape');
  await composer.waitFor({ state: 'hidden' });
  await page.waitForFunction(element => document.activeElement === element, await focusTarget.elementHandle());
  check('deliberately closing pending feedback restores its work invoker',
    await focusTarget.evaluate(element => document.activeElement === element));
  await openComposerShortcut();
  await waitForState(page, firstId, 'sending');
  check('reopening pending feedback resumes its frozen report instead of making another draft',
    (await field().inputValue()) === report && await field().evaluate(element => element.readOnly));
  pending.release();
  await waitForState(page, firstId, 'sent');
  const beforeNewFeedback = transport.payloads.length;
  await attempt(page, firstId).getByRole('button', { name: 'Done', exact: true }).focus();
  await page.keyboard.press('Enter');
  await composer.waitFor({ state: 'hidden' });
  await openComposerShortcut();
  await waitForEditingFocus();
  check('finishing and reopening begins a fresh focused draft without another delivery',
    (await field().inputValue()) === '' && transport.payloads.length === beforeNewFeedback);

  await page.keyboard.type('Retry the same image after partial delivery');
  await injectImage(composer, 'paste');
  transport.enqueue({ attachmentStored: false });
  await field().press('Enter');
  const partial = page.locator('[data-feedback-attempt][data-feedback-state="partial"]');
  await partial.waitFor();
  const partialId = await partial.getAttribute('data-feedback-attempt');
  const partialPayload = transport.payloads.find(payload => payload.idempotencyKey === partialId);
  check('partial image delivery never renders a complete receipt',
    !(await attempt(page, partialId).locator('[data-operation-receipt="success"]').count()));
  await page.screenshot({ path: join(screenshotDir, 'feedback-partial-receipt.png') });
  const retryResponse = transport.hold();
  await partial.getByRole('button', { name: /^(?:Retry(?: image)?|Try again)$/, exact: true }).focus();
  await page.keyboard.press('Enter');
  const retry = await retryResponse.observed;
  await waitForState(page, partialId, 'sending');
  check('partial retry reuses the complete frozen payload and identity', JSON.stringify(retry.payload) === JSON.stringify(partialPayload));
  retryResponse.release();
  await waitForState(page, partialId, 'sent');
  await done(partialId);

  await openComposerShortcut();
  await waitForEditingFocus();
  const failedMessage = 'A failed request preserves the report and image';
  await page.keyboard.type(failedMessage);
  await injectImage(composer, 'drop');
  transport.enqueue({ error: 'Simulated reporting service unavailable' });
  await field().press('Enter');
  const failed = page.locator('[data-feedback-attempt][data-feedback-state="error"]');
  await failed.waitFor();
  const failedId = await failed.getAttribute('data-feedback-attempt');
  const failedPayload = transport.payloads.find(payload => payload.idempotencyKey === failedId);
  check('uncertain failure retains the report without offering an unrelated new write',
    (await field().inputValue()) === failedMessage && await field().evaluate(element => element.readOnly) &&
    !(await failed.getByRole('button', { name: 'Edit feedback', exact: true }).count()) &&
    !(await failed.getByRole('button', { name: 'New feedback', exact: true }).count()));
  await composer.getByRole('button', { name: 'Close', exact: true }).click();
  await composer.waitFor({ state: 'hidden' });
  await openComposerShortcut();
  await waitForState(page, failedId, 'error');
  check('closing an uncertain result keeps its chosen evidence for same-report recovery',
    (await field().inputValue()) === failedMessage &&
    (await composer.getByAltText('Feedback attachment preview').getAttribute('src'))?.startsWith('data:image/png;base64,'));
  const failedRetryResponse = transport.hold();
  await attempt(page, failedId).getByRole('button', { name: /^(?:Retry(?: image)?|Try again)$/, exact: true }).click();
  const failedRetry = await failedRetryResponse.observed;
  check('failure retry preserves its frozen attempt after closing and reopening', JSON.stringify(failedRetry.payload) === JSON.stringify(failedPayload));
  failedRetryResponse.release();
  await waitForState(page, failedId, 'sent');
  await done(failedId);

  await openComposerShortcut();
  await waitForEditingFocus();
  await page.keyboard.type('Keep the saved text without this image');
  await injectImage(composer, 'paste');
  transport.enqueue({ attachmentStored: false });
  await field().press('Enter');
  await partial.waitFor();
  const finishId = await partial.getAttribute('data-feedback-attempt');
  const beforeFinish = transport.payloads.length;
  await partial.getByRole('button', { name: 'Finish without image', exact: true }).click();
  await waitForState(page, finishId, 'sent');
  check('finishing without image sends no replacement report', transport.payloads.length === beforeFinish);
  await done(finishId);

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openComposerShortcut();
  await waitForEditingFocus();
  check('reduced motion preserves readiness without running overlay presence animations',
    await composer.evaluate(element => element.getAnimations().every(animation => animation.playState !== 'running')));
  await page.keyboard.type('Keep this draft through an interrupted close');
  await field().press('Escape');
  await composer.waitFor({ state: 'hidden' });
  await page.emulateMedia({ reducedMotion: null });
  await openComposerShortcut();
  await waitForEditingFocus();
  await field().press('Escape');
  // Reopen while Radix may retain the closing subtree; no guessed exit delay.
  await openComposerShortcut();
  await waitForEditingFocus();
  check('rapid close and reopen preserves input and releases inertness',
    (await field().inputValue()) === 'Keep this draft through an interrupted close' &&
    (await composer.getAttribute('inert')) === null);
  await field().press('Escape');
  await composer.waitFor({ state: 'hidden' });
}
