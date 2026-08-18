#!/usr/bin/env node

/**
 * Browser regression for stable public-surface typography.
 *
 * Samples the resolved face, size, line metrics, and element geometry on every
 * animation frame. Mono labels are the control because their face is outside
 * the app-global interface-font preference.
 */

import { chromium } from 'playwright-core';
import { createHash } from 'node:crypto';
import { resolveQaBrowserLaunchOptions } from './lib/qa-browser.mjs';

const BASE = (process.env.EXA_BASE || 'http://localhost:7000').replace(
  /\/$/,
  ''
);
const SAMPLE_MS = Number(process.env.EXAWATT_TYPOGRAPHY_SAMPLE_MS || 5_000);
const VIEWPORT_WIDTH = Number(
  process.env.EXAWATT_TYPOGRAPHY_VIEWPORT_WIDTH || 1040
);
const VIEWPORT_HEIGHT = Number(
  process.env.EXAWATT_TYPOGRAPHY_VIEWPORT_HEIGHT || 744
);
const DEVICE_SCALE_FACTOR = Number(
  process.env.EXAWATT_TYPOGRAPHY_DEVICE_SCALE_FACTOR || 1
);
const HEADLESS = process.env.EXAWATT_TYPOGRAPHY_HEADFUL !== '1';
const THEME_ID = process.env.EXAWATT_TYPOGRAPHY_THEME_ID;
const INTERFACE_FONT = process.env.EXAWATT_TYPOGRAPHY_INTERFACE_FONT || 'theme';
const INTERFACE_SCALE = Number(
  process.env.EXAWATT_TYPOGRAPHY_INTERFACE_SCALE || 100
);
const FONT_DELAY_MS = Number(process.env.EXAWATT_TYPOGRAPHY_FONT_DELAY_MS || 0);
const VERBOSE = process.env.EXAWATT_TYPOGRAPHY_VERBOSE === '1';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const browser = await chromium.launch({
  headless: HEADLESS,
  ...(await resolveQaBrowserLaunchOptions(chromium)),
});
const context = await browser.newContext({
  viewport: { width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT },
  deviceScaleFactor: DEVICE_SCALE_FACTOR,
  colorScheme: 'light',
  reducedMotion: 'no-preference',
});
const page = await context.newPage();
page.setDefaultTimeout(30_000);

if (THEME_ID) {
  await page.addInitScript(
    ({ key, themeId, interfaceFont, interfaceScale }) => {
      localStorage.setItem(
        key,
        JSON.stringify({
          schemaVersion: 1,
          selection: { mode: 'manual', themeId },
          autoPair: {
            lightThemeId: 'exawatt-air-light',
            darkThemeId: 'exawatt-night-dark',
          },
          accentSource: 'theme',
          interfaceFont,
          interfaceScale,
          contrast: 'system',
          transparency: 'system',
        })
      );
    },
    {
      key: 'exawatt.appearance.v1',
      themeId: THEME_ID,
      interfaceFont: INTERFACE_FONT,
      interfaceScale: INTERFACE_SCALE,
    }
  );
}

if (FONT_DELAY_MS > 0) {
  await page.route('**/*.woff2', async route => {
    await new Promise(resolve => setTimeout(resolve, FONT_DELAY_MS));
    await route.continue();
  });
}

await page.addInitScript(() => {
  const state = {
    startedAt: performance.now(),
    previous: '',
    changes: [],
    mutations: [],
    fontEvents: [],
  };
  window.__exaTypographyEarlyProbe = state;
  window.__resetExaTypographyEarlyProbe = () => {
    state.startedAt = performance.now();
    state.previous = '';
    state.changes.length = 0;
    state.mutations.length = 0;
    state.fontEvents.length = 0;
  };

  const elapsed = () => Math.round(performance.now() - state.startedAt);
  const readElement = selector => {
    const element = document.querySelector(selector);
    if (!(element instanceof HTMLElement)) return null;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return {
      fontFamily: style.fontFamily,
      fontSize: style.fontSize,
      lineHeight: style.lineHeight,
      width: Number(rect.width.toFixed(3)),
      height: Number(rect.height.toFixed(3)),
    };
  };
  const read = () => {
    const root = document.documentElement;
    const rootStyle = root ? getComputedStyle(root) : null;
    return {
      elapsedMs: elapsed(),
      readyState: document.readyState,
      firstContentfulPaint:
        performance.getEntriesByName('first-contentful-paint')[0]?.startTime ??
        null,
      theme: root?.dataset.exaTheme ?? null,
      appearance: root?.dataset.exaAppearance ?? null,
      font: root?.dataset.exaFont ?? null,
      typography: root?.dataset.exaTypography ?? null,
      interfaceScale:
        rootStyle?.getPropertyValue('--exa-interface-scale').trim() ?? null,
      interfaceFont:
        rootStyle?.getPropertyValue('--exa-interface-font').trim() ?? null,
      body: document.body
        ? {
            fontFamily: getComputedStyle(document.body).fontFamily,
            fontSize: getComputedStyle(document.body).fontSize,
          }
        : null,
      brand: readElement('#site-header [data-chrome-brand], #site-header a'),
      eyebrow: readElement('main header .font-mono'),
      title: readElement('main h1'),
      summary: readElement('main header p'),
      sectionTitle: readElement('main section h2'),
    };
  };
  const tick = () => {
    const snapshot = read();
    const comparable = JSON.stringify({ ...snapshot, elapsedMs: 0 });
    if (comparable !== state.previous) {
      state.previous = comparable;
      state.changes.push(snapshot);
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  new MutationObserver(records => {
    for (const record of records) {
      if (
        record.type === 'attributes' &&
        (record.target === document.documentElement ||
          record.target === document.body)
      ) {
        state.mutations.push({
          elapsedMs: elapsed(),
          target: record.target === document.documentElement ? 'html' : 'body',
          attribute: record.attributeName,
          value: record.target.getAttribute(record.attributeName),
        });
      }
    }
  }).observe(document, {
    attributes: true,
    attributeFilter: [
      'class',
      'style',
      'data-exa-theme',
      'data-exa-appearance',
      'data-exa-font',
      'data-exa-typography',
    ],
    subtree: true,
  });

  const recordFontEvent = event => {
    state.fontEvents.push({
      elapsedMs: elapsed(),
      type: event.type,
      status: document.fonts.status,
    });
  };
  document.fonts.addEventListener('loading', recordFontEvent);
  document.fonts.addEventListener('loadingdone', recordFontEvent);
  document.fonts.addEventListener('loadingerror', recordFontEvent);
});

const errors = [];
page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
page.on('console', message => {
  if (message.type() === 'error') errors.push(`console: ${message.text()}`);
});

async function sampleTypography(label) {
  await page.waitForSelector('main h1');
  return page.evaluate(
    async ({ label: sampleLabel, duration }) => {
      const selectors = {
        brand: '#site-header [data-chrome-brand], #site-header a',
        eyebrow: 'main header .font-mono',
        title: 'main h1',
        summary: 'main header p',
        sectionTitle: 'main section h2',
      };
      const elements = Object.fromEntries(
        Object.entries(selectors).map(([name, selector]) => [
          name,
          document.querySelector(selector),
        ])
      );
      const root = document.documentElement;
      const changes = [];
      const fontEvents = [];
      const mutations = [];
      const previous = new Map();
      const startedAt = performance.now();

      const recordFontEvent = event => {
        fontEvents.push({
          elapsedMs: Math.round(performance.now() - startedAt),
          type: event.type,
          status: document.fonts.status,
        });
      };
      document.fonts.addEventListener('loading', recordFontEvent);
      document.fonts.addEventListener('loadingdone', recordFontEvent);
      document.fonts.addEventListener('loadingerror', recordFontEvent);

      const observer = new MutationObserver(records => {
        for (const record of records) {
          if (
            record.type === 'attributes' &&
            (record.target === root || record.target === document.body)
          ) {
            mutations.push({
              elapsedMs: Math.round(performance.now() - startedAt),
              target: record.target === root ? 'html' : 'body',
              attribute: record.attributeName,
              value: record.target.getAttribute(record.attributeName),
            });
          }
        }
      });
      observer.observe(document, {
        attributes: true,
        attributeFilter: [
          'class',
          'style',
          'data-exa-theme',
          'data-exa-appearance',
          'data-exa-font',
          'data-exa-typography',
        ],
        subtree: true,
      });

      const readElement = element => {
        if (!(element instanceof HTMLElement)) return null;
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return {
          fontFamily: style.fontFamily,
          fontSize: style.fontSize,
          fontWeight: style.fontWeight,
          lineHeight: style.lineHeight,
          letterSpacing: style.letterSpacing,
          width: Number(rect.width.toFixed(3)),
          height: Number(rect.height.toFixed(3)),
        };
      };

      await new Promise(resolve => {
        const frame = () => {
          const rootStyle = getComputedStyle(root);
          const snapshot = {
            viewport: {
              innerWidth,
              innerHeight,
              devicePixelRatio,
              visualWidth: visualViewport?.width ?? null,
              visualHeight: visualViewport?.height ?? null,
            },
            theme: root.dataset.exaTheme,
            appearance: root.dataset.exaAppearance,
            font: root.dataset.exaFont,
            typography: root.dataset.exaTypography,
            interfaceScale: rootStyle
              .getPropertyValue('--exa-interface-scale')
              .trim(),
            interfaceFont: rootStyle
              .getPropertyValue('--exa-interface-font')
              .trim(),
            fontUi: rootStyle.getPropertyValue('--font-ui').trim(),
            fontsStatus: document.fonts.status,
            elements: Object.fromEntries(
              Object.entries(elements).map(([name, element]) => [
                name,
                readElement(element),
              ])
            ),
          };
          const serialized = JSON.stringify(snapshot);
          if (previous.get('page') !== serialized) {
            previous.set('page', serialized);
            changes.push({
              elapsedMs: Math.round(performance.now() - startedAt),
              ...snapshot,
            });
          }
          if (performance.now() - startedAt >= duration) resolve();
          else requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
      });

      observer.disconnect();
      document.fonts.removeEventListener('loading', recordFontEvent);
      document.fonts.removeEventListener('loadingdone', recordFontEvent);
      document.fonts.removeEventListener('loadingerror', recordFontEvent);
      return {
        label: sampleLabel,
        path: location.pathname,
        changes,
        fontEvents,
        mutations,
      };
    },
    { label, duration: SAMPLE_MS }
  );
}

async function sampleTitleRaster() {
  const title = page.locator('main h1');
  const box = await title.boundingBox();
  assert(box, 'Architecture title has no browser bounding box');
  const clip = {
    x: Math.max(0, Math.floor(box.x)),
    y: Math.max(0, Math.floor(box.y)),
    width: Math.min(VIEWPORT_WIDTH, Math.ceil(box.width)),
    height: Math.ceil(box.height),
  };
  const hashes = [];
  for (let sample = 0; sample < 30; sample += 1) {
    const png = await page.screenshot({ clip, type: 'png' });
    hashes.push(createHash('sha256').update(png).digest('hex'));
    await page.waitForTimeout(16);
  }
  return [...new Set(hashes)];
}

async function sampleThemeChurnIsolation() {
  return page.evaluate(async () => {
    const root = document.documentElement;
    const original = {
      theme: root.dataset.exaTheme,
      typography: root.dataset.exaTypography,
      scale: root.style.getPropertyValue('--exa-interface-scale'),
    };
    const profiles = [
      {
        theme: 'exawatt-air-light',
        typography: 'air',
        scale: '1',
      },
      {
        theme: 'exawatt-classic-dark',
        typography: 'classic',
        scale: '1.2',
      },
      {
        theme: 'exawatt-night-dark',
        typography: 'night',
        scale: '0.9',
      },
    ];
    const selectors = {
      brand: '#site-header [data-chrome-brand], #site-header a',
      eyebrow: 'main header .font-mono',
      title: 'main h1',
      summary: 'main header p',
      sectionTitle: 'main section h2',
    };
    const samples = [];

    try {
      for (const profile of profiles) {
        root.dataset.exaTheme = profile.theme;
        root.dataset.exaTypography = profile.typography;
        root.style.setProperty('--exa-interface-scale', profile.scale);
        await new Promise(resolve =>
          requestAnimationFrame(() => requestAnimationFrame(resolve))
        );
        samples.push({
          profile,
          elements: Object.fromEntries(
            Object.entries(selectors).map(([name, selector]) => {
              const element = document.querySelector(selector);
              if (!(element instanceof HTMLElement)) return [name, null];
              const style = getComputedStyle(element);
              const rect = element.getBoundingClientRect();
              return [
                name,
                {
                  fontFamily: style.fontFamily,
                  fontSize: style.fontSize,
                  lineHeight: style.lineHeight,
                  width: Number(rect.width.toFixed(3)),
                  height: Number(rect.height.toFixed(3)),
                },
              ];
            })
          ),
        });
      }
    } finally {
      if (original.theme) root.dataset.exaTheme = original.theme;
      else delete root.dataset.exaTheme;
      if (original.typography) root.dataset.exaTypography = original.typography;
      else delete root.dataset.exaTypography;
      if (original.scale)
        root.style.setProperty('--exa-interface-scale', original.scale);
      else root.style.removeProperty('--exa-interface-scale');
    }
    return samples;
  });
}

try {
  await page.goto(`${BASE}/`, { waitUntil: 'load' });
  await page.evaluate(() => window.__resetExaTypographyEarlyProbe());
  await page
    .locator('[data-home-architecture-button]')
    .click({ noWaitAfter: true });
  await page.waitForURL('**/architecture');
  const clientNavigation = await sampleTypography('home-to-architecture');
  clientNavigation.rasterHashes = await sampleTitleRaster();
  clientNavigation.themeChurn = await sampleThemeChurnIsolation();
  clientNavigation.early = await page.evaluate(
    () => window.__exaTypographyEarlyProbe
  );

  await page.goto(`${BASE}/architecture`, { waitUntil: 'load' });
  const direct = await sampleTypography('direct');
  direct.rasterHashes = await sampleTitleRaster();
  direct.early = await page.evaluate(() => window.__exaTypographyEarlyProbe);

  const results = [clientNavigation, direct];
  for (const result of results) {
    if (VERBOSE) console.log(JSON.stringify(result, null, 2));
    assert(
      result.changes.length === 1,
      `${result.label} typography changed ${result.changes.length - 1} time(s)`
    );
    assert(
      result.rasterHashes.length === 1,
      `${result.label} title raster changed ${result.rasterHashes.length - 1} time(s)`
    );
    console.log(
      `PASS ${result.label}: one computed state, one title raster across 30 samples`
    );
  }
  const churnSignatures = new Set(
    clientNavigation.themeChurn.map(sample => JSON.stringify(sample.elements))
  );
  assert(
    churnSignatures.size === 1,
    `Architecture typography followed app-theme churn: ${JSON.stringify(clientNavigation.themeChurn)}`
  );
  console.log(
    'PASS Architecture typography ignored Air/Classic/Night font and 90–120% scale churn'
  );
  assert(errors.length === 0, errors.join('\n'));
  console.log('PASS public typography remained stable on every sampled frame');
} finally {
  await browser.close();
}
