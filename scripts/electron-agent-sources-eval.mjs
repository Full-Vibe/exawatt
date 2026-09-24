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
import {
  launcherAxis,
  openSetupDrawer,
  selectedLauncherSetup,
  withElectronApp,
} from './lib/electron-eval.mjs';

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
/** Expectations derive from the one declaration, never a hand-kept count. */
const contract = JSON.parse(
  readFileSync(resolve('contracts', 'agent-sources.json'), 'utf8')
);
const declaredSourceIds = contract.sources.map(source => source.adapterId);
const declaredHarnessIds = contract.sources
  .filter(source => source.harness !== null)
  .map(source => source.adapterId);
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
  join(fakeHome, '.ssh'),
  grokSessionsDir,
]) {
  mkdirSync(directory, { recursive: true });
}
/**
 * More SSH aliases than the Connect dialog can show at once (BUG-132). The
 * dialog caps its height; the list must scroll inside it rather than be
 * clipped. Names resolve nowhere and nothing here is ever contacted: the eval
 * reads the list and closes the dialog.
 */
const CONNECT_ALIAS_COUNT = 16;
writeFileSync(
  join(fakeHome, '.ssh', 'config'),
  Array.from(
    { length: CONNECT_ALIAS_COUNT },
    (_, index) =>
      `Host eval-host-${String(index + 1).padStart(2, '0')}\n` +
      `  HostName eval-host-${index + 1}.invalid\n  User operator\n`
  ).join('\n')
);
writeFileSync(join(projectDir, 'package.json'), '{}');
/** Qwen Code keeps sign-in and models in its own settings (ENG-003 S5.2):
 *  a configured credential and one configured default model. */
const qwenHome = join(fakeHome, '.qwen');
const qwenChatsDir = join(
  qwenHome,
  'projects',
  projectDir.replace(/[^A-Za-z0-9]/g, '-'),
  'chats'
);
mkdirSync(qwenChatsDir, { recursive: true });
writeFileSync(
  join(qwenHome, 'settings.json'),
  JSON.stringify({
    security: { auth: { selectedType: 'openai' } },
    model: { name: 'eval-qwen-coder' },
  })
);
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
  // Mirrors Qwen Code 0.24.4: a bare version string, and an interactive
  // launch that echoes its argv and the settings layer Exawatt points it at.
  qwen: `#!/bin/sh
if [ "$1" = "--version" ]; then printf '0.24.4\n'; exit 0; fi
printf 'FAKE_QWEN_ARGS:'
printf ' <%s>' "$@"
printf '\nFAKE_QWEN_DEFAULTS:%s\n' "\${QWEN_CODE_SYSTEM_DEFAULTS_PATH-unset}"
if [ -n "$QWEN_CODE_SYSTEM_DEFAULTS_PATH" ] && [ -f "$QWEN_CODE_SYSTEM_DEFAULTS_PATH" ]; then
  printf 'FAKE_QWEN_HOOK_URLS:%s\n' "$(grep -c '127.0.0.1' "$QWEN_CODE_SYSTEM_DEFAULTS_PATH")"
fi
while IFS= read -r input; do printf 'FAKE_QWEN_INPUT:%s\n' "$input"; done
`,
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

/**
 * Wait for the composer to be showing a setup for `engineLabel`.
 *
 * On timeout it states what the launcher IS showing. A bare
 * `page.waitForFunction` timeout here says nothing at all, which is how the
 * pre-D49 drift in this file stayed unreadable for two months (BUG-014).
 */
async function waitForSelectedEngine(page, engineLabel) {
  try {
    await page.waitForFunction(
      label =>
        document
          .querySelector('[data-setup-chip][data-selected]')
          ?.getAttribute('aria-label')
          ?.includes(label),
      engineLabel
    );
  } catch (error) {
    const observed = await page.evaluate(() => ({
      composer: document.querySelectorAll('[data-agent-composer]').length,
      rowState: document
        .querySelector('[data-setup-row]')
        ?.getAttribute('data-row-state'),
      chips: Array.from(document.querySelectorAll('[data-setup-chip]')).map(
        chip => ({
          id: chip.getAttribute('data-setup-id'),
          selected: chip.getAttribute('data-selected'),
          label: chip.getAttribute('aria-label'),
        })
      ),
    }));
    throw new Error(
      `The composer never selected ${engineLabel}. Observed: ` +
        `${JSON.stringify(observed)}\n${error.message}`
    );
  }
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

      // BUG-132: a long server list must scroll inside the Connect dialog.
      // The dialog caps its own height; with the base dialog laid out as a
      // grid, the list body could not shrink, grew to its content, and the
      // container clipped it at a row boundary — the operator's two real
      // servers were the rows below the fold, with no scrollbar and no hint.
      // The contract is mechanism, not markup: the element that overflows is
      // one the operator can scroll, and its last row lands inside the dialog.
      await page
        .locator('[data-connected-sources-empty] button', {
          hasText: 'Connect existing Agent',
        })
        .click();
      const connectDialog = page.locator('[data-connect-source]');
      await connectDialog.waitFor();
      await connectDialog.locator('[data-connect-adapter="openclaw"]').click();
      const serverRows = connectDialog.locator('[data-connect-server]');
      await serverRows.first().waitFor();
      await serverRows.last().scrollIntoViewIfNeeded();
      const serverList = await page.evaluate(() => {
        const dialog = document.querySelector('[data-connect-source]');
        const rows = [...dialog.querySelectorAll('[data-connect-server]')];
        const last = rows[rows.length - 1];
        let scroller = null;
        for (
          let el = last.parentElement;
          el && el !== dialog.parentElement;
          el = el.parentElement
        ) {
          if (el.scrollHeight > el.clientHeight + 1) {
            scroller = el;
            break;
          }
        }
        const overflowY = scroller
          ? getComputedStyle(scroller).overflowY
          : null;
        const d = dialog.getBoundingClientRect();
        const r = last.getBoundingClientRect();
        return {
          rows: rows.length,
          overflowY,
          lastInsideDialog: r.top >= d.top && r.bottom <= d.bottom + 1,
        };
      });
      check(
        'a long server list scrolls inside the Connect dialog and its last row is reachable (BUG-132)',
        serverList.rows === CONNECT_ALIAS_COUNT &&
          (serverList.overflowY === 'auto' ||
            serverList.overflowY === 'scroll') &&
          serverList.lastInsideDialog,
        JSON.stringify(serverList)
      );
      await page.screenshot({
        path: join(output, 'connect-server-list-end.png'),
      });
      await page.keyboard.press('Escape');
      await connectDialog.waitFor({ state: 'detached' });

      const registry = await page.evaluate(() =>
        window.electron?.agentSources?.list('all')
      );
      check(
        'registry returns one normalized record per declared source',
        JSON.stringify(registry?.sources.map(source => source.adapterId)) ===
          JSON.stringify(declaredSourceIds),
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
      const grok = registry?.sources.find(
        source => source.adapterId === 'grok'
      );
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
          true && grok?.capabilities.effortSelection === 'source-owned',
        JSON.stringify(grok?.capabilities)
      );
      const qwen = registry?.sources.find(
        source => source.adapterId === 'qwen'
      );
      const qwenReady =
        qwen?.state === 'ready' &&
        qwen?.facts.authentication.value === 'Configured: openai' &&
        qwen?.facts.authentication.provenance.kind === 'source-config' &&
        qwen?.facts.modelDiscovery.value === 'Default model configured';
      check(
        'Qwen Code is ready from its own settings, claiming a configured credential only',
        qwenReady,
        qwenReady ? '' : JSON.stringify(qwen)
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
      await openSetupDrawer(page);
      check(
        'composer exposes the source-reported Claude default',
        (await launcherAxis(page, 'model').innerText()).includes(
          'Default (recommended)'
        )
      );
      const launchRegistry = await page.evaluate(() =>
        window.electron?.agentSources?.list('launch')
      );
      check(
        'composer scope contains only interactive local sources',
        JSON.stringify(
          launchRegistry?.sources.map(source => source.adapterId)
        ) === JSON.stringify(declaredHarnessIds) &&
          launchRegistry.sources.every(source => source.harness !== null),
        JSON.stringify(launchRegistry?.sources.map(source => source.adapterId))
      );
      await app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0]?.webContents.send(
          'menu:command',
          'launch-opencode'
        );
      });
      await waitForSelectedEngine(page, 'OpenCode');
      await openSetupDrawer(page);
      check(
        'native OpenCode launch command opens the composer with OpenCode preselected',
        (await selectedLauncherSetup(page).getAttribute('aria-label')).includes(
          'OpenCode'
        ) && (await page.locator('[data-agent-composer]').count()) === 1
      );
      await launcherAxis(page, 'model').click();
      await page.getByRole('option', { name: /Eval Open Model/ }).click();
      check(
        'OpenCode model and exact variants reach the composer controls',
        (await launcherAxis(page, 'model').innerText()).includes(
          'Eval Open Model'
        ) && !(await launcherAxis(page, 'thinking').isDisabled())
      );
      await launcherAxis(page, 'thinking').click();
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
      await waitForSelectedEngine(page, 'Grok Build');
      await openSetupDrawer(page);
      check(
        'native Grok Build launch command opens the composer with Grok preselected',
        (await selectedLauncherSetup(page).getAttribute('aria-label')).includes(
          'Grok Build'
        ) && (await page.locator('[data-agent-composer]').count()) === 1
      );
      check(
        'the source default model is pinned and no effort control is offered',
        (await launcherAxis(page, 'model').innerText()).includes(
          'Eval Grok 4.5'
        ) && (await launcherAxis(page, 'thinking').isDisabled()),
        await launcherAxis(page, 'model').innerText()
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

      // ---- Qwen Code (ENG-003 S5.2) ----------------------------------------
      await app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0]?.webContents.send(
          'menu:command',
          'launch-qwen'
        );
      });
      await waitForSelectedEngine(page, 'Qwen Code');
      await openSetupDrawer(page);
      check(
        'the configured Qwen model is pinned and no effort control is offered',
        (await launcherAxis(page, 'model').innerText()).includes(
          'Eval Qwen Coder'
        ) && (await launcherAxis(page, 'thinking').isDisabled()),
        await launcherAxis(page, 'model').innerText()
      );
      await page
        .getByLabel('Initial task for the new Agent')
        .fill('Verify the Qwen Code launch adapter');
      await page.getByRole('button', { name: 'Start', exact: true }).click();
      const qwenLaunched = await page.evaluate(async () => {
        const deadline = Date.now() + 20_000;
        while (Date.now() < deadline) {
          const sessions = await window.electron?.pty?.list();
          const session = sessions?.find(item => item.harness === 'qwen');
          const buffer = session
            ? await window.electron?.pty?.buffer(session.id)
            : '';
          if (session?.harnessSessionId && buffer.includes('FAKE_QWEN_ARGS'))
            return { session, buffer };
          await new Promise(resolveWait => setTimeout(resolveWait, 100));
        }
        return null;
      });
      const qwenBuffer = qwenLaunched?.buffer ?? '';
      const qwenIdentity = qwenLaunched?.session.harnessSessionId ?? '';
      check(
        'Exawatt allocates the Qwen session identity and keeps the task interactive',
        /^[0-9a-f-]{36}$/.test(qwenIdentity) &&
          qwenBuffer.includes(`<--session-id> <${qwenIdentity}>`) &&
          qwenBuffer.includes('<-i> <Verify the Qwen Code launch adapter>') &&
          qwenBuffer.includes('<-m> <eval-qwen-coder>') &&
          qwenBuffer.includes('<--approval-mode>'),
        qwenBuffer
      );
      check(
        'Qwen hooks ride the lowest settings layer, never the user config',
        /FAKE_QWEN_DEFAULTS:\/\S+/.test(qwenBuffer) &&
          !qwenBuffer.includes('FAKE_QWEN_DEFAULTS:unset') &&
          /FAKE_QWEN_HOOK_URLS:[1-9]/.test(qwenBuffer),
        qwenBuffer
      );

      // Qwen Code writes its own transcript; the recent row must come from
      // that file and resume only its exact identity.
      writeFileSync(
        join(qwenChatsDir, `${qwenIdentity}.jsonl`),
        `${JSON.stringify({
          uuid: 'eval-qwen-first',
          parentUuid: null,
          sessionId: qwenIdentity,
          timestamp: new Date().toISOString(),
          type: 'user',
          provenance: 'real_user',
          cwd: projectDir,
          version: '0.24.4',
          message: { role: 'user', parts: [{ text: 'Qwen Code launch eval' }] },
        })}\n`
      );
      await page.waitForTimeout(10_500);
      await app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0]?.webContents.send(
          'menu:command',
          'launch-qwen'
        );
      });
      const recentQwen = page.locator(
        `[data-conversation-id="${qwenIdentity}"]`
      );
      await recentQwen.waitFor();
      check(
        'the Qwen transcript appears as a native provider conversation',
        (await recentQwen.getAttribute('data-continuation')) === 'provider' &&
          (await recentQwen.getAttribute('data-title-source')) === 'native' &&
          (await recentQwen.innerText()).includes('Qwen Code launch eval')
      );
      await recentQwen.locator('button').first().click();
      const qwenResumed = await page.evaluate(async originalSessionId => {
        const deadline = Date.now() + 20_000;
        while (Date.now() < deadline) {
          const sessions = await window.electron?.pty?.list();
          const session = sessions?.find(
            item => item.harness === 'qwen' && item.id !== originalSessionId
          );
          const buffer = session
            ? await window.electron?.pty?.buffer(session.id)
            : '';
          if (session?.harnessSessionId && buffer.includes('FAKE_QWEN_ARGS'))
            return { session, buffer };
          await new Promise(resolveWait => setTimeout(resolveWait, 100));
        }
        return null;
      }, qwenLaunched?.session.id ?? '');
      check(
        'the Qwen recent row resumes only its exact identity',
        qwenResumed?.session.harnessSessionId === qwenIdentity &&
          qwenResumed.buffer.includes(`<--resume> <${qwenIdentity}>`) &&
          !qwenResumed.buffer.includes('<--continue>'),
        qwenResumed?.buffer ?? 'No resumed Qwen session'
      );

      check(
        'renderer emitted no uncaught page errors',
        pageErrors.length === 0,
        pageErrors.join('; ')
      );
    },
    // Each launchable source's launch-and-resume section costs about 15s,
    // most of it the recent-conversation refresh; the budget scales with them.
    { maxMs: 180_000 }
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
