#!/usr/bin/env node

import { chromium } from 'playwright-core';
import { resolveQaBrowser } from './lib/qa-browser.mjs';

const target = process.env.EXA_BASE || 'https://www.exawatt.ai/';
const selection = await resolveQaBrowser(chromium);
const browser = await chromium.launch({
  headless: true,
  ...selection.launchOptions,
});

try {
  const page = await browser.newPage();
  const response = await page.goto(target, {
    waitUntil: 'domcontentloaded',
    timeout: 30_000,
  });
  const status = response?.status() ?? null;
  const title = await page.title();
  if (status !== null && status >= 400) {
    throw new Error(`${target} returned HTTP ${status}.`);
  }
  if (!title.trim()) {
    throw new Error(`${target} loaded without a document title.`);
  }
  console.log(
    `[qa-browser-smoke] ${selection.name} loaded ${page.url()} ` +
      `(HTTP ${status ?? 'n/a'}, title ${JSON.stringify(title)}).`
  );
} finally {
  await browser.close();
}
