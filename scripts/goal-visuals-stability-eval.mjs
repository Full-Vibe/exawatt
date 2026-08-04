#!/usr/bin/env node

/**
 * Frame-level stability probe for the Goal Visuals workbench.
 *
 * Records root appearance inputs, font/layout metrics, image readiness,
 * layout shifts, DOM mutations, active animations, and viewport rasters so an
 * intermittent visual failure can be assigned to its actual owner.
 */

import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { resolveQaBrowserLaunchOptions } from './lib/qa-browser.mjs';

const BASE = (process.env.EXA_BASE || 'http://localhost:7000').replace(
  /\/$/,
  ''
);
const SAMPLE_MS = Number(process.env.EXAWATT_GOAL_VISUALS_SAMPLE_MS || 8_000);
const VERBOSE = process.env.EXAWATT_GOAL_VISUALS_VERBOSE === '1';
const INJECT_RASTERS = process.env.EXAWATT_GOAL_VISUALS_INJECT_RASTERS === '1';
const APPEARANCE_STORM =
  process.env.EXAWATT_GOAL_VISUALS_APPEARANCE_STORM !== '0';
const VIEWPORT = { width: 1440, height: 1000 };

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const browser = await chromium.launch({
  headless: process.env.EXAWATT_GOAL_VISUALS_HEADFUL !== '1',
  ...(await resolveQaBrowserLaunchOptions(chromium)),
});
const context = await browser.newContext({
  viewport: VIEWPORT,
  deviceScaleFactor: 2,
  colorScheme: 'light',
  reducedMotion: 'no-preference',
});
const page = await context.newPage();
page.setDefaultTimeout(30_000);

await page.addInitScript(() => {
  const probe = {
    startedAt: performance.now(),
    rootChanges: [],
    fontEvents: [],
    layoutShifts: [],
    mutations: [],
  };
  window.__exaGoalVisualsProbe = probe;

  const elapsed = () => Math.round(performance.now() - probe.startedAt);
  const readRoot = () => {
    const root = document.documentElement;
    if (!root) return null;
    const style = getComputedStyle(root);
    return {
      elapsedMs: elapsed(),
      theme: root.dataset.exaTheme ?? null,
      appearance: root.dataset.exaAppearance ?? null,
      typography: root.dataset.exaTypography ?? null,
      font: root.dataset.exaFont ?? null,
      scale: style.getPropertyValue('--exa-interface-scale').trim(),
      interfaceFont: style.getPropertyValue('--exa-interface-font').trim(),
      className: root.className,
    };
  };
  let previousRoot = '';
  const tick = () => {
    const snapshot = readRoot();
    const comparable = JSON.stringify(
      snapshot ? { ...snapshot, elapsedMs: 0 } : null
    );
    if (comparable !== previousRoot) {
      previousRoot = comparable;
      if (snapshot) probe.rootChanges.push(snapshot);
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  const recordFontEvent = event => {
    probe.fontEvents.push({
      elapsedMs: elapsed(),
      type: event.type,
      status: document.fonts.status,
    });
  };
  document.fonts.addEventListener('loading', recordFontEvent);
  document.fonts.addEventListener('loadingdone', recordFontEvent);
  document.fonts.addEventListener('loadingerror', recordFontEvent);

  new MutationObserver(records => {
    for (const record of records) {
      if (record.type === 'attributes') {
        const target = record.target;
        if (target === document.documentElement || target === document.body) {
          probe.mutations.push({
            elapsedMs: elapsed(),
            target: target === document.documentElement ? 'html' : 'body',
            attribute: record.attributeName,
            value: target.getAttribute(record.attributeName),
          });
        }
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

  try {
    new PerformanceObserver(list => {
      for (const entry of list.getEntries()) {
        if (!entry.hadRecentInput) {
          probe.layoutShifts.push({
            elapsedMs: elapsed(),
            value: entry.value,
            sources: entry.sources?.map(source => ({
              node:
                source.node instanceof Element
                  ? `${source.node.tagName.toLowerCase()}${source.node.id ? `#${source.node.id}` : ''}${source.node.className ? `.${String(source.node.className).trim().replace(/\s+/g, '.')}` : ''}`
                  : null,
              previousRect: source.previousRect,
              currentRect: source.currentRect,
            })),
          });
        }
      }
    }).observe({ type: 'layout-shift', buffered: true });
  } catch {
    // Older embedded Chromium builds may not expose LayoutShift entries.
  }
});

const errors = [];
const failedRequests = [];
page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
page.on('console', message => {
  if (message.type() === 'error') errors.push(`console: ${message.text()}`);
});
page.on('requestfailed', request => {
  failedRequests.push(
    `${request.method()} ${request.url()} — ${request.failure()?.errorText}`
  );
});

function hash(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function sampleStableState(duration = SAMPLE_MS) {
  return page.evaluate(async sampleDuration => {
    const root = document.documentElement;
    const selectors = {
      pageTitle: 'main h1',
      sectionTitle: 'main section h2',
      specimenTitle: 'article h3',
      tile: '[data-goal-visual-study]',
      goalSummary: '[data-session-goal-summary]',
      nowCopy: '[data-session-current]',
    };
    const states = [];
    let previous = '';
    const startedAt = performance.now();
    const readElement = selector => {
      const element = document.querySelector(selector);
      if (!(element instanceof HTMLElement)) return null;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return {
        fontFamily: style.fontFamily,
        fontSize: style.fontSize,
        lineHeight: style.lineHeight,
        color: style.color,
        background: style.backgroundColor,
        width: Number(rect.width.toFixed(3)),
        height: Number(rect.height.toFixed(3)),
        x: Number(rect.x.toFixed(3)),
        y: Number(rect.y.toFixed(3)),
      };
    };

    await new Promise(resolve => {
      const frame = () => {
        const rootStyle = getComputedStyle(root);
        const snapshot = {
          theme: root.dataset.exaTheme ?? null,
          appearance: root.dataset.exaAppearance ?? null,
          typography: root.dataset.exaTypography ?? null,
          font: root.dataset.exaFont ?? null,
          scale: rootStyle.getPropertyValue('--exa-interface-scale').trim(),
          interfaceFont: rootStyle
            .getPropertyValue('--exa-interface-font')
            .trim(),
          fontsStatus: document.fonts.status,
          imageCount: document.querySelectorAll('[data-goal-visual-study] img')
            .length,
          imageSources: [
            ...document.querySelectorAll('[data-goal-visual-study] img'),
          ]
            .map(image => image.currentSrc || image.getAttribute('src'))
            .map(source => source?.slice(0, 48)),
          status: document.querySelector('main section p')?.textContent?.trim(),
          elements: Object.fromEntries(
            Object.entries(selectors).map(([name, selector]) => [
              name,
              readElement(selector),
            ])
          ),
        };
        const comparable = JSON.stringify(snapshot);
        if (comparable !== previous) {
          previous = comparable;
          states.push({
            elapsedMs: Math.round(performance.now() - startedAt),
            ...snapshot,
          });
        }
        if (performance.now() - startedAt >= sampleDuration) resolve();
        else requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });

    return {
      states,
      animations: document.getAnimations({ subtree: true }).map(animation => ({
        playState: animation.playState,
        currentTime: animation.currentTime,
        target:
          animation.effect?.target instanceof Element
            ? `${animation.effect.target.tagName.toLowerCase()}.${animation.effect.target.className}`
            : null,
        keyframes: animation.effect?.getKeyframes?.(),
      })),
    };
  }, duration);
}

async function sampleAppearanceStorm() {
  const writer = await context.newPage();
  await writer.goto(`${BASE}/`, { waitUntil: 'load' });
  const themes = [
    { themeId: 'exawatt-air-light', scale: 90 },
    { themeId: 'exawatt-classic-dark', scale: 120 },
    { themeId: 'exawatt-night-dark', scale: 100 },
  ];
  const sampling = sampleStableState(4_000);
  for (let index = 0; index < 60; index += 1) {
    const theme = themes[index % themes.length];
    await writer.evaluate(themeSnapshot => {
      localStorage.setItem(
        'exawatt.appearance.v1',
        JSON.stringify({
          schemaVersion: 1,
          selection: { mode: 'manual', themeId: themeSnapshot.themeId },
          autoPair: {
            lightThemeId: 'exawatt-air-light',
            darkThemeId: 'exawatt-night-dark',
          },
          accentSource: 'theme',
          interfaceFont: 'theme',
          interfaceScale: themeSnapshot.scale,
          contrast: 'system',
          transparency: 'system',
        })
      );
    }, theme);
    await new Promise(resolve => setTimeout(resolve, 16));
  }
  await new Promise(resolve => setTimeout(resolve, 400));
  const result = await sampling;
  await writer.close();
  return result;
}

async function auditPage() {
  return page.evaluate(() => {
    const parse = value => {
      const channels = value.match(/[\d.]+/g)?.map(Number) ?? [];
      return {
        r: channels[0] ?? 0,
        g: channels[1] ?? 0,
        b: channels[2] ?? 0,
        a: channels[3] ?? 1,
      };
    };
    const composite = (foreground, background) => ({
      r: foreground.r * foreground.a + background.r * (1 - foreground.a),
      g: foreground.g * foreground.a + background.g * (1 - foreground.a),
      b: foreground.b * foreground.a + background.b * (1 - foreground.a),
      a: 1,
    });
    const luminance = color => {
      const channel = value => {
        const normalized = value / 255;
        return normalized <= 0.04045
          ? normalized / 12.92
          : ((normalized + 0.055) / 1.055) ** 2.4;
      };
      return (
        channel(color.r) * 0.2126 +
        channel(color.g) * 0.7152 +
        channel(color.b) * 0.0722
      );
    };
    const ratio = (left, right) => {
      const values = [luminance(left), luminance(right)].sort((a, b) => b - a);
      return (values[0] + 0.05) / (values[1] + 0.05);
    };
    const bodyBackground = parse(
      getComputedStyle(document.body).backgroundColor
    );
    const summaryContrast = [
      ...document.querySelectorAll('[data-session-goal-summary]'),
    ].map(element => {
      const tile = element.closest('[data-goal-visual-study]');
      const foreground = parse(getComputedStyle(element).color);
      const tileBackground = parse(
        tile ? getComputedStyle(tile).backgroundColor : 'rgb(255, 255, 255)'
      );
      return Number(
        ratio(foreground, composite(tileBackground, bodyBackground)).toFixed(2)
      );
    });
    return {
      summaryContrast,
      headings: [...document.querySelectorAll('h1, h2, h3')].map(element =>
        element.tagName.toLowerCase()
      ),
      decorativeImages: [
        ...document.querySelectorAll('[data-goal-visual-study] img'),
      ].every(image => image.getAttribute('alt') === ''),
    };
  });
}

async function auditNarrowViewport() {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.evaluate(
    () =>
      new Promise(resolve =>
        requestAnimationFrame(() => requestAnimationFrame(resolve))
      )
  );
  const result = await page.evaluate(() => ({
    innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    tiles: [...document.querySelectorAll('[data-goal-visual-study]')].map(
      tile => tile.getBoundingClientRect().width
    ),
    galleryLinkHeight:
      document.querySelector('main header a')?.getBoundingClientRect().height ??
      0,
  }));
  await page.setViewportSize(VIEWPORT);
  await page.evaluate(
    () =>
      new Promise(resolve =>
        requestAnimationFrame(() => requestAnimationFrame(resolve))
      )
  );
  await page.waitForTimeout(250);
  return result;
}

try {
  await page.goto(`${BASE}/hud-gallery/goal-visuals`, { waitUntil: 'load' });
  await page.locator('main h1').waitFor();
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise(resolve =>
      requestAnimationFrame(() => requestAnimationFrame(resolve))
    );
  });
  if (INJECT_RASTERS) {
    await page.evaluate(async () => {
      const response = await fetch('/images/hero-bg.png');
      const bytes = new Uint8Array(await response.arrayBuffer());
      let binary = '';
      const chunkSize = 0x8000;
      for (let index = 0; index < bytes.length; index += chunkSize) {
        binary += String.fromCharCode(
          ...bytes.subarray(index, index + chunkSize)
        );
      }
      const dataUrl = `data:image/png;base64,${btoa(binary)}`;
      const frames = [...document.querySelectorAll('[data-goal-visual-study]')];
      for (const [index, frame] of frames.entries()) {
        const image = document.createElement('img');
        image.alt = '';
        image.src = dataUrl;
        image.dataset.injectedGoalVisual = String(index);
        Object.assign(image.style, {
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          filter: 'saturate(0.48) contrast(1.1) brightness(0.98)',
          opacity: index === 0 ? '0.24' : '0.38',
          transform: index === 0 ? 'scale(1.035)' : 'none',
        });
        frame.append(image);
      }
    });
  }
  const arrivalRasterHashes = [];
  if (INJECT_RASTERS) {
    for (let index = 0; index < 60; index += 1) {
      arrivalRasterHashes.push(
        hash(await page.screenshot({ type: 'png', animations: 'allow' }))
      );
      await page.waitForTimeout(16);
    }
  }
  const sampled = await sampleStableState();
  const audit = await auditPage();
  const appearanceStorm = APPEARANCE_STORM
    ? await sampleAppearanceStorm()
    : null;
  const narrowViewport = await auditNarrowViewport();
  const artifactDir = resolve('.artifacts/goal-visuals-stability');
  await mkdir(artifactDir, { recursive: true });
  await page.screenshot({
    path: resolve(artifactDir, 'steady-state.png'),
    type: 'png',
    fullPage: true,
    animations: 'allow',
  });
  const rasterHashes = [];
  const titleRasterHashes = [];
  const rasterExamples = new Map();
  const main = page.locator('main');
  const title = page.locator('main h1');
  // The first full-main capture allocates the offscreen raster surface. It is
  // a browser instrumentation warm-up, not a user-visible frame.
  await main.screenshot({ type: 'png', animations: 'allow' });
  await page.waitForTimeout(100);
  for (let index = 0; index < 30; index += 1) {
    const png = await main.screenshot({ type: 'png', animations: 'allow' });
    const rasterHash = hash(png);
    rasterHashes.push(rasterHash);
    titleRasterHashes.push(
      hash(await title.screenshot({ type: 'png', animations: 'allow' }))
    );
    if (!rasterExamples.has(rasterHash)) {
      rasterExamples.set(rasterHash, rasterExamples.size);
      await writeFile(
        resolve(artifactDir, `raster-${rasterExamples.size}.png`),
        png
      );
    }
    await page.waitForTimeout(33);
  }
  const result = {
    path: new URL(page.url()).pathname,
    sampled,
    audit,
    narrowViewport,
    appearanceStorm,
    uniqueArrivalRasterHashes: [...new Set(arrivalRasterHashes)],
    uniqueRasterHashes: [...new Set(rasterHashes)],
    uniqueTitleRasterHashes: [...new Set(titleRasterHashes)],
    early: await page.evaluate(() => window.__exaGoalVisualsProbe),
    errors,
    failedRequests,
  };

  if (VERBOSE) console.log(JSON.stringify(result, null, 2));
  console.log(
    `Goal Visuals: ${sampled.states.length} steady computed state(s), ` +
      `${result.uniqueRasterHashes.length} viewport raster(s), ` +
      `${result.uniqueTitleRasterHashes.length} title raster(s), ` +
      `${result.uniqueArrivalRasterHashes.length} arrival raster(s), ` +
      `${sampled.animations.length} active animation(s), ` +
      `${result.early.rootChanges.length} root state(s), ` +
      `${result.early.layoutShifts.length} layout shift(s)`
  );
  console.log(
    `Audit: Air goal-copy contrast ${Math.min(...audit.summaryContrast).toFixed(2)}:1 minimum; ` +
      `320px scroll width ${narrowViewport.scrollWidth}px; ` +
      `gallery target ${narrowViewport.galleryLinkHeight}px`
  );
  if (errors.length) console.log(`Browser errors:\n${errors.join('\n')}`);
  if (appearanceStorm) {
    const rootSignatures = new Set(
      appearanceStorm.states.map(state =>
        JSON.stringify({
          theme: state.theme,
          typography: state.typography,
          scale: state.scale,
          font: state.interfaceFont,
        })
      )
    );
    const titleMetricSignatures = new Set(
      appearanceStorm.states.map(state =>
        JSON.stringify({
          fontFamily: state.elements.pageTitle?.fontFamily,
          fontSize: state.elements.pageTitle?.fontSize,
          lineHeight: state.elements.pageTitle?.lineHeight,
          width: state.elements.pageTitle?.width,
          height: state.elements.pageTitle?.height,
          x: state.elements.pageTitle?.x,
          y: state.elements.pageTitle?.y,
        })
      )
    );
    console.log(
      `Appearance storm: ${rootSignatures.size} root snapshot(s), ` +
        `${titleMetricSignatures.size} title metric state(s), ` +
        `${appearanceStorm.states.length} total computed state(s) from 60 valid cross-tab preference writes`
    );
    if (VERBOSE) console.log(JSON.stringify(appearanceStorm.states, null, 2));
  }
  assert(
    sampled.states.length === 1,
    `Goal Visuals changed ${sampled.states.length - 1} time(s) while idle`
  );
  assert(
    result.uniqueRasterHashes.length <= 2,
    `Goal Visuals produced ${result.uniqueRasterHashes.length} materially different idle rasters`
  );
  assert(
    result.uniqueTitleRasterHashes.length === 1,
    `Goal Visuals title produced ${result.uniqueTitleRasterHashes.length} idle rasters`
  );
  assert(
    sampled.animations.length === 0,
    `Goal Visuals has ${sampled.animations.length} unintended active animation(s)`
  );
  assert(
    audit.summaryContrast.length === 9 &&
      audit.summaryContrast.every(ratio => ratio >= 4.5),
    `Goal summary contrast failed AA: ${audit.summaryContrast.join(', ')}`
  );
  assert(
    audit.decorativeImages,
    'Goal Visuals includes a decorative raster without empty alt text'
  );
  assert(
    narrowViewport.tiles.length === 9 &&
      narrowViewport.tiles.every(
        width => width > 0 && width <= narrowViewport.innerWidth
      ) &&
      narrowViewport.scrollWidth <= narrowViewport.innerWidth,
    `Goal Visuals overflowed at 320px: ${JSON.stringify(narrowViewport)}`
  );
  assert(
    narrowViewport.galleryLinkHeight >= 44,
    `Goal Visuals touch targets failed at 320px: ${JSON.stringify(narrowViewport)}`
  );
  if (appearanceStorm) {
    const rootSignatures = new Set(
      appearanceStorm.states.map(state =>
        JSON.stringify({
          theme: state.theme,
          typography: state.typography,
          scale: state.scale,
          font: state.interfaceFont,
        })
      )
    );
    const titleMetricSignatures = new Set(
      appearanceStorm.states.map(state =>
        JSON.stringify({
          fontFamily: state.elements.pageTitle?.fontFamily,
          fontSize: state.elements.pageTitle?.fontSize,
          lineHeight: state.elements.pageTitle?.lineHeight,
          width: state.elements.pageTitle?.width,
          height: state.elements.pageTitle?.height,
          x: state.elements.pageTitle?.x,
          y: state.elements.pageTitle?.y,
        })
      )
    );
    assert(
      rootSignatures.size <= 2,
      `Appearance storm published ${rootSignatures.size} root snapshots`
    );
    assert(
      titleMetricSignatures.size <= 2,
      `Appearance storm produced ${titleMetricSignatures.size} title layouts`
    );
  }
  assert(errors.length === 0, errors.join('\n'));
  console.log(
    `PASS Goal Visuals stability, Air contrast, and 320px responsive audit`
  );
  if (failedRequests.length)
    console.log(`Failed requests:\n${failedRequests.join('\n')}`);
} finally {
  await browser.close();
}
