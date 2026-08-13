#!/usr/bin/env node
/**
 * ENG-003 S4 — the Grok Build adapter, end to end through a real PTY.
 *
 * Dedicated rather than folded into `eval:electron:agent-sources`: that script
 * is blocked partway by BUG-014 (the pre-D49 `Agent Source` / `Agent model`
 * Select is `hidden` and unreachable, on `origin/master` too), so every check
 * after its Claude composer stage never runs. This drives the CURRENT D49
 * contract instead — the composer's "All engines and models" catalog — which
 * is the same path `openShellFromLauncher` uses and is green.
 *
 * What it proves:
 *   1. the composed launch argv (directory, permission mode, model, the
 *      Exawatt-allocated session id, the initial task)
 *   2. the injected-configuration disclosure: Exawatt injects NOTHING into
 *      Grok Build's state home, and names no credential
 *   3. exact resume from the source's own `summary.json`, never `--continue`
 *   4. consumption: `updates.jsonl` becomes rows under the `grok` source
 */
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { withElectronApp } from './lib/electron-eval.mjs';

/**
 * Grok Build's `sessions/<dir>` component. Reproduced here rather than
 * imported because this script is plain ESM outside the TypeScript build; the
 * shipped implementation is `packages/core/src/consumption/grok-paths.ts` and
 * `consumption-grok.test.ts` pins both to the harness's own fixtures.
 */
const encodeGrokCwdDirname = value =>
  [...Buffer.from(value, 'utf8')]
    .map(byte =>
      byte < 0x80 && /[A-Za-z0-9\-._~]/.test(String.fromCharCode(byte))
        ? String.fromCharCode(byte)
        : `%${byte.toString(16).toUpperCase().padStart(2, '0')}`
    )
    .join('');

const root = mkdtempSync(join(tmpdir(), 'exawatt-grok-source-'));
const userData = join(root, 'userData');
const fakeHome = join(root, 'home');
const fakeBin = join(root, 'bin');
const project = join(root, 'exawatt-grok-project');
const grokSessions = join(fakeHome, '.grok', 'sessions');
const projectSessions = join(grokSessions, encodeGrokCwdDirname(project));
const output = resolve('.artifacts', 'grok-source');
for (const directory of [
  userData,
  fakeHome,
  fakeBin,
  project,
  projectSessions,
  output,
]) {
  mkdirSync(directory, { recursive: true });
}
writeFileSync(join(project, 'package.json'), '{}');

// Mirrors the surfaces Exawatt reads on the real `grok 1.0.3`: the version
// string, the `grok models` banner + listing, and an interactive launch that
// echoes its argv and its view of the state home.
writeFileSync(
  join(fakeBin, 'grok'),
  `#!/bin/sh
if [ "$1" = "--version" ]; then printf 'grok 1.0.3 (evalbuild)\\n'; exit 0; fi
if [ "$1" = "models" ]; then
  printf '%s\\n' 'You are logged in with grok.com.' '' 'Default model: eval-grok-4.5' '' 'Available models:' '  * eval-grok-4.5 (default)' '  - eval-grok-code'
  exit 0
fi
printf 'FAKE_GROK_ARGS:'
printf ' <%s>' "$@"
printf '\\nFAKE_GROK_HOME:%s\\n' "\${GROK_HOME-unset}"
printf 'FAKE_GROK_AUTH_PATH:%s\\n' "\${GROK_AUTH_PATH-unset}"
while true; do
  if IFS= read -r line; then printf 'FAKE_GROK_INPUT:%s\\n' "$line"; else /bin/sleep 1; fi
done
`
);
chmodSync(join(fakeBin, 'grok'), 0o755);

const RESUME_ID = '018f2c11-4b2a-7c3d-9e4f-5a6b7c8d9e0f';
const now = Date.now();
mkdirSync(join(projectSessions, RESUME_ID), { recursive: true });
writeFileSync(
  join(projectSessions, RESUME_ID, 'summary.json'),
  JSON.stringify({
    info: { id: RESUME_ID, cwd: project },
    session_summary: 'Rolling text the source keeps',
    generated_title: 'Wire the consent reducer',
    created_at: new Date(now - 3_600_000).toISOString(),
    updated_at: new Date(now - 60_000).toISOString(),
    last_active_at: new Date(now - 30_000).toISOString(),
    num_messages: 6,
    current_model_id: 'eval-grok-4.5',
  })
);
// A subagent runs as its OWN session directory. It must never be offered as a
// resume target: it is the source's child, not a conversation the operator
// started.
const CHILD_ID = '018f2c11-4b2a-7c3d-9e4f-5a6b7c8d9e11';
mkdirSync(join(projectSessions, CHILD_ID), { recursive: true });
writeFileSync(
  join(projectSessions, CHILD_ID, 'summary.json'),
  JSON.stringify({
    info: { id: CHILD_ID, cwd: project },
    generated_title: 'Explore the reducer',
    session_kind: 'subagent',
    created_at: new Date(now - 600_000).toISOString(),
    updated_at: new Date(now - 60_000).toISOString(),
    num_messages: 2,
    current_model_id: 'eval-grok-4.5',
  })
);
const turn = (promptId, timestamp) =>
  JSON.stringify({
    timestamp,
    method: '_x.ai/session/update',
    params: {
      sessionId: RESUME_ID,
      update: {
        sessionUpdate: 'turn_completed',
        prompt_id: promptId,
        stop_reason: 'end_turn',
        usage: {
          inputTokens: 12_000,
          cachedReadTokens: 9_000,
          cacheCreationTokens: 1_000,
          outputTokens: 800,
          reasoningTokens: 300,
          numTurns: 1,
          modelUsage: { 'eval-grok-4.5': { inputTokens: 12_000 } },
        },
      },
    },
  });
writeFileSync(
  join(projectSessions, RESUME_ID, 'updates.jsonl'),
  `${turn('p1', Math.floor((now - 600_000) / 1000))}\n${turn(
    'p2',
    Math.floor((now - 300_000) / 1000)
  )}\n`
);

// Grok Build is the only installed source in this fixture, so make it the
// operator's remembered choice too — otherwise the composer opens on the
// stored default (Claude Code) and reports it as not installed.
writeFileSync(
  join(userData, 'settings.json'),
  JSON.stringify({
    agentSources: {
      projectLastUsed: { [project]: 'grok' },
      sourceRecency: { grok: now },
      projectPermissionModes: {},
    },
  })
);

const failures = [];
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures.push(name);
};

const launch = {
  args: ['.'],
  cwd: process.cwd(),
  env: {
    ...process.env,
    HOME: fakeHome,
    PATH: `${fakeBin}:${process.env.PATH ?? ''}`,
    NODE_ENV: 'development',
    EXAWATT_TEST: '1',
    EXAWATT_USER_DATA: userData,
    EXAWATT_TEST_DIR: project,
    EXAWATT_TEST_HARNESS_BIN: fakeBin,
    EXAWATT_GROK_SESSIONS_ROOT: grokSessions,
    EXAWATT_TEST_QUIT_RESPONSES: 'confirm',
    EXAWATT_DEV_URL: `${process.env.EXA_BASE ?? 'http://localhost:7011'}/workspace`,
  },
};

/** Choose an agent configuration through D49's live catalog. */
async function chooseFromLauncher(page, pattern) {
  if ((await page.locator('[data-agent-composer]').count()) === 0) {
    await page.locator('[data-composer-toggle][aria-expanded="false"]').click();
    await page.locator('[data-agent-composer]').waitFor();
  }
  // The catalog is assembled from live per-source model probes, so the row
  // set arrives after the composer does. Reopen until the source appears
  // rather than racing the first paint.
  const deadline = Date.now() + 40_000;
  for (;;) {
    await page.getByRole('button', { name: 'All engines and models' }).click();
    await page.locator('[data-all-launch-configurations]').waitFor();
    const row = page
      .locator('[data-all-launch-configurations] button')
      .filter({ hasText: pattern })
      .first();
    if ((await row.count()) > 0) {
      await row.click();
      return;
    }
    if (Date.now() > deadline) {
      throw new Error(
        `launch catalog never offered ${pattern}: ${await page
          .locator('[data-all-launch-configurations]')
          .innerText()}`
      );
    }
    await page.getByRole('button', { name: 'All engines and models' }).click();
    await page.waitForTimeout(1_000);
  }
}

/**
 * Wait for a Session whose harness has actually SPOKEN.
 *
 * Grok Build's identity is allocated by Exawatt before the spawn, so
 * `harnessSessionId` is set the instant the record exists — earlier than any
 * output. Polling on identity alone therefore reads an empty scrollback and
 * every argv assertion becomes a race. `marker` is the source's first byte.
 */
async function sessionOfHarness(page, harness, excludeId = '', marker = '') {
  return page.evaluate(
    async ({ harness: wanted, excludeId: skip, marker: needle }) => {
      const deadline = Date.now() + 25_000;
      while (Date.now() < deadline) {
        const sessions = await window.electron?.pty?.list();
        const session = sessions?.find(
          item => item.harness === wanted && item.id !== skip
        );
        if (session?.harnessSessionId) {
          const buffer = (await window.electron?.pty?.buffer(session.id)) ?? '';
          if (!needle || buffer.includes(needle)) return { session, buffer };
        }
        await new Promise(wait => setTimeout(wait, 100));
      }
      return null;
    },
    { harness, excludeId, marker }
  );
}

try {
  await withElectronApp(
    launch,
    async (app, page) => {
      page.setDefaultTimeout(20_000);
      const pageErrors = [];
      page.on('pageerror', error => pageErrors.push(error.message));
      await page.setViewportSize({ width: 1440, height: 900 });
      // Open the eval Project the way the operator does; the composer is the
      // always-open pane of an empty Project (D24).
      await page.locator('[data-command-altitude]').waitFor();
      await page.keyboard.press('Meta+KeyN');
      await page.locator('[data-project-opener]').waitFor();
      await page.getByRole('button', { name: 'Browse Folder' }).click();
      await page.locator('[data-agent-composer]').waitFor();

      const registry = await page.evaluate(() =>
        window.electron?.agentSources?.list('launch')
      );
      const grok = registry?.sources.find(
        source => source.adapterId === 'grok'
      );
      check(
        'Grok Build is launchable from observed facts, not a declaration',
        grok?.launchable === true &&
          grok?.facts.installation.basis === 'observed' &&
          grok?.facts.modelDiscovery.value === '2 models reported',
        JSON.stringify(grok?.facts)
      );
      check(
        'no Grok credential or token path ever crosses the bridge',
        !JSON.stringify(registry).includes('auth.json') &&
          !JSON.stringify(registry).includes('XAI_API_KEY')
      );

      // Rows are labeled by CONFIGURATION (model + effort), not by engine —
      // the engine is the glyph. Select Grok Build's source-reported default.
      await chooseFromLauncher(page, /Eval Grok 4\.5/);
      await page.screenshot({
        path: join(output, 'composer-grok-selected-1440x900.png'),
      });
      const composerText = await page
        .locator('[data-agent-composer]')
        .innerText();
      check(
        'the composer names Grok Build and its source-reported default model',
        composerText.includes('Grok Build') &&
          composerText.includes('Eval Grok 4.5'),
        composerText.replace(/\n/g, ' / ')
      );

      await page
        .getByLabel('Initial task for the new Agent')
        .fill('Verify the Grok Build launch adapter');
      const startButton = page.getByRole('button', {
        name: 'Start',
        exact: true,
      });
      await startButton.click();
      const launched = await sessionOfHarness(
        page,
        'grok',
        '',
        'FAKE_GROK_ARGS:'
      );
      const buffer = launched?.buffer ?? '';
      const identity = launched?.session.harnessSessionId ?? '';
      check(
        'Exawatt allocates the Grok session identity before the first turn',
        /^[0-9a-f-]{36}$/.test(identity) &&
          buffer.includes(`<--session-id> <${identity}>`),
        buffer
      );
      check(
        'the launch pins the Exawatt directory, policy, and the first task',
        buffer.includes(`<--cwd> <${project}>`) &&
          buffer.includes('<--permission-mode> <bypassPermissions>') &&
          buffer.includes('<Verify the Grok Build launch adapter>'),
        buffer
      );
      check(
        "an unchanged source default is left to the source, not pinned with -m",
        !buffer.includes('<-m>'),
        buffer
      );
      check(
        'the launch never asks Grok Build for its own worktree',
        !buffer.includes('<--worktree>') && !buffer.includes('<-w>'),
        buffer
      );
      check(
        'Exawatt injects nothing into the Grok state home and names no credential',
        buffer.includes('FAKE_GROK_HOME:unset') &&
          buffer.includes('FAKE_GROK_AUTH_PATH:unset') &&
          !buffer.includes('<--settings>') &&
          !buffer.includes('<--agent>'),
        buffer
      );

      // The first composer loaded its recent snapshot before this Session
      // existed; the catalog cache is deliberately bounded. Let it expire and
      // summon a fresh composer, the way the operator would.
      await page.waitForTimeout(10_500);
      await app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0]?.webContents.send(
          'menu:command',
          'new-agent'
        );
      });
      await page.locator('[data-agent-composer]').waitFor();
      const recent = page.locator(`[data-conversation-id="${RESUME_ID}"]`);
      await recent.waitFor();
      check(
        'the source session record drives a native provider conversation row',
        (await recent.getAttribute('data-continuation')) === 'provider' &&
          (await recent.getAttribute('data-title-source')) === 'native' &&
          (await recent.innerText()).includes('Wire the consent reducer')
      );
      check(
        'a subagent session is never offered as a resume target',
        (await page.locator(`[data-conversation-id="${CHILD_ID}"]`).count()) ===
          0
      );
      await recent.locator('button').first().click();
      const resumed = await sessionOfHarness(
        page,
        'grok',
        launched?.session.id ?? '',
        'FAKE_GROK_ARGS:'
      );
      check(
        'the recent row resumes only its exact identity, never --continue',
        resumed?.session.harnessSessionId === RESUME_ID &&
          resumed.buffer.includes(`<--resume> <${RESUME_ID}>`) &&
          !resumed.buffer.includes('<--continue>') &&
          !resumed.buffer.includes('<-c>'),
        resumed?.buffer ?? 'No resumed Grok session'
      );

      const consumption = await page.evaluate(async () => {
        await window.electron?.consumption?.rescan?.();
        const deadline = Date.now() + 25_000;
        while (Date.now() < deadline) {
          const snapshot = await window.electron?.consumption?.snapshot?.();
          if (snapshot?.samples?.some(sample => sample.source === 'grok')) {
            return snapshot;
          }
          await new Promise(wait => setTimeout(wait, 250));
        }
        return await window.electron?.consumption?.snapshot?.();
      });
      const grokSamples = (consumption?.samples ?? []).filter(
        sample => sample.source === 'grok'
      );
      check(
        'signals-free consumption: turn_completed usage lands under the source',
        grokSamples.length === 2 &&
          grokSamples.every(sample => sample.cwd === project) &&
          grokSamples.every(sample => sample.model === 'eval-grok-4.5'),
        JSON.stringify(grokSamples.slice(0, 1))
      );
      check(
        'the ACP wire full-input count is normalized into disjoint buckets',
        grokSamples[0]?.usage.inputTokens === 2_000 &&
          grokSamples[0]?.usage.cacheReadTokens === 9_000 &&
          grokSamples[0]?.usage.cacheWriteTokens === 1_000,
        JSON.stringify(grokSamples[0]?.usage)
      );
      check(
        'Grok Build reports no plan window — absent, never zero',
        (consumption?.planWindows ?? []).every(
          window => window.source !== 'grok'
        )
      );

      check(
        'renderer emitted no uncaught page errors',
        pageErrors.length === 0,
        pageErrors.join('; ')
      );
    },
    { maxMs: 180_000 }
  );
} finally {
  rmSync(root, { recursive: true, force: true });
}

if (failures.length > 0) {
  console.error(`\n${failures.length} Grok Build source check(s) failed`);
  process.exit(1);
}
console.log('\nGrok Build source eval passed');
