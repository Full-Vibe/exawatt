// Opt-in diagnostic, not a delivery gate. See the D70 cold-renderer evidence
// in docs/engineering/projects/daily-driver-adoption.md. Fixtures never send
// an agent turn; timing is reported, never asserted against the host.
import {
  mkdtempSync,
  mkdirSync,
  chmodSync,
  writeFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir, loadavg, cpus } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
// Run from the bootstrapped repository root against its own staged renderer.
// COMPOSER_PROBE_STAGED_SHA must be the SHA recorded at build time, not the
// checkout SHA at probe invocation (other work may land between those steps).
const repo = process.cwd();
const stagedRendererGitSha = process.env.COMPOSER_PROBE_STAGED_SHA;
if (!stagedRendererGitSha || !/^[a-f0-9]{40}$/.test(stagedRendererGitSha))
  throw new Error(
    'Set COMPOSER_PROBE_STAGED_SHA to the full SHA recorded when this renderer was built.'
  );
const outputPath =
  process.env.COMPOSER_PROBE_OUTPUT ??
  join(
    repo,
    '.artifacts',
    'interaction-performance',
    'cold-composer-report.json'
  );
mkdirSync(dirname(outputPath), { recursive: true });
const { withElectronApp } = await import(
  pathToFileURL(join(repo, 'scripts/lib/electron-eval.mjs')).href
);
const root = mkdtempSync(join(tmpdir(), 'exawatt-cold-composer-'));
const userData = join(root, 'userData');
const fakeBin = join(root, 'bin');
const projects = [0, 1, 2].map(i => join(root, `project-${i}`));
for (const dir of [userData, fakeBin, ...projects])
  mkdirSync(dir, { recursive: true });
for (const dir of projects) writeFileSync(join(dir, 'package.json'), '{}');
const claudeRoot = join(root, 'claude-projects'),
  codexRoot = join(root, 'codex-sessions'),
  grokRoot = join(root, 'grok-sessions');
for (const dir of [claudeRoot, codexRoot, grokRoot])
  mkdirSync(dir, { recursive: true });
for (let pi = 0; pi < projects.length; pi++) {
  const cwd = projects[pi];
  const history = join(claudeRoot, cwd.replace(/[^a-zA-Z0-9_-]/g, '-'));
  mkdirSync(history, { recursive: true });
  for (let i = 0; i < 300; i++) {
    const id = `1000000${pi}-0000-4000-8000-${String(i).padStart(12, '0')}`;
    const timestamp = new Date(Date.now() - i * 60000).toISOString();
    writeFileSync(
      join(history, `${id}.jsonl`),
      JSON.stringify({
        sessionId: id,
        cwd,
        type: 'user',
        timestamp,
        message: {
          role: 'user',
          content: `Fixture task ${pi}/${i}: improve a local module.`,
        },
      }) + '\n'
    );
    writeFileSync(
      join(codexRoot, `rollout-${pi}-${i}.jsonl`),
      [
        JSON.stringify({
          type: 'session_meta',
          payload: { id, session_id: id, cwd, timestamp },
        }),
        JSON.stringify({
          type: 'response_item',
          payload: {
            role: 'user',
            content: [
              {
                type: 'input_text',
                text: `Fixture task ${pi}/${i}: improve local behavior.`,
              },
            ],
          },
        }),
      ].join('\n') + '\n'
    );
  }
}

for (const source of ['claude', 'codex']) {
  const executable = join(fakeBin, source);
  writeFileSync(
    executable,
    `#!/bin/sh
if [ "$1" = "debug" ] && [ "$2" = "models" ]; then
  printf '%s\\n' '{"models":[{"slug":"eval-codex-sol","display_name":"Eval Codex Sol","description":"Frontier evaluator model.","visibility":"list","priority":1,"default_reasoning_level":"low","supported_reasoning_levels":[{"effort":"low","description":"Fast evaluator reasoning."},{"effort":"high","description":"Deep evaluator reasoning."},{"effort":"max","description":"Maximum evaluator reasoning."}]},{"slug":"eval-codex-terra","display_name":"Eval Codex Terra","description":"Balanced evaluator model.","visibility":"list","priority":2,"default_reasoning_level":"medium","supported_reasoning_levels":[{"effort":"low","description":"Fast evaluator reasoning."},{"effort":"medium","description":"Balanced evaluator reasoning."},{"effort":"high","description":"Deep evaluator reasoning."},{"effort":"max","description":"Maximum evaluator reasoning."}]}]}'
  exit 0
fi
if [ "$1" = "--safe-mode" ]; then
  printf '%s\\n' '{"type":"control_response","response":{"subtype":"success","request_id":"exawatt-model-catalog","response":{"models":[{"value":"default","displayName":"Account default","description":"Claude Code chooses the recommended model for your account.","supportsEffort":true,"supportedEffortLevels":["low","medium","high","xhigh","max"]},{"value":"eval-claude-fable","displayName":"Eval Claude Fable","description":"Frontier evaluator model.","supportsEffort":true,"supportedEffortLevels":["high","max"]}]}}}'
  exit 0
fi
if [ "$1" = "--version" ]; then
  printf '${source === 'claude' ? '2.1.220 (Claude Code)' : 'codex-cli 0.146.0'}\\n'
  exit 0
fi
if [ "$1" = "auth" ] && [ "$2" = "status" ]; then
  printf '%s\\n' '{"loggedIn":true,"email":"operator@example.com","subscriptionType":"max"}'
  exit 0
fi
if [ "$1" = "login" ] && [ "$2" = "status" ]; then
  printf 'Logged in using ChatGPT\\n'
  exit 0
fi
if [ "$1" = "-p" ]; then printf 'fixture context'; exit 0; fi
printf 'FAKE_${source.toUpperCase()}_ARGS:'
printf '<%s>' "$@"
printf '\n'
while true; do
  if IFS= read -r line; then printf '%s\n' "$line"; else /bin/sleep 1; fi
done
`
  );
  chmodSync(executable, 0o755);
}

const report = {
  stagedRendererGitSha,
  currentCheckoutGitSha: execFileSync('git', ['rev-parse', 'HEAD'], {
    encoding: 'utf8',
  }).trim(),
  renderer: 'staged-production',
  currentCheckoutRuntimeDiff: execFileSync(
    'git',
    ['diff', '--stat', '--', 'src/components/workspace/launch-controls.tsx'],
    { encoding: 'utf8' }
  ).trim(),
  loadavg: loadavg(),
  cores: cpus().length,
  fixture: {
    projects: 3,
    shells: 12,
    providerCatalogs: 'fake Claude/Codex, no agent execution',
    providerHistory:
      '900 Claude JSONL + 900 Codex legacy JSONL across 3 Projects; no SQLite index',
  },
  samples: [],
};
// The helper's watchdog/signal path exits directly after closing Electron.
// Preserve partial evidence and remove only this probe's throwaway fixtures.
function interruptedExit(code) {
  report.failure ??= `Probe exited before finalization (exit code ${code}).`;
  try {
    writeFileSync(outputPath, JSON.stringify(report, null, 2) + '\n');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
process.once('exit', interruptedExit);

async function arm(page, name) {
  await page.evaluate(name => {
    window.__composerProbe = {
      name,
      frames: [],
      initialFocus: document.activeElement?.className,
      initialTabCount: document.querySelectorAll('[data-tab-id]').length,
      started: null,
    };
    const probe = window.__composerProbe;
    const capture = event => {
      if (
        event.type === 'keydown' &&
        !(event.key.toLowerCase() === 't' && event.metaKey && !event.altKey)
      )
        return;
      if (probe.started !== null) return;
      probe.commandBoundary = event.type;
      document.removeEventListener('keydown', capture, true);
      window.removeEventListener('exawatt:focus-agent-composer', capture, true);
      probe.started = performance.now();
      let previous = probe.started;
      const frame = now => {
        if (window.__composerProbe !== probe) return;
        probe.frames.push(now - previous);
        previous = now;
        const composer = document.querySelector('[data-agent-composer]');
        if (
          document.querySelectorAll('[data-tab-id]').length >
            probe.initialTabCount &&
          probe.tabMs === undefined
        )
          probe.tabMs = now - probe.started;
        const field = composer?.querySelector('textarea');
        if (composer && probe.composerMs === undefined)
          probe.composerMs = now - probe.started;
        if (
          field &&
          !field.disabled &&
          document.activeElement === field &&
          probe.focusedMs === undefined
        )
          probe.focusedMs = now - probe.started;
        if (
          composer?.getAttribute('data-preferences-ready') === 'true' &&
          probe.preferencesMs === undefined
        )
          probe.preferencesMs = now - probe.started;
        if (
          composer?.querySelector('[data-row-state="ready"]') &&
          probe.setupReadyMs === undefined
        )
          probe.setupReadyMs = now - probe.started;
        if (
          document.querySelector('[data-conversation-id]') &&
          probe.recentRowsMs === undefined
        )
          probe.recentRowsMs = now - probe.started;
        if (
          probe.focusedMs !== undefined &&
          probe.setupReadyMs !== undefined &&
          probe.recentRowsMs !== undefined
        ) {
          probe.done = true;
          return;
        }
        if (now - probe.started > 15000) {
          probe.timeout = true;
          probe.done = true;
          return;
        }
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    };
    document.addEventListener('keydown', capture, true);
    window.addEventListener('exawatt:focus-agent-composer', capture, true);
  }, name);
}
try {
  await withElectronApp(
    {
      args: ['.'],
      cwd: repo,
      env: {
        ...process.env,
        NODE_ENV: 'development',
        EXAWATT_TEST: '1',
        EXAWATT_USER_DATA: userData,
        EXAWATT_TEST_HARNESS_BIN: fakeBin,
        EXAWATT_CLAUDE_PROJECTS_ROOT: claudeRoot,
        EXAWATT_CODEX_SESSIONS_ROOT: codexRoot,
        EXAWATT_GROK_SESSIONS_ROOT: grokRoot,
        EXAWATT_TEST_QUIT_RESPONSES: 'confirm,confirm,confirm',
        EXAWATT_WINDOW_MODE: 'inactive',
        EXAWATT_DEV_URL: `${process.env.EXA_BASE}/workspace`,
      },
    },
    async (app, page) => {
      page.setDefaultTimeout(30000);
      report.loadAtAppReady = loadavg();
      report.requestFailures = [];
      page.on('requestfailed', request =>
        report.requestFailures.push({
          path: new URL(request.url()).pathname,
          error: request.failure()?.errorText,
        })
      );
      try {
        report.errors = [];
        page.on('pageerror', error => report.errors.push(error.message));
        await page.locator('[data-command-altitude]').waitFor();
        for (let i = 0; i < 3; i++) {
          console.log(`fixture Project ${i + 1}`);
          await app.evaluate(({ dialog }, dir) => {
            dialog.showOpenDialog = async () => ({
              canceled: false,
              filePaths: [dir],
              bookmarks: [],
            });
          }, projects[i]);
          await page.keyboard.press('Meta+KeyN');
          await page.locator('[data-project-opener]').waitFor();
          await page
            .getByRole('button', { name: 'Browse Folder', exact: true })
            .click();
          await page.locator('[data-agent-composer]').waitFor();
          for (let j = 0; j < 4; j++) {
            await page.keyboard.press('Meta+Alt+KeyT');
            await page.waitForFunction(
              async n =>
                ((await window.electron.pty.list()) ?? []).length === n,
              i * 4 + j + 1
            );
            await page.waitForFunction(() =>
              document.activeElement?.classList.contains(
                'xterm-helper-textarea'
              )
            );
          }
        }
        report.runtime = await app.evaluate(() => ({
          electron: process.versions.electron,
          chromium: process.versions.chrome,
        }));
        report.fixture.liveSessionCount = await page.evaluate(
          async () => (await window.electron.pty.list()).length
        );
        report.display = await page.evaluate(() => ({
          width: innerWidth,
          height: innerHeight,
          dpr: devicePixelRatio,
          visibility: document.visibilityState,
          reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
        }));
        // Reload creates a fresh renderer module/cache state while the existing 12 shells remain owned by main.
        for (let i = 0; i < 3; i++) {
          console.log(`cold reload ${i + 1}`);
          await page.reload();
          await page.locator('[data-command-altitude]').waitFor();
          await page.waitForFunction(() =>
            document.activeElement?.classList.contains('xterm-helper-textarea')
          );
          await arm(page, `cold-renderer-populated-${i + 1}`);
          await page.keyboard.press('Meta+KeyT');
          await page.waitForFunction(() => window.__composerProbe?.done);
          report.samples.push({
            ...(await page.evaluate(() => ({
              ...window.__composerProbe,
              visibleRecentRows: document.querySelectorAll(
                '[data-conversation-id]'
              ).length,
            }))),
            loadavg: loadavg(),
          });
          // Verify the focused field accepts input without launching a process.
          await page.keyboard.type('probe draft');
          report.samples.at(-1).inputAccepted =
            (await page
              .locator('[data-agent-launcher] textarea')
              .inputValue()) === 'probe draft';
          await page.locator('[data-agent-launcher] textarea').fill('');
          await page.keyboard.press('Meta+KeyW');
          await page.waitForFunction(() =>
            document.activeElement?.classList.contains('xterm-helper-textarea')
          );
        }
        for (let i = 0; i < 3; i++) {
          console.log(`warm composer ${i + 1}`);
          await arm(page, `warm-populated-${i + 1}`);
          await page.keyboard.press('Meta+KeyT');
          await page.waitForFunction(() => window.__composerProbe?.done);
          report.samples.push({
            ...(await page.evaluate(() => ({
              ...window.__composerProbe,
              visibleRecentRows: document.querySelectorAll(
                '[data-conversation-id]'
              ).length,
            }))),
            loadavg: loadavg(),
          });
          await page.keyboard.press('Meta+KeyW');
          await page.waitForFunction(() =>
            document.activeElement?.classList.contains('xterm-helper-textarea')
          );
        }
      } catch (error) {
        await page
          .screenshot({ path: `${outputPath}.failure.png` })
          .catch(() => {});
        report.failedPage = await page
          .evaluate(() => ({
            url: location.href,
            title: document.title,
            text: document.body.innerText.slice(0, 3000),
          }))
          .catch(() => null);
        throw error;
      }
    },
    { maxMs: 240000, firstWindowMs: 45000, attempts: 1 }
  );
} catch (error) {
  report.failure = String(error.stack || error);
  process.exitCode = 1;
} finally {
  process.removeListener('exit', interruptedExit);
  writeFileSync(outputPath, JSON.stringify(report, null, 2) + '\n');
  console.log(
    JSON.stringify(
      {
        ...report,
        samples: report.samples.map(({ frames, ...sample }) => ({
          ...sample,
          maxFrameMs: Math.max(...frames),
        })),
      },
      null,
      2
    )
  );
  rmSync(root, { recursive: true, force: true });
}
