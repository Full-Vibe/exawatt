/**
 * Paused-Agent record gates (ENG-016 BUG-012/BUG-013), run against
 * `/hud-gallery/paused-agent`.
 *
 * The contract this protects is the one the operator paid for twice:
 *
 *   1. Every paused state SAYS how it ended. "Jumbled, unreadable text" was
 *      the symptom; a pane that renders but explains nothing is the same
 *      failure wearing better clothes.
 *   2. The record never asks for the transcript. That read is the
 *      main-process parse in incident 0008, and the whole fix is that it
 *      leaves the interaction path.
 *   3. The transcript, once asked for, is bounded and says what it dropped.
 */
import { chromium } from 'playwright-core';
import {
  primeEvalBrowserPage,
  resolveQaBrowserLaunchOptions,
} from './lib/qa-browser.mjs';

const BASE = process.env.EXA_BASE || 'http://localhost:7000';

const browser = await chromium.launch({
  ...(await resolveQaBrowserLaunchOptions(chromium)),
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1200, height: 1000 } });
await primeEvalBrowserPage(page);
const errors = [];
page.on('pageerror', error => errors.push(String(error.message || error)));
page.on('console', message => {
  if (message.type() === 'error') errors.push(message.text());
});

try {
  await page.goto(`${BASE}/hud-gallery/paused-agent`, {
    waitUntil: 'networkidle',
  });
  await page.waitForSelector('[data-paused-record-study]');
  await page.waitForTimeout(700);

  // Gate 1 — every case explains its ending.
  const cases = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-paused-case]')).map(node => ({
      id: node.getAttribute('data-paused-case'),
      text: node.textContent ?? '',
    }))
  );
  if (cases.length < 5) {
    throw new Error(`record gate: expected the full state matrix, got ${cases.length}`);
  }
  const silent = cases.filter(
    item =>
      !/Stopped cleanly|Exited with code|Interrupted|Shell closed|resume attempt/.test(
        item.text
      )
  );
  if (silent.length > 0) {
    throw new Error(
      `record gate: these states do not say how the Agent ended: ${silent
        .map(item => item.id)
        .join(', ')}`
    );
  }
  console.log(`[paused-record] gate ok: ${cases.length} states each state their ending`);

  // Gate 2 — a record with saved output offers the transcript but has not
  // read it, and a record with none says so instead of offering nothing.
  const controls = await page.evaluate(() => {
    const read = id => {
      const node = document.querySelector(
        `[data-paused-case="${id}"] [data-show-transcript]`
      );
      return node
        ? { label: node.textContent?.trim(), disabled: node.hasAttribute('disabled') }
        : null;
    };
    return { saved: read('stopped-clean'), empty: read('nothing-saved') };
  });
  if (!controls.saved || controls.saved.disabled) {
    throw new Error(
      `record gate: a paused Agent with saved output must offer it: ${JSON.stringify(controls.saved)}`
    );
  }
  if (!controls.empty || !controls.empty.disabled) {
    throw new Error(
      `record gate: an Agent with nothing saved must say so, not offer a dead control: ${JSON.stringify(controls.empty)}`
    );
  }
  const openedBefore = await page.evaluate(
    () => document.querySelectorAll('[data-paused-transcript]').length
  );
  if (openedBefore !== 0) {
    throw new Error(
      'record gate: a transcript rendered without being asked for — that read is incident 0008'
    );
  }
  console.log('[paused-record] gate ok: the transcript is offered, not loaded');

  // Gate 3 — on demand it renders as lines and states what it dropped.
  await page
    .locator('[data-paused-case="stopped-clean"] [data-show-transcript]')
    .click();
  await page.waitForSelector('[data-paused-transcript]');
  const transcript = await page.evaluate(() => {
    const node = document.querySelector('[data-paused-transcript]');
    const section = node?.closest('section');
    return {
      lines: (node?.textContent ?? '').split('\n').length,
      notice: section?.textContent ?? '',
    };
  });
  if (transcript.lines < 3) {
    throw new Error(
      `record gate: the transcript rendered ${transcript.lines} lines`
    );
  }
  if (!/not shown/.test(transcript.notice)) {
    throw new Error(
      'record gate: a truncated transcript must say what it dropped'
    );
  }
  console.log(
    `[paused-record] gate ok: ${transcript.lines} transcript lines, truncation stated`
  );

  if (errors.length > 0) {
    throw new Error(`Renderer errors:\n${errors.join('\n')}`);
  }
  console.log('PASS paused Agent record: every ending stated, transcript on demand');
} finally {
  await browser.close();
}
