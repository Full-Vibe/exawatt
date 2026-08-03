#!/usr/bin/env node

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

const root = mkdtempSync(join(tmpdir(), 'exawatt-agent-sources-'));
const userData = join(root, 'userData');
const fakeHome = join(root, 'home');
const fakeBin = join(root, 'bin');
const projectDir = join(root, 'project');
const output = resolve('.artifacts', 'agent-sources');
for (const directory of [
  userData,
  fakeHome,
  fakeBin,
  projectDir,
  output,
  join(fakeHome, '.openclaw'),
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
  openclaw: `#!/bin/sh
if [ "$1" = "--version" ]; then printf 'OpenClaw 2026.8.0-eval\\n'; exit 0; fi
exit 1
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
    async (_app, page) => {
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
        'registry returns four normalized source records',
        registry?.sources.length === 4
      );
      const claude = registry?.sources.find(
        source => source.adapterId === 'claude'
      );
      const codex = registry?.sources.find(
        source => source.adapterId === 'codex'
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
          (await page.getByRole('heading', { name: 'Coming soon' }).count()) ===
            1
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
        launchRegistry?.sources.length === 2 &&
          launchRegistry.sources.every(source => source.harness !== null)
      );
      check(
        'renderer emitted no uncaught page errors',
        pageErrors.length === 0,
        pageErrors.join('; ')
      );
    },
    { maxMs: 90_000 }
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
