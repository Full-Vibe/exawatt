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
    .getByRole('button', { name: 'Dismiss', exact: true })
    .click();
}

/** Reporting-only native scenes. Label inference and persistence remain in the
 * caller; this helper owns image input, immutable attempts and focus handoff. */
export async function evaluateFeedbackReporting({
  app,
  page,
  transport,
  check,
  screenshotDir,
  originSessionId,
  alternateTabId,
}) {
  const composer = page.getByRole('dialog', {
    name: 'Submit feedback',
    exact: true,
  });
  const field = () => composer.getByLabel('Feedback', { exact: true });
  const openComposerShortcut = async () => {
    await page.keyboard.press('Meta+Shift+KeyF');
    await composer.waitFor();
  };

  // Every entry point reaches the same composer and retained draft. A browser
  // file-picker fixture also proves that local images reach this entry point.
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].webContents.send(
      'menu:command',
      'submit-feedback'
    );
  });
  await composer.waitFor();
  const helpMessage =
    'The label should pivot when the Session changes purpose.';
  await field().fill(helpMessage);
  await composer.locator('[data-feedback-image-input]').setInputFiles(IMAGE);
  await composer.getByAltText('Feedback attachment preview').waitFor();
  check(
    'Help accepts a local image through its file picker',
    (
      await composer
        .getByAltText('Feedback attachment preview')
        .getAttribute('src')
    )?.startsWith('data:image/png;base64,')
  );
  const chosenImage = await composer
    .getByAltText('Feedback attachment preview')
    .getAttribute('src');
  await field().press('Escape');
  await composer.waitFor({ state: 'hidden' });
  await page.locator(`[data-tab-id="${alternateTabId}"]`).click();
  await openComposerShortcut();
  check(
    'the global shortcut reopens the Help draft with its chosen evidence',
    (await field().inputValue()) === helpMessage &&
      (await composer
        .getByAltText('Feedback attachment preview')
        .getAttribute('src')) === chosenImage
  );
  await field().press('Escape');
  await composer.waitFor({ state: 'hidden' });
  await page.keyboard.press('Meta+KeyK');
  const palette = page.getByRole('dialog', {
    name: 'Command palette',
    exact: true,
  });
  await palette.waitFor();
  await palette.getByRole('combobox').fill('Send feedback');
  await palette.getByRole('option', { name: /^Send feedback/ }).click();
  await composer.waitFor();
  check(
    'the palette feedback action reaches that same draft and evidence',
    (await field().inputValue()) === helpMessage &&
      (await composer
        .getByAltText('Feedback attachment preview')
        .getAttribute('src')) === chosenImage
  );
  await composer
    .getByRole('button', { name: 'Capture this window', exact: true })
    .click();
  await composer.getByAltText('Feedback attachment preview').waitFor();
  await page.waitForFunction(() =>
    [
      ...document.querySelectorAll('img[alt="Feedback attachment preview"]'),
    ].some(image =>
      image.getAttribute('src')?.startsWith('data:image/jpeg;base64,')
    )
  );
  await page.screenshot({
    path: join(screenshotDir, 'feedback-composer.png'),
  });
  const helpResponse = transport.hold();
  await field().press('Enter');
  const helpRequest = await helpResponse.observed;
  const helpId = helpRequest.payload.idempotencyKey;
  await waitForState(page, helpId, 'sending');
  await composer.waitFor({ state: 'hidden' });
  check(
    'Help returns to the work surface while showing a pending receipt',
    !(await composer.isVisible())
  );
  helpResponse.release();
  await waitForState(page, helpId, 'sent');
  check(
    'general feedback submits text, context, and its explicit screenshot',
    helpRequest.payload.kind === 'general' &&
      helpRequest.payload.message === helpMessage &&
      helpRequest.payload.context?.durableSessionId === originSessionId &&
      helpRequest.payload.attachment?.dataUrl?.startsWith(
        'data:image/jpeg;base64,'
      )
  );
  check(
    'changing the active Session and feedback entry point preserves originating context',
    helpRequest.payload.context?.durableSessionId === originSessionId
  );
  await dismissReceipt(page, helpId);

  // The focus target is an existing operator control, not a test-only element.
  // Opening and submitting must restore it without scrolling the workspace.
  const focusTarget = page.locator('[data-command-altitude-level="terminal"]');
  await focusTarget.focus();
  await openComposerShortcut();
  const barColors = await composer.evaluate(element => {
    const probe = document.createElement('div');
    // The unified Radix shell uses the design-system overlay role. Derive the
    // expectation from that live material instead of pinning the retired
    // opaque quick bar's HUD color or today's transparency preference.
    probe.className = 'exa-material-overlay';
    document.body.append(probe);
    const panel = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return { background: getComputedStyle(element).backgroundColor, panel };
  });
  check(
    'feedback uses the active appearance overlay material',
    barColors.background === barColors.panel
  );
  await field().fill('Quick capture keeps its immutable evidence');
  await injectImage(composer, 'paste');
  check(
    'image paste preserves the report text',
    (await field().inputValue()) ===
      'Quick capture keeps its immutable evidence'
  );
  await composer
    .getByRole('button', { name: 'Remove attached image', exact: true })
    .click();
  await injectImage(composer, 'drop');
  await composer.locator('[data-feedback-image-input]').setInputFiles(IMAGE);
  await composer.getByAltText('Feedback attachment preview').waitFor();
  await page.screenshot({
    path: join(screenshotDir, 'feedback-composer-images.png'),
  });
  const pending = transport.hold();
  // Two synchronous activations are the reentrancy case a disabled button
  // alone cannot protect; the accepted attempt must own the guard.
  await composer
    .getByRole('button', { name: 'Send feedback', exact: true })
    .evaluate(button => {
      button.click();
      button.click();
    });
  const first = await pending.observed;
  const firstId = first.payload.idempotencyKey;
  await waitForState(page, firstId, 'sending');
  await composer.waitFor({ state: 'hidden' });
  check(
    'one pending composer attempt prevents duplicate activation',
    transport.payloads.filter(payload => payload.idempotencyKey === firstId)
      .length === 1
  );
  await page.waitForFunction(
    element => document.activeElement === element,
    await focusTarget.elementHandle()
  );
  check(
    'composer sending hands focus back to the previous workspace control',
    await focusTarget.evaluate(element => document.activeElement === element)
  );
  check(
    'composer payload stamps build attribution and the chosen local image',
    typeof first.payload.surface === 'string' &&
      first.payload.surface.length > 0 &&
      typeof first.payload.appVersion === 'string' &&
      first.payload.appVersion.length > 0 &&
      first.payload.buildSha === 'development' &&
      first.payload.context?.buildDelivery === 'dogfood' &&
      first.payload.attachment?.dataUrl?.startsWith('data:image/png;base64,')
  );

  await openComposerShortcut();
  check(
    'opening while sending starts a distinct empty draft',
    (await field().inputValue()) === ''
  );
  const newerMessage = 'This newer report must survive the earlier completion';
  await field().fill(newerMessage);
  await field().press('Escape');
  await composer.waitFor({ state: 'hidden' });
  pending.release();
  await waitForState(page, firstId, 'sent');
  await openComposerShortcut();
  check(
    'an older successful completion never clears the newer dismissed draft',
    (await field().inputValue()) === newerMessage
  );
  await field().press('Escape');
  await composer.waitFor({ state: 'hidden' });
  await dismissReceipt(page, firstId);

  // Partial receipts retain evidence and retry the same frozen attempt,
  // rather than displaying success after only the text was stored.
  await openComposerShortcut();
  await injectImage(composer, 'paste');
  transport.enqueue({ attachmentStored: false });
  await composer
    .getByRole('button', { name: 'Send feedback', exact: true })
    .click();
  const partial = page.locator(
    '[data-feedback-attempt][data-feedback-state="partial"]'
  );
  await partial.waitFor();
  const partialId = await partial.getAttribute('data-feedback-attempt');
  const partialPayload = transport.payloads.find(
    payload => payload.idempotencyKey === partialId
  );
  check(
    'partial attachment delivery never renders a success receipt',
    !(await attempt(page, partialId)
      .locator('[data-operation-receipt="success"]')
      .count())
  );
  await page.screenshot({
    path: join(screenshotDir, 'feedback-partial-receipt.png'),
  });
  const retryResponse = transport.hold();
  await partial.getByRole('button', { name: 'Retry', exact: true }).click();
  const retry = await retryResponse.observed;
  await waitForState(page, partialId, 'sending');
  check(
    'partial retry reuses the complete frozen payload and identity',
    JSON.stringify(retry.payload) === JSON.stringify(partialPayload)
  );
  retryResponse.release();
  await waitForState(page, partialId, 'sent');
  await dismissReceipt(page, partialId);

  await openComposerShortcut();
  await field().fill('A failed request preserves the report and image');
  await injectImage(composer, 'drop');
  transport.enqueue({ error: 'Simulated reporting service unavailable' });
  await composer
    .getByRole('button', { name: 'Send feedback', exact: true })
    .click();
  const failed = page.locator(
    '[data-feedback-attempt][data-feedback-state="error"]'
  );
  await failed.waitFor();
  const failedId = await failed.getAttribute('data-feedback-attempt');
  const failedPayload = transport.payloads.find(
    payload => payload.idempotencyKey === failedId
  );
  await failed
    .getByRole('button', { name: 'Edit feedback', exact: true })
    .click();
  await composer.waitFor();
  check(
    'failure recovery preserves text and image for explicit editing',
    (await field().inputValue()) ===
      'A failed request preserves the report and image' &&
      (
        await composer
          .getByAltText('Feedback attachment preview')
          .getAttribute('src')
      )?.startsWith('data:image/png;base64,')
  );
  await field().press('Escape');
  await composer.waitFor({ state: 'hidden' });
  const failedRetryResponse = transport.hold();
  await attempt(page, failedId)
    .getByRole('button', { name: 'Retry', exact: true })
    .click();
  const failedRetry = await failedRetryResponse.observed;
  check(
    'failure retry preserves its frozen attempt after opening an editable copy',
    JSON.stringify(failedRetry.payload) === JSON.stringify(failedPayload)
  );
  failedRetryResponse.release();
  await waitForState(page, failedId, 'sent');
  await dismissReceipt(page, failedId);

  // Finishing partial delivery is a deliberate acceptance of the saved text,
  // never an invisible conversion of attachment failure into complete success.
  await openComposerShortcut();
  await field().fill('Keep the saved text without this image');
  await injectImage(composer, 'paste');
  transport.enqueue({ attachmentStored: false });
  await composer
    .getByRole('button', { name: 'Send feedback', exact: true })
    .click();
  await partial.waitFor();
  const finishId = await partial.getAttribute('data-feedback-attempt');
  const beforeFinish = transport.payloads.length;
  await partial
    .getByRole('button', { name: 'Finish without image', exact: true })
    .click();
  await waitForState(page, finishId, 'sent');
  check(
    'finishing without image sends no replacement report',
    transport.payloads.length === beforeFinish
  );
  await dismissReceipt(page, finishId);
}
