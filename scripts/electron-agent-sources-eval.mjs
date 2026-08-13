#!/usr/bin/env node

import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { withElectronApp } from './lib/electron-eval.mjs';

/**
 * Grok Build's `sessions/<dir>` component, reproduced here rather than
 * imported: this script runs as plain ESM outside the TypeScript build, and
 * the eval must exercise the SAME encoding contract the adapter claims (Rust
 * `urlencoding::encode` — unreserved bytes verbatim, uppercase hex).
 * `packages/core/src/consumption/grok-paths.ts` is the shipped implementation
 * and `consumption-grok.test.ts` pins them to the same fixtures.
 */
const encodeGrokCwdDirname = value =>
  [...Buffer.from(value, 'utf8')]
    .map(byte =>
      /[A-Za-z0-9\-._~]/.test(String.fromCharCode(byte)) && byte < 0x80
        ? String.fromCharCode(byte)
        : `%${byte.toString(16).toUpperCase().padStart(2, '0')}`
    )
    .join('');

const root = mkdtempSync(join(tmpdir(), 'exawatt-agent-sources-'));
const userData = join(root, 'userData');
const fakeHome = join(root, 'home');
const fakeBin = join(root, 'bin');
const projectDir = join(root, 'project');
/** Grok Build's own corpus root, reproduced with its cwd encoding. */
const grokSessionsDir = join(
  fakeHome,
  '.grok',
  'sessions',
  encodeGrokCwdDirname(projectDir)
);
const output = resolve('.artifacts', 'agent-sources');
const previewThemes = [
  'exawatt-air-light',
  'exawatt-night-dark',
  'exawatt-classic-dark',
].map(id =>
  JSON.parse(readFileSync(resolve('themes', 'v1', `${id}.json`), 'utf8'))
);
for (const directory of [
  userData,
  fakeHome,
  fakeBin,
  projectDir,
  output,
  join(fakeHome, '.openclaw'),
  grokSessionsDir,
]) {
  mkdirSync(directory, { recursive: true });
}
writeFileSync(join(projectDir, 'package.json'), '{}');
writeFileSync(
  join(fakeHome, '.openclaw', 'openclaw.json'),
  JSON.stringify({
    meta: { lastTouchedVersion: '2026.8.0-eval' },
    gateway: {
      host: '127.0.0.1',
      port: 61999,
      auth: { token: 'fixture-never-crosses-ipc' },
    },
  })
);

const fixtures = {
  claude: `#!/bin/sh
if [ "$1" = "--version" ]; then printf '2.1.220 (Claude Code)\\n'; exit 0; fi
if [ "$1" = "auth" ] && [ "$2" = "status" ]; then
  printf '%s\\n' '{"loggedIn":true,"email":"operator@example.com","subscriptionType":"max","orgId":"private-org"}'
  exit 0
fi
if [ "$1" = "--safe-mode" ]; then
  printf '%s\\n' '{"type":"control_response","response":{"subtype":"success","request_id":"exawatt-model-catalog","response":{"commands":[],"agents":[],"models":[{"value":"default","displayName":"Default (recommended)","description":"Claude Code account default","supportsEffort":true,"supportedEffortLevels":["low","high"]},{"value":"eval-claude","displayName":"Eval Claude","description":"Fixture model","supportsEffort":true,"supportedEffortLevels":["high"]}]}}}'
  exit 0
fi
exit 1
`,
  codex: `#!/bin/sh
if [ "$1" = "--version" ]; then printf 'codex-cli 0.146.0\\n'; exit 0; fi
if [ "$1" = "login" ] && [ "$2" = "status" ]; then printf 'Logged in using ChatGPT\\n'; exit 0; fi
if [ "$1" = "debug" ] && [ "$2" = "models" ]; then
  printf '%s\\n' '{"models":[{"slug":"eval-sol","display_name":"Eval Sol","description":"Eval frontier model.","visibility":"list","priority":1,"default_reasoning_level":"high","supported_reasoning_levels":[{"effort":"low"},{"effort":"high"}]}]}'
  exit 0
fi
exit 1
`,
  opencode: `#!/bin/sh
if [ "$1" = "--version" ]; then printf '1.3.4\n'; exit 0; fi
if [ "$1" = "auth" ] && [ "$2" = "list" ]; then
  printf '\\033[0m\n┌  Credentials\n│\n●  Fixture Provider api\n│\n└  1 credential\n'
  exit 0
fi
if [ "$1" = "models" ] && [ "$2" = "--verbose" ]; then
  printf '%s\n' 'fixture/eval-model' '{' '  "id": "eval-model",' '  "providerID": "fixture",' '  "name": "Eval Open Model",' '  "family": "eval",' '  "variants": {"low": {}, "high": {}}' '}'
  exit 0
fi
state="$EXAWATT_TEST_HARNESS_BIN/opencode-session.json"
agent_state="$EXAWATT_TEST_HARNESS_BIN/opencode-session-agent.txt"
if [ "$1" = "--pure" ] && [ "$2" = "session" ] && [ "$3" = "list" ]; then
  if [ -f "$state" ]; then cat "$state"; else printf '[]\n'; fi
  exit 0
fi
if [ "$1" = "--pure" ] && [ "$2" = "export" ]; then
  if [ ! -f "$agent_state" ]; then exit 1; fi
  agent="$(cat "$agent_state")"
  printf '{"info":{"id":"%s"},"messages":[{"info":{"role":"user","agent":"%s"},"parts":[]}]}\n' "$3" "$agent"
  exit 0
fi
now="$(date +%s)000"
previous=""
for argument in "$@"; do
  if [ "$previous" = "--agent" ]; then printf '%s' "$argument" > "$agent_state"; break; fi
  previous="$argument"
done
printf '[{"id":"ses_eval_opencode_1234","title":"Agent Source launch eval","directory":"%s","created":%s,"updated":%s}]\n' "$PWD" "$now" "$now" > "$state"
printf 'FAKE_OPENCODE_ARGS:'
printf ' <%s>' "$@"
printf '\nFAKE_OPENCODE_CONFIG_CONTENT:%s\n' "$OPENCODE_CONFIG_CONTENT"
while IFS= read -r input; do printf 'FAKE_OPENCODE_INPUT:%s\n' "$input"; done
`,
  openclaw: `#!/bin/sh
if [ "$1" = "--version" ]; then printf 'OpenClaw 2026.8.0-eval\\n'; exit 0; fi
exit 1
`,
  // Mirrors the real `grok 1.0.3` surfaces Exawatt reads: the version string,
  // the `grok models` banner + listing, and an interactive launch that echoes
  // its argv so the eval can assert the exact composed command.
  grok: `#!/bin/sh
if [ "$1" = "--version" ]; then printf 'grok 1.0.3 (evalbuild)\n'; exit 0; fi
if [ "$1" = "models" ]; then
  printf '%s\n' 'You are logged in with grok.com.' '' 'Default model: eval-grok-4.5' '' 'Available models:' '  * eval-grok-4.5 (default)' '  - eval-grok-code'
  exit 0
fi
printf 'FAKE_GROK_ARGS:'
printf ' <%s>' "$@"
printf '\nFAKE_GROK_HOME:%s\n' "\${GROK_HOME-unset}"
while IFS= read -r input; do printf 'FAKE_GROK_INPUT:%s\n' "$input"; done
`,
};
for (const [name, fixture] of Object.entries(fixtures)) {
  const executable = join(fakeBin, name);
  writeFileSync(executable, fixture);
  chmodSync(executable, 0o755);
}

const failures = [];
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures.push(name);
};

const rgb = hex => {
  const value = hex.replace('#', '').slice(0, 6);
  return `rgb(${Number.parseInt(value.slice(0, 2), 16)}, ${Number.parseInt(
    value.slice(2, 4),
    16
  )}, ${Number.parseInt(value.slice(4, 6), 16)})`;
};

async function previewTheme(page, theme, reducedTransparency = false) {
  await page.evaluate(
    ({ id, appearance, profile, reduced }) => {
      const root = document.documentElement;
      for (const name of Array.from(root.style)) {
        if (name.startsWith('--exa-')) root.style.removeProperty(name);
      }
      root.dataset.exaTheme = id;
      root.dataset.exaAppearance = appearance;
      root.dataset.exaContrast = 'standard';
      root.dataset.exaTransparency = reduced ? 'reduced' : 'standard';
      root.dataset.exaFont = 'theme';
      root.dataset.exaTypography = profile;
      root.classList.toggle('dark', appearance === 'dark');
      root.classList.toggle('light', appearance === 'light');
    },
    {
      id: theme.id,
      appearance: theme.appearance,
      profile: theme.typography.profile,
      reduced: reducedTransparency,
    }
  );
  await page.evaluate(
    () =>
      new Promise(resolveFrame =>
        requestAnimationFrame(() => requestAnimationFrame(resolveFrame))
      )
  );
  return page.evaluate(() => {
    const root = document.documentElement;
    const shell = document.querySelector('[data-settings-shell]');
    const material = document.querySelector('.exa-material-chrome');
    if (!(shell instanceof HTMLElement) || !(material instanceof HTMLElement)) {
      throw new Error('Settings theme preview targets are missing');
    }
    const shellStyle = getComputedStyle(shell);
    const materialStyle = getComputedStyle(material);
    const backdropFilter = materialStyle.backdropFilter;
    const webkitBackdropFilter = materialStyle.getPropertyValue(
      '-webkit-backdrop-filter'
    );
    return {
      themeId: root.dataset.exaTheme,
      background: shellStyle.backgroundColor,
      color: shellStyle.color,
      colorScheme: getComputedStyle(root).colorScheme,
      backdropFilter,
      webkitBackdropFilter,
      materialBackground: materialStyle.backgroundColor,
    };
  });
}

const base = process.env.EXA_BASE ?? 'http://localhost:7421';
const launch = () => ({
  args: ['.'],
  cwd: process.cwd(),
  env: {
    ...process.env,
    HOME: fakeHome,
    PATH: `${fakeBin}:${process.env.PATH ?? ''}`,
    NODE_ENV: 'development',
    EXAWATT_TEST: '1',
    EXAWATT_USER_DATA: userData,
    EXAWATT_TEST_HARNESS_BIN: fakeBin,
    EXAWATT_TEST_QUIT_RESPONSES: 'confirm,confirm',
    EXAWATT_DEV_URL: `${base}/settings`,
  },
});

try {
  await withElectronApp(
    launch(),
    async (app, page) => {
      page.setDefaultTimeout(20_000);
      const pageErrors = [];
      page.on('pageerror', error => pageErrors.push(error.message));
      await page.setViewportSize({ width: 1400, height: 900 });
      // During the development renderer hand-off the previous document can
      // remain briefly attached but hidden. Wait for the newest Settings root.
      await page.locator('[data-settings-shell]').last().waitFor();

      const registry = await page.evaluate(() =>
        window.electron?.agentSources?.list('all')
      );
      check(
        'registry returns six normalized source records',
        registry?.sources.length === 6,
        JSON.stringify(registry?.sources.map(source => source.adapterId))
      );
      const claude = registry?.sources.find(
        source => source.adapterId === 'claude'
      );
      const codex = registry?.sources.find(
        source => source.adapterId === 'codex'
      );
      const opencode = registry?.sources.find(
        source => source.adapterId === 'opencode'
      );
      const openclaw = registry?.sources.find(
        source => source.adapterId === 'openclaw'
      );
      const demo = registry?.sources.find(
        source => source.adapterId === 'demo'
      );
      check(
        'Claude status is ready with minimum source identity',
        claude?.state === 'ready' &&
          claude?.facts.identity.value === 'operator@example.com'
      );
      check(
        'Codex status is ready',
        codex?.state === 'ready',
        codex?.state === 'ready'
          ? ''
          : JSON.stringify({
              state: codex?.state,
              installation: codex?.facts.installation,
              authentication: codex?.facts.authentication,
            })
      );
      const opencodeReady =
        opencode?.state === 'ready' &&
        opencode?.facts.modelDiscovery.value === '1 models reported' &&
        opencode?.facts.authentication.state === 'unknown' &&
        opencode?.facts.authentication.value === '1 provider credential';
      check(
        'OpenCode is ready with source-reported catalog and unclaimed credential validity',
        opencodeReady,
        opencodeReady ? '' : JSON.stringify(opencode)
      );
      const grok = registry?.sources.find(source => source.adapterId === 'grok');
      const grokReady =
        grok?.state === 'ready' &&
        grok?.facts.identity.value === 'grok.com' &&
        grok?.facts.modelDiscovery.value === '2 models reported' &&
        grok?.facts.authentication.state === 'ready';
      check(
        'Grok Build is ready with a source-reported catalog and its own identity',
        grokReady,
        grokReady ? '' : JSON.stringify(grok)
      );
      check(
        'Grok Build declares no delegation channel it cannot deliver',
        grok?.capabilities.delegationObservation.includes('cannot inject') ===
          true &&
          grok?.capabilities.effortSelection === 'source-owned',
        JSON.stringify(grok?.capabilities)
      );
      check(
        'configured unreachable OpenClaw is degraded, not disconnected/absent',
        openclaw?.state === 'degraded'
      );
      check(
        'Demo source uses simulated provenance',
        demo?.facts.identity.provenance.kind === 'simulation' &&
          demo?.facts.identity.basis === 'simulated' &&
          demo?.facts.identity.state === 'simulated'
      );
      const serialized = JSON.stringify(registry);
      check(
        'provider and gateway secrets never cross the bridge',
        !serialized.includes('private-org') &&
          !serialized.includes('fixture-never-crosses-ipc')
      );

      await page.getByRole('heading', { name: 'Claude Code' }).waitFor();
      check(
        'desktop registry/detail geometry is present',
        (
          await page
            .locator('[aria-label="Agent Source registry"]')
            .boundingBox()
        )?.width >= 280
      );
      await page.screenshot({
        path: join(output, 'settings-agent-sources-1400x900.png'),
        fullPage: true,
      });

      for (const theme of previewThemes.slice(0, 2)) {
        const label = theme.label.toLowerCase();
        const standard = await previewTheme(page, theme);
        check(
          `${theme.label} resolves on the production Settings shell`,
          standard.themeId === theme.id &&
            standard.background === rgb(theme.foundation.canvas) &&
            standard.color === rgb(theme.foundation.text) &&
            standard.colorScheme === theme.appearance,
          JSON.stringify(standard)
        );
        check(
          `${theme.label} uses the generated chrome material recipe`,
          [standard.backdropFilter, standard.webkitBackdropFilter].some(value =>
            value?.includes('blur(')
          ),
          JSON.stringify({
            backdropFilter: standard.backdropFilter,
            webkitBackdropFilter: standard.webkitBackdropFilter,
          })
        );
        await page.screenshot({
          path: join(output, `settings-${label}-1400x900.png`),
          fullPage: true,
        });

        const reduced = await previewTheme(page, theme, true);
        check(
          `${theme.label} reduced transparency swaps to the opaque fallback`,
          reduced.backdropFilter === 'none' &&
            (!reduced.webkitBackdropFilter ||
              reduced.webkitBackdropFilter === 'none') &&
            reduced.materialBackground === rgb(theme.material.chrome.fallback),
          JSON.stringify(reduced)
        );
        await page.screenshot({
          path: join(
            output,
            `settings-${label}-reduced-transparency-1400x900.png`
          ),
          fullPage: true,
        });
      }
      await previewTheme(page, previewThemes[2]);

      await page.getByRole('button', { name: /^OpenClaw,/ }).click();
      await page.getByRole('heading', { name: 'OpenClaw' }).waitFor();
      check(
        'degraded gateway detail keeps existing facts visible',
        (await page.getByText('Gateway responds').count()) === 0 &&
          (await page.getByText('Protocol probe failed').count()) > 0
      );

      await page.getByRole('button', { name: 'Browse Agent Sources' }).click();
      await page
        .getByRole('heading', { name: 'Browse Agent Sources' })
        .waitFor();
      check(
        'add flow separates supported-now and future adapters',
        (await page.getByRole('heading', { name: 'Available now' }).count()) ===
          1 &&
          (await page
            .getByRole('heading', { name: 'Future sources' })
            .count()) === 1 &&
          (await page.getByText('Coming soon', { exact: true }).count()) > 0
      );

      await page.setViewportSize({ width: 760, height: 900 });
      await page.screenshot({
        path: join(output, 'settings-add-source-760x900.png'),
        fullPage: true,
      });
      const overflow = await page.evaluate(() => ({
        document:
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
        shell:
          (document.querySelector('[data-settings-shell]')?.scrollWidth ?? 0) -
          (document.querySelector('[data-settings-shell]')?.clientWidth ?? 0),
      }));
      check(
        'compact Settings has no horizontal overflow',
        overflow.document <= 1 && overflow.shell <= 1,
        JSON.stringify(overflow)
      );

      await page.getByRole('button', { name: 'Preferences' }).click();
      await page.getByRole('heading', { name: 'Preferences' }).waitFor();
      await page.screenshot({
        path: join(output, 'settings-preferences-760x900.png'),
        fullPage: true,
      });
      check(
        'existing preferences remain reachable in the shared shell',
        (await page.getByText(/Keyboard shortcuts/i).count()) > 0
      );

      await page.goto(`${base}/workspace`);
      await page.locator('[data-command-altitude]').waitFor();
      await page.evaluate(dir => {
        window.dispatchEvent(
          new CustomEvent('exawatt:open-project', { detail: dir })
        );
      }, projectDir);
      await page.locator('[data-agent-composer]').waitFor();
      const claudeCatalog = await page.evaluate(
        dir => window.electron?.pty?.listAgentModels('claude', dir),
        projectDir
      );
      check(
        'Claude model truth comes from the installed source catalog',
        claudeCatalog?.catalogMode === 'live-catalog' &&
          claudeCatalog.models.map(model => model.id).join(',') ===
            'default,eval-claude'
      );
      const modelTrigger = page.getByLabel('Agent model');
      await modelTrigger.waitFor();
      check(
        'composer exposes the source-reported Claude default',
        (await modelTrigger.innerText()).includes('Default (recommended)')
      );
      const launchRegistry = await page.evaluate(() =>
        window.electron?.agentSources?.list('launch')
      );
      check(
        'composer scope contains only interactive local sources',
        launchRegistry?.sources.length === 4 &&
          launchRegistry.sources.every(source => source.harness !== null),
        JSON.stringify(launchRegistry?.sources.map(source => source.adapterId))
      );
      await app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0]?.webContents.send(
          'menu:command',
          'launch-opencode'
        );
      });
      await page.waitForFunction(() =>
        document
          .querySelector('[aria-label="Agent Source"]')
          ?.textContent?.includes('OpenCode')
      );
      await page.getByLabel('Agent model').waitFor();
      check(
        'native OpenCode launch command opens the composer with OpenCode preselected',
        (await page.getByLabel('Agent Source').innerText()).includes(
          'OpenCode'
        ) && (await page.locator('[data-agent-composer]').count()) === 1
      );
      await page.getByLabel('Agent model').click();
      await page.getByRole('option', { name: /Eval Open Model/ }).click();
      check(
        'OpenCode model and exact variants reach the composer controls',
        (await page.getByLabel('Agent model').innerText()).includes(
          'Eval Open Model'
        ) && !(await page.getByLabel('Agent effort').isDisabled())
      );
      await page.getByLabel('Agent effort').click();
      await page.getByRole('option', { name: /^High\b/ }).click();
      await page
        .getByLabel('Initial task for the new Agent')
        .fill('Verify the OpenCode launch adapter');
      await page.getByRole('button', { name: 'Start', exact: true }).click();
      const launched = await page.evaluate(async () => {
        const deadline = Date.now() + 20_000;
        while (Date.now() < deadline) {
          const sessions = await window.electron?.pty?.list();
          const session = sessions?.find(item => item.harness === 'opencode');
          if (session?.harnessSessionId) {
            return {
              session,
              buffer: await window.electron?.pty?.buffer(session.id),
            };
          }
          await new Promise(resolveWait => setTimeout(resolveWait, 100));
        }
        return null;
      });
      check(
        'OpenCode launch button creates a PTY and captures its exact identity',
        launched?.session.harnessSessionId === 'ses_eval_opencode_1234'
      );
      const launchBuffer = launched?.buffer ?? '';
      const configurationMatch = launchBuffer.match(
        /FAKE_OPENCODE_CONFIG_CONTENT:(\{.*\})/
      );
      const launchConfiguration = configurationMatch
        ? JSON.parse(configurationMatch[1])
        : null;
      const launchAgentName = launchConfiguration
        ? Object.keys(launchConfiguration.agent ?? {})[0]
        : null;
      check(
        'launch button carries model, exact variant, and ordered permission policy through the real PTY boundary',
        Boolean(
          launchAgentName &&
          launchBuffer.includes(`<--agent> <${launchAgentName}>`) &&
          launchBuffer.includes(
            '<--prompt> <Verify the OpenCode launch adapter>'
          ) &&
          launchConfiguration.agent[launchAgentName].model ===
            'fixture/eval-model' &&
          launchConfiguration.agent[launchAgentName].variant === 'high' &&
          Object.keys(
            launchConfiguration.agent[launchAgentName].permission
          )[0] === '*'
        ),
        launchBuffer
      );
      // The first composer loaded an empty recent-conversation snapshot before
      // the fixture created its source session. Let that deliberately bounded
      // cache expire, then summon a fresh composer through the same native menu
      // path and prove the provider-owned row can drive an exact `-s` resume.
      await page.waitForTimeout(10_500);
      await app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0]?.webContents.send(
          'menu:command',
          'launch-opencode'
        );
      });
      const recentOpenCode = page.locator(
        '[data-conversation-id="ses_eval_opencode_1234"]'
      );
      await recentOpenCode.waitFor();
      check(
        'captured OpenCode identity appears as a native provider conversation',
        (await recentOpenCode.getAttribute('data-continuation')) ===
          'provider' &&
          (await recentOpenCode.getAttribute('data-title-source')) ===
            'native' &&
          (await recentOpenCode.innerText()).includes(
            'Agent Source launch eval'
          )
      );
      await recentOpenCode.locator('button').first().click();
      const resumed = await page.evaluate(async originalSessionId => {
        const deadline = Date.now() + 20_000;
        while (Date.now() < deadline) {
          const sessions = await window.electron?.pty?.list();
          const session = sessions?.find(
            item => item.harness === 'opencode' && item.id !== originalSessionId
          );
          if (session?.harnessSessionId === 'ses_eval_opencode_1234') {
            return {
              session,
              buffer: await window.electron?.pty?.buffer(session.id),
            };
          }
          await new Promise(resolveWait => setTimeout(resolveWait, 100));
        }
        return null;
      }, launched?.session.id ?? '');
      check(
        'native OpenCode recent row resumes only its exact source identity with -s',
        resumed?.session.harnessSessionId === 'ses_eval_opencode_1234' &&
          resumed.buffer.includes('<-s> <ses_eval_opencode_1234>') &&
          !resumed.buffer.includes('<--continue>'),
        resumed?.buffer ?? 'No resumed OpenCode session'
      );
      const archived = await page.evaluate(async resumedSession => {
        if (!resumedSession || !window.electron?.pty) return null;
        await window.electron.pty.closeSession(resumedSession.durableSessionId);
        return window.electron.pty.archiveSession({
          durableSessionId: resumedSession.durableSessionId,
          title: resumedSession.title,
          goal: null,
          harness: resumedSession.harness,
          cwd: resumedSession.cwd,
          projectDir: resumedSession.projectDir,
          projectName: resumedSession.projectName,
          harnessSessionId: null,
          initialTask: null,
        });
      }, resumed?.session ?? null);
      check(
        'close and archive recover the settled main-owned exact OpenCode identity',
        archived?.harnessSessionId === 'ses_eval_opencode_1234',
        JSON.stringify(archived)
      );

      // ---- Grok Build (ENG-003 S4) -----------------------------------------
      await app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0]?.webContents.send(
          'menu:command',
          'launch-grok'
        );
      });
      await page.waitForFunction(() =>
        document
          .querySelector('[aria-label="Agent Source"]')
          ?.textContent?.includes('Grok Build')
      );
      await page.getByLabel('Agent model').waitFor();
      check(
        'native Grok Build launch command opens the composer with Grok preselected',
        (await page.getByLabel('Agent Source').innerText()).includes(
          'Grok Build'
        ) && (await page.locator('[data-agent-composer]').count()) === 1
      );
      check(
        'the source default model is pinned and no effort control is offered',
        (await page.getByLabel('Agent model').innerText()).includes(
          'Eval Grok 4.5'
        ) && (await page.getByLabel('Agent effort').isDisabled()),
        await page.getByLabel('Agent model').innerText()
      );
      await page
        .getByLabel('Initial task for the new Agent')
        .fill('Verify the Grok Build launch adapter');
      await page.getByRole('button', { name: 'Start', exact: true }).click();
      const grokLaunched = await page.evaluate(async () => {
        const deadline = Date.now() + 20_000;
        while (Date.now() < deadline) {
          const sessions = await window.electron?.pty?.list();
          const session = sessions?.find(item => item.harness === 'grok');
          if (session?.harnessSessionId) {
            return {
              session,
              buffer: await window.electron?.pty?.buffer(session.id),
            };
          }
          await new Promise(resolveWait => setTimeout(resolveWait, 100));
        }
        return null;
      });
      const grokBuffer = grokLaunched?.buffer ?? '';
      const grokIdentity = grokLaunched?.session.harnessSessionId ?? '';
      check(
        'Exawatt allocates the Grok session identity before the first turn',
        /^[0-9a-f-]{36}$/.test(grokIdentity) &&
          grokBuffer.includes(`<--session-id> <${grokIdentity}>`),
        grokBuffer
      );
      check(
        'the launch pins the Exawatt directory, model, and permission policy',
        grokBuffer.includes(`<--cwd> <${projectDir}>`) &&
          grokBuffer.includes('<--permission-mode> <bypassPermissions>') &&
          grokBuffer.includes('<-m> <eval-grok-4.5>') &&
          grokBuffer.includes('<Verify the Grok Build launch adapter>'),
        grokBuffer
      );
      check(
        'the launch never asks Grok Build for its own worktree',
        !grokBuffer.includes('<--worktree>') && !grokBuffer.includes('<-w>'),
        grokBuffer
      );
      check(
        'Exawatt injects no configuration into the Grok state home',
        grokBuffer.includes('FAKE_GROK_HOME:unset') &&
          !grokBuffer.includes('<--settings>') &&
          !grokBuffer.includes('<--agent>'),
        grokBuffer
      );

      // The source writes its own session record; the recent-conversation row
      // must come from that file and resume only its exact identity.
      mkdirSync(join(grokSessionsDir, grokIdentity), { recursive: true });
      writeFileSync(
        join(grokSessionsDir, grokIdentity, 'summary.json'),
        JSON.stringify({
          info: { id: grokIdentity, cwd: projectDir },
          session_summary: 'Grok Build launch eval',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          last_active_at: new Date().toISOString(),
          num_messages: 2,
          current_model_id: 'eval-grok-4.5',
        })
      );
      await page.waitForTimeout(10_500);
      await app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0]?.webContents.send(
          'menu:command',
          'launch-grok'
        );
      });
      const recentGrok = page.locator(
        `[data-conversation-id="${grokIdentity}"]`
      );
      await recentGrok.waitFor();
      check(
        'the Grok session record appears as a native provider conversation',
        (await recentGrok.getAttribute('data-continuation')) === 'provider' &&
          (await recentGrok.getAttribute('data-title-source')) === 'native' &&
          (await recentGrok.innerText()).includes('Grok Build launch eval')
      );
      await recentGrok.locator('button').first().click();
      const grokResumed = await page.evaluate(async originalSessionId => {
        const deadline = Date.now() + 20_000;
        while (Date.now() < deadline) {
          const sessions = await window.electron?.pty?.list();
          const session = sessions?.find(
            item => item.harness === 'grok' && item.id !== originalSessionId
          );
          if (session?.harnessSessionId) {
            return {
              session,
              buffer: await window.electron?.pty?.buffer(session.id),
            };
          }
          await new Promise(resolveWait => setTimeout(resolveWait, 100));
        }
        return null;
      }, grokLaunched?.session.id ?? '');
      check(
        'the Grok recent row resumes only its exact identity, never --continue',
        grokResumed?.session.harnessSessionId === grokIdentity &&
          grokResumed.buffer.includes(`<--resume> <${grokIdentity}>`) &&
          !grokResumed.buffer.includes('<--continue>') &&
          !grokResumed.buffer.includes('<-c>'),
        grokResumed?.buffer ?? 'No resumed Grok session'
      );

      check(
        'renderer emitted no uncaught page errors',
        pageErrors.length === 0,
        pageErrors.join('; ')
      );
    },
    { maxMs: 150_000 }
  );
} finally {
  rmSync(root, { recursive: true, force: true });
}

if (failures.length > 0) {
  throw new Error(`Agent Source eval failed: ${failures.join(', ')}`);
}
console.log(
  `PASS agent sources: registry + settings + responsive + composer (${output})`
);
