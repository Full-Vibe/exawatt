#!/usr/bin/env node
/**
 * Opt-in D55 interaction timing evaluator.
 *
 * This is a visible Electron development-tree baseline, not a production
 * observer and not a landing gate. It drives real live shell panes through the
 * existing command layer, samples the first rendered frame that exposes the
 * expected state, and records intentional transition settle time separately.
 *
 * Usage:
 *   pnpm dev -p 7027
 *   EXA_BASE=http://localhost:7027 pnpm eval:electron:interaction-performance
 *
 * Packaged-equivalent renderer control:
 *   pnpm build && pnpm electron:prepare-renderer
 *   HOSTNAME=127.0.0.1 PORT=7028 node dist-renderer/server.js
 *   EXA_BASE=http://127.0.0.1:7028 \
 *     INTERACTION_PERF_RENDERER=packaged-equivalent \
 *     pnpm eval:electron:interaction-performance
 */

import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { withElectronApp } from './lib/electron-eval.mjs';

const SCHEMA_VERSION = 1;
const ACK_BUDGET_MS = 80;
const DEFAULT_RUNS = 5;
const base = process.env.EXA_BASE ?? 'http://localhost:7000';
const requestedRuns = Number.parseInt(
  process.env.INTERACTION_PERF_RUNS ?? String(DEFAULT_RUNS),
  10
);
const runs = Number.isFinite(requestedRuns)
  ? Math.min(20, Math.max(3, requestedRuns))
  : DEFAULT_RUNS;
const windowMode = process.env.EXAWATT_WINDOW_MODE ?? 'inactive';
const rendererKind =
  process.env.INTERACTION_PERF_RENDERER ?? 'development-tree';
if (!['inactive', 'foreground'].includes(windowMode)) {
  throw new Error(
    'Interaction timing requires a visible Electron window: ' +
      'EXAWATT_WINDOW_MODE must be inactive or foreground.'
  );
}

const fixtureRoot = mkdtempSync(
  join(tmpdir(), 'exawatt-interaction-performance-')
);
const userData = join(fixtureRoot, 'userData');
const projectDir = join(fixtureRoot, 'project');
const outputPath = resolve(
  process.env.INTERACTION_PERF_OUTPUT ??
    join(
      '.artifacts',
      'interaction-performance',
      `report-${new Date().toISOString().replaceAll(':', '-')}.json`
    )
);
mkdirSync(userData, { recursive: true });
mkdirSync(projectDir, { recursive: true });
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(join(projectDir, 'package.json'), '{}\n');

function round(value) {
  return Math.round(value * 10) / 10;
}

function percentile(values, percentage) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * percentage;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return round(sorted[lower]);
  return round(
    sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower)
  );
}

function summarize(samples, refreshIntervalMs) {
  const acknowledgments = samples.map(sample => sample.acknowledgmentMs);
  const settles = samples.map(sample => sample.settleMs);
  const frameIntervals = samples.flatMap(sample => sample.frameIntervalsMs);
  const missedFrameThresholdMs = Math.max(
    refreshIntervalMs * 1.5,
    refreshIntervalMs + 4
  );
  const repeatedMisses = acknowledgments.filter(
    value => value > ACK_BUDGET_MS
  ).length;
  const missedFramesByRun = samples.map(
    sample =>
      sample.frameIntervalsMs.filter(value => value > missedFrameThresholdMs)
        .length
  );
  return {
    runs: samples.length,
    acknowledgmentMedianMs: percentile(acknowledgments, 0.5),
    acknowledgmentP95Ms: percentile(acknowledgments, 0.95),
    settleMedianMs: percentile(settles, 0.5),
    settleP95Ms: percentile(settles, 0.95),
    frameIntervalP95Ms: percentile(frameIntervals, 0.95),
    maxFrameIntervalMs:
      frameIntervals.length > 0 ? round(Math.max(...frameIntervals)) : null,
    missedFrameThresholdMs: round(missedFrameThresholdMs),
    missedFrameCount: frameIntervals.filter(
      value => value > missedFrameThresholdMs
    ).length,
    runsWithMissedFrames: missedFramesByRun.filter(count => count > 0).length,
    maxMissedFramesPerRun: Math.max(...missedFramesByRun),
    sampledFrameCount: frameIntervals.length,
    acknowledgmentBudgetMs: ACK_BUDGET_MS,
    acknowledgmentBudgetMisses: repeatedMisses,
    // A lone slow sample on a five-run development baseline is evidence to
    // rerun, not permission to refactor. Require both the p95 miss and a
    // repeated miss before calling the gesture a remediation candidate.
    remediationCandidate:
      percentile(acknowledgments, 0.95) > ACK_BUDGET_MS &&
      repeatedMisses >= Math.ceil(samples.length * 0.4),
  };
}

async function sampleRefreshInterval(page) {
  return await page.evaluate(async () => {
    const intervals = await new Promise(resolve => {
      const values = [];
      let previous = null;
      const tick = now => {
        if (previous !== null) values.push(now - previous);
        previous = now;
        if (values.length >= 30) resolve(values);
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    const bounded = intervals
      .filter(value => value > 2 && value < 50)
      .sort((a, b) => a - b);
    const values =
      bounded.length > 0 ? bounded : intervals.sort((a, b) => a - b);
    return Math.round(values[Math.floor(values.length / 2)] * 10) / 10;
  });
}

async function measureGesture(page, gesture, refreshIntervalMs) {
  return await page.evaluate(
    async ({ gesture, refreshIntervalMs }) => {
      const cssEscape = value =>
        globalThis.CSS?.escape
          ? globalThis.CSS.escape(value)
          : value.replaceAll('"', '\\"');
      const altitudeIs = altitude =>
        document
          .querySelector(`[data-command-altitude-level="${altitude}"]`)
          ?.getAttribute('aria-current') === 'page';
      const terminalHasFocus = () =>
        document.activeElement?.classList.contains('xterm-helper-textarea') ===
        true;
      const activeTransitions = roots => {
        if (typeof globalThis.CSSTransition === 'undefined') return 0;
        return roots
          .filter(Boolean)
          .flatMap(root => root.getAnimations({ subtree: true }))
          .filter(
            animation =>
              animation instanceof globalThis.CSSTransition &&
              (animation.playState === 'running' || animation.pending)
          ).length;
      };
      const stageSettled = () => {
        const stage = document.querySelector('[data-workspace-stage]');
        if (!stage) return false;
        const style = getComputedStyle(stage);
        const transform = style.transform;
        return (
          Number.parseFloat(style.opacity) >= 0.99 &&
          (transform === 'none' || transform === 'matrix(1, 0, 0, 1, 0, 0)') &&
          activeTransitions([stage]) === 0
        );
      };
      const selectedTeamTileFocused = () => {
        const selected = document.querySelector(
          '[data-expose-tile][data-selected="true"]'
        );
        return selected !== null && selected === document.activeElement;
      };

      const action = () => {
        if (gesture.name === 'agent-tab-switch') {
          const tab = document.querySelector(
            `[data-tab-id="${cssEscape(gesture.targetTabId)}"] [data-tab-chrome]`
          );
          if (!(tab instanceof HTMLElement))
            throw new Error('Target tab missing');
          tab.click();
          return;
        }
        if (gesture.name === 'agent-to-team') {
          const button = document.querySelector(
            '[data-command-altitude-level="sessions"]'
          );
          if (!(button instanceof HTMLElement))
            throw new Error('Team control missing');
          button.click();
          return;
        }
        if (gesture.name === 'team-to-agent') {
          const tile = document.querySelector(
            '[data-expose-tile][data-selected="true"]'
          );
          if (!(tile instanceof HTMLElement))
            throw new Error('Selected Team tile missing');
          tile.click();
          return;
        }
        if (gesture.name === 'team-to-fleet-warm') {
          const button = document.querySelector(
            '[data-command-altitude-level="spatial"]'
          );
          if (!(button instanceof HTMLElement))
            throw new Error('Fleet control missing');
          button.click();
          return;
        }
        throw new Error(`Unknown gesture ${gesture.name}`);
      };

      const acknowledged = () => {
        if (gesture.name === 'agent-tab-switch') {
          return (
            document
              .querySelector(
                `[data-tab-id="${cssEscape(gesture.targetTabId)}"]`
              )
              ?.getAttribute('data-active') === 'true'
          );
        }
        if (gesture.name === 'agent-to-team') {
          return document.querySelector('[data-expose]') !== null;
        }
        if (gesture.name === 'team-to-agent') {
          return document.querySelector('[data-expose]') === null;
        }
        return (
          document.querySelector(
            '[data-altitude-handoff], [data-command-transition-target="spatial"]'
          ) !== null || window.location.pathname.startsWith('/fleet/spatial')
        );
      };

      const settled = () => {
        if (gesture.name === 'agent-tab-switch') {
          return acknowledged() && terminalHasFocus();
        }
        if (gesture.name === 'agent-to-team') {
          const expose = document.querySelector('[data-expose]');
          if (!expose) return false;
          return (
            altitudeIs('sessions') &&
            Number.parseFloat(getComputedStyle(expose).opacity) >= 0.99 &&
            selectedTeamTileFocused() &&
            activeTransitions([
              expose,
              document.querySelector('[data-workspace-stage]'),
            ]) === 0
          );
        }
        if (gesture.name === 'team-to-agent') {
          return (
            acknowledged() &&
            altitudeIs('terminal') &&
            stageSettled() &&
            terminalHasFocus()
          );
        }
        return (
          window.location.pathname.startsWith('/fleet/spatial') &&
          altitudeIs('spatial') &&
          document.querySelector('[data-spatial-command] canvas') !== null &&
          document.querySelector(
            '[data-altitude-handoff], [data-command-transition]'
          ) === null
        );
      };

      return await new Promise((resolve, reject) => {
        let startedAt = 0;
        let previousFrame = 0;
        let acknowledgmentMs = null;
        let stableFrames = 0;
        const frameIntervalsMs = [];
        const timeoutMs = gesture.name === 'team-to-fleet-warm' ? 8_000 : 4_000;

        const sample = now => {
          frameIntervalsMs.push(now - previousFrame);
          previousFrame = now;
          if (acknowledgmentMs === null && acknowledged()) {
            acknowledgmentMs = now - startedAt;
          }
          if (acknowledgmentMs !== null && settled()) stableFrames += 1;
          else stableFrames = 0;

          if (stableFrames >= 2) {
            resolve({
              acknowledgmentMs: Math.round(acknowledgmentMs * 10) / 10,
              settleMs: Math.round((now - startedAt) * 10) / 10,
              frameIntervalsMs: frameIntervalsMs.map(
                value => Math.round(value * 10) / 10
              ),
              refreshIntervalMs,
            });
            return;
          }
          if (now - startedAt > timeoutMs) {
            reject(
              new Error(
                `${gesture.name} did not settle within ${timeoutMs}ms ` +
                  `(acknowledged=${acknowledgmentMs !== null}, ` +
                  `path=${window.location.pathname})`
              )
            );
            return;
          }
          requestAnimationFrame(sample);
        };

        // Start on a frame boundary so first acknowledgment is a stable
        // input-to-next-observable-frame proxy rather than event-loop phase.
        requestAnimationFrame(() => {
          startedAt = performance.now();
          previousFrame = startedAt;
          try {
            action();
          } catch (error) {
            reject(error);
            return;
          }
          requestAnimationFrame(sample);
        });
      });
    },
    { gesture, refreshIntervalMs }
  );
}

async function waitForSessionCount(page, count) {
  await page.waitForFunction(
    async expected =>
      ((await window.electron?.pty?.list()) ?? []).length === expected,
    count
  );
  await page
    .locator('[data-tab-id]')
    .nth(count - 1)
    .waitFor();
  await page
    .locator('.xterm-helper-textarea')
    .nth(count - 1)
    .waitFor();
}

async function waitForTeam(page) {
  await page.locator('[data-expose]').waitFor();
  await page.waitForFunction(() => {
    const expose = document.querySelector('[data-expose]');
    const selected = document.querySelector(
      '[data-expose-tile][data-selected="true"]'
    );
    const roots = [
      expose,
      document.querySelector('[data-workspace-stage]'),
    ].filter(Boolean);
    const transitions =
      typeof globalThis.CSSTransition === 'undefined'
        ? []
        : roots
            .flatMap(root => root.getAnimations({ subtree: true }))
            .filter(
              animation =>
                animation instanceof globalThis.CSSTransition &&
                (animation.playState === 'running' || animation.pending)
            );
    return (
      expose &&
      Number.parseFloat(getComputedStyle(expose).opacity) >= 0.99 &&
      selected === document.activeElement &&
      transitions.length === 0 &&
      document.querySelector('[data-command-transition]') === null
    );
  });
}

async function waitForFleet(page) {
  await page.waitForURL('**/fleet/spatial**');
  await page.locator('[data-spatial-command] canvas').waitFor();
  await page.waitForFunction(
    () =>
      document.querySelector(
        '[data-altitude-handoff], [data-command-transition]'
      ) === null
  );
}

async function returnToTeam(page) {
  await page
    .locator('[data-command-altitude-level="sessions"]')
    .evaluate(button => button.click());
  await waitForTeam(page);
}

async function returnToAgent(page) {
  await page
    .locator('[data-expose-tile][data-selected="true"]')
    .evaluate(tile => tile.click());
  await page.locator('[data-expose]').waitFor({ state: 'detached' });
  await page.waitForFunction(() => {
    const stage = document.querySelector('[data-workspace-stage]');
    const terminal = document.querySelector(
      '[data-command-altitude-level="terminal"]'
    );
    if (!stage || terminal?.getAttribute('aria-current') !== 'page') {
      return false;
    }
    const style = getComputedStyle(stage);
    const transform = style.transform;
    const transitions =
      typeof globalThis.CSSTransition === 'undefined'
        ? []
        : stage
            .getAnimations({ subtree: true })
            .filter(
              animation =>
                animation instanceof globalThis.CSSTransition &&
                (animation.playState === 'running' || animation.pending)
            );
    return (
      Number.parseFloat(style.opacity) >= 0.99 &&
      (transform === 'none' || transform === 'matrix(1, 0, 0, 1, 0, 0)') &&
      transitions.length === 0 &&
      document.activeElement?.classList.contains('xterm-helper-textarea')
    );
  });
}

const packageVersion = JSON.parse(
  readFileSync(resolve('package.json'), 'utf8')
).version;
const gitSha = execFileSync('git', ['rev-parse', 'HEAD'], {
  encoding: 'utf8',
}).trim();

try {
  const report = await withElectronApp(
    {
      args: ['.'],
      cwd: process.cwd(),
      env: {
        ...process.env,
        NODE_ENV: 'development',
        EXAWATT_TEST: '1',
        EXAWATT_USER_DATA: userData,
        EXAWATT_TEST_QUIT_RESPONSES: 'confirm',
        EXAWATT_WINDOW_MODE: windowMode,
        EXAWATT_DEV_URL: `${base}/workspace`,
      },
    },
    async (app, page) => {
      page.setDefaultTimeout(30_000);
      const pageErrors = [];
      page.on('pageerror', error =>
        pageErrors.push(String(error.message || error))
      );
      await page.locator('[data-command-altitude]').waitFor();
      await page.evaluate(dir => {
        window.dispatchEvent(
          new CustomEvent('exawatt:open-project', { detail: dir })
        );
      }, projectDir);
      await page.locator('[data-agent-composer]').waitFor();

      // The registry-owned direct Shell chord is deterministic and does not
      // wait for unrelated source/model discovery in the New-Agent launcher.
      await page.keyboard.press('Meta+Alt+KeyT');
      await waitForSessionCount(page, 1);
      await page.keyboard.press('Meta+Alt+KeyT');
      await waitForSessionCount(page, 2);
      await page.waitForTimeout(400);

      const display = await page.evaluate(() => ({
        visibilityState: document.visibilityState,
        documentHasFocus: document.hasFocus(),
        devicePixelRatio: window.devicePixelRatio,
        viewport: { width: window.innerWidth, height: window.innerHeight },
        reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)')
          .matches,
        userAgent: navigator.userAgent,
      }));
      const runtime = await app.evaluate(({ app }) => ({
        appVersion: app.getVersion(),
        electron: process.versions.electron,
        chromium: process.versions.chrome,
      }));
      const refreshIntervalMs = await sampleRefreshInterval(page);
      const raw = {
        'agent-tab-switch': [],
        'agent-to-team': [],
        'team-to-agent': [],
        'team-to-fleet-warm': [],
      };

      // Warm the Team subtree and same-route URL transition before measuring.
      // A development server's first compilation is not product interaction
      // latency and D55's bounded packet explicitly targets warm gestures.
      await page
        .locator('[data-command-altitude-level="sessions"]')
        .evaluate(button => button.click());
      await waitForTeam(page);
      await returnToAgent(page);

      for (let index = 0; index < runs; index += 1) {
        const targetTabId = await page.evaluate(() =>
          document
            .querySelector('[data-tab-id]:not([data-active="true"])')
            ?.getAttribute('data-tab-id')
        );
        if (!targetTabId) throw new Error('No inactive Agent tab to switch to');
        raw['agent-tab-switch'].push(
          await measureGesture(
            page,
            { name: 'agent-tab-switch', targetTabId },
            refreshIntervalMs
          )
        );
      }

      for (let index = 0; index < runs; index += 1) {
        raw['agent-to-team'].push(
          await measureGesture(
            page,
            { name: 'agent-to-team' },
            refreshIntervalMs
          )
        );
        raw['team-to-agent'].push(
          await measureGesture(
            page,
            { name: 'team-to-agent' },
            refreshIntervalMs
          )
        );
      }

      // One unmeasured round trip warms the Next module and WebGL program
      // path. D55 treats this as a warm gesture; it does not disguise the
      // product's intentional 460ms identity handoff as input latency.
      await page
        .locator('[data-command-altitude-level="sessions"]')
        .evaluate(button => button.click());
      await waitForTeam(page);
      await page
        .locator('[data-command-altitude-level="spatial"]')
        .evaluate(button => button.click());
      await waitForFleet(page);
      await returnToTeam(page);

      for (let index = 0; index < runs; index += 1) {
        raw['team-to-fleet-warm'].push(
          await measureGesture(
            page,
            { name: 'team-to-fleet-warm' },
            refreshIntervalMs
          )
        );
        if (index < runs - 1) await returnToTeam(page);
      }

      // Leave checkpoint ownership on the Agent route for coordinated quit.
      await page
        .locator('[data-command-altitude-level="terminal"]')
        .evaluate(button => button.click());
      await page.waitForURL('**/workspace');
      await page.locator('[data-workspace-stage]').waitFor();

      if (pageErrors.length > 0) {
        throw new Error(`Electron page errors: ${pageErrors.join(' | ')}`);
      }
      const summary = Object.fromEntries(
        Object.entries(raw).map(([name, samples]) => [
          name,
          summarize(samples, refreshIntervalMs),
        ])
      );
      return {
        schemaVersion: SCHEMA_VERSION,
        measuredAt: new Date().toISOString(),
        source: {
          gitSha,
          packageVersion,
          renderer: rendererKind,
        },
        environment: {
          ...runtime,
          ...display,
          platform: process.platform,
          architecture: process.arch,
          windowMode,
          refreshIntervalMs,
        },
        fixture: {
          source: 'live-shell',
          projects: 1,
          sessions: 2,
          warm: true,
        },
        policy: {
          provisionalAcknowledgmentBudgetMs: ACK_BUDGET_MS,
          settleIncludesTwoStableFrames: true,
          remediationRequiresProductionRenderer: true,
          defaultLandingGate: false,
          marketingEvidence: false,
        },
        summary,
        raw,
      };
    },
    { maxMs: 240_000, firstWindowMs: 45_000 }
  );

  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  for (const [name, result] of Object.entries(report.summary)) {
    const verdict = result.remediationCandidate
      ? report.source.renderer === 'development-tree'
        ? 'RERUN-PRODUCTION'
        : 'INVESTIGATE'
      : 'PASS';
    console.log(
      `${verdict} ${name}: ack median/p95 ` +
        `${result.acknowledgmentMedianMs}/${result.acknowledgmentP95Ms}ms; ` +
        `settle median/p95 ${result.settleMedianMs}/${result.settleP95Ms}ms; ` +
        `missed frames ${result.missedFrameCount}/${result.sampledFrameCount}`
    );
  }
  console.log(`Report: ${outputPath}`);
} finally {
  rmSync(fixtureRoot, { recursive: true, force: true });
}
