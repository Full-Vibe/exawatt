#!/usr/bin/env node

/**
 * The Connect flow, measured (ENG-033 H2.4 P5).
 *
 * Drives ⌘N → Connect a server… and send access in the real Electron app,
 * through the real preload, IPC, tunnel owner, and remote exec, against two
 * `ConnectedGatewayFixture` servers reached by a stand-in `ssh`
 * (`lib/connect-eval-ssh.mjs`). It counts what the operator does and what
 * each step costs on their servers, and holds both to budgets, because the
 * audit that started H2.4 scored this flow on clicks, screens, and SSH logins
 * and the redesign is only real while those numbers stay down.
 *
 * Every name and address here is invented: the documentation ranges of
 * RFC 5737 and example domains, arranged the way a real operator's SSH
 * configuration looks (unrelated and dead hosts first, the fleet last).
 */

import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { withElectronApp } from './lib/electron-eval.mjs';
import { ConnectedGatewayFixture } from './lib/connected-gateway-fixture.mjs';

/** What one connect may cost after ⌘N: open Connect, pick, Connect. */
const CONNECT_CLICK_BUDGET = 3;
/** Tunnel, config read, version read. A test that needs more has regressed. */
const CONNECT_LOGIN_BUDGET = 3;
/** Ask (two reads), list, approve, ask again (two reads). */
const ONE_CLICK_LOGIN_BUDGET = 6;

const ALIASES = [
  'studio-site.example.com',
  'studio-site',
  'retired-box-1',
  'retired-box-2',
  'localhost',
  'work-ops',
  'work-db',
  '192.0.2.10',
  '198.51.100.7',
  'build.example.net',
  'openclaw-north',
  'openclaw-south',
];
const DEAD = '198.51.100.7';
const NORTH = 'openclaw-north';
const SOUTH = 'openclaw-south';
/** Another device's request, waiting on each server. Never Exawatt's to approve. */
const OTHER_DEVICE = 'f'.repeat(64);

const root = mkdtempSync(join(tmpdir(), 'exawatt-connect-flow-'));
const userData = join(root, 'userData');
const fakeHome = join(root, 'home');
const fakeBin = join(root, 'bin');
const output = resolve('.artifacts', 'connect-flow');
for (const directory of [
  userData,
  fakeHome,
  fakeBin,
  output,
  join(fakeHome, '.ssh'),
]) {
  mkdirSync(directory, { recursive: true });
}
writeFileSync(
  join(fakeHome, '.ssh', 'config'),
  ALIASES.map(alias => `Host ${alias}\n  HostName ${alias}.invalid\n`).join(
    '\n'
  )
);

const gateways = {
  [NORTH]: new ConnectedGatewayFixture({
    label: 'Fixture North',
    agents: [
      { id: 'marcus', name: 'Marcus', hasPrimaryConversation: true },
      { id: 'scout', name: 'Scout', hasPrimaryConversation: true },
    ],
  }),
  [SOUTH]: new ConnectedGatewayFixture({
    label: 'Fixture South',
    agents: [{ id: 'tyler', name: 'Tyler', hasPrimaryConversation: true }],
  }),
};
for (const gateway of Object.values(gateways)) {
  await gateway.start();
  gateway.addPendingRequest({
    deviceId: OTHER_DEVICE,
    publicKey: 'another-device-public-key',
    scopes: ['operator.read', 'operator.write'],
    role: 'operator',
    roles: ['operator'],
  });
}

/** The servers' own `openclaw devices` answers, kept by the fixtures. */
const approvals = [];
const control = createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://control.invalid');
  const alias = url.searchParams.get('alias') ?? '';
  const gateway = gateways[alias];
  if (!gateway) return response.writeHead(404).end();
  if (url.pathname === '/list') {
    return response.writeHead(200).end(JSON.stringify(gateway.pairingList()));
  }
  if (url.pathname === '/approve') {
    const approved = gateway.approveRequest(url.searchParams.get('id'));
    approvals.push({ alias, deviceId: approved?.deviceId ?? null });
    return response.writeHead(approved ? 200 : 404).end();
  }
  return response.writeHead(404).end();
});
await new Promise(ready => control.listen(0, '127.0.0.1', ready));

const sshLog = join(root, 'ssh.jsonl');
const sshConfig = join(root, 'ssh.json');
writeFileSync(
  sshConfig,
  JSON.stringify({
    hosts: {
      ...Object.fromEntries(
        ALIASES.map(alias => [alias, { unreachable: true }])
      ),
      ...Object.fromEntries(
        Object.entries(gateways).map(([alias, gateway]) => [
          alias,
          { port: gateway.port, token: gateway.sharedToken },
        ])
      ),
    },
    logPath: sshLog,
    controlUrl: `http://127.0.0.1:${control.address().port}`,
  })
);
writeFileSync(
  join(fakeBin, 'ssh'),
  `#!/bin/sh\nexec "${process.execPath}" "${resolve('scripts/lib/connect-eval-ssh.mjs')}" "$@"\n`
);
chmodSync(join(fakeBin, 'ssh'), 0o755);

const logins = () =>
  existsSync(sshLog)
    ? readFileSync(sshLog, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map(line => JSON.parse(line))
    : [];
const loginsTo = alias => logins().filter(entry => entry.alias === alias);
const savedSources = () => {
  const file = join(userData, 'connected-sources.json');
  return existsSync(file)
    ? JSON.parse(readFileSync(file, 'utf8')).sources.length
    : 0;
};

const failures = [];
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures.push(name);
};

const base = process.env.EXA_BASE ?? 'http://localhost:7000';
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
    EXAWATT_TEST_HARNESS_BIN: fakeBin,
    EXAWATT_TEST_QUIT_RESPONSES: 'confirm,confirm,confirm',
    CONNECT_EVAL_SSH_CONFIG: sshConfig,
    EXAWATT_DEV_URL: `${base}/workspace`,
  },
};

try {
  await withElectronApp(
    launch,
    async (app, page) => {
      page.setDefaultTimeout(30_000);
      const pageErrors = [];
      page.on('pageerror', error => pageErrors.push(error.message));
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.locator('[data-command-altitude]').waitFor();

      const dialog = page.locator('[data-connect-source]');
      const server = alias =>
        dialog.locator(`[data-connect-server="${alias}"]`);
      let clicks = 0;
      const click = async locator => {
        clicks += 1;
        await locator.click();
      };
      const openConnect = async () => {
        clicks = 0;
        await page.keyboard.press('Meta+n');
        await page.locator('[data-project-opener]').waitFor();
        await click(page.getByRole('button', { name: /Connect a server/ }));
        await dialog.waitFor();
        await server(ALIASES[0]).waitFor();
      };

      // A dead host fails on its own row and leaves nothing saved.
      await openConnect();
      check(
        'Connect opens on the servers, with no source step',
        (await dialog.locator('[data-connect-adapter]').count()) === 0 &&
          (await dialog.locator('[data-connect-server]').count()) ===
            ALIASES.length
      );
      await click(dialog.getByRole('button', { name: DEAD }));
      await dialog
        .locator(`[data-connect-server="${DEAD}"][data-server-state="failed"]`)
        .waitFor();
      await dialog.screenshot({ path: join(output, 'failed-row.png') });
      check(
        'a server that fails stays on its row and nothing is saved',
        savedSources() === 0 &&
          (await server(DEAD).textContent())?.includes('Nothing was saved'),
        await server(DEAD).textContent()
      );
      check(
        'a dead server is dialed once',
        loginsTo(DEAD).length === 1,
        `${loginsTo(DEAD).length} logins`
      );

      // A typed name is one Return from its test; Connect lands on the Agent.
      const filter = dialog.locator('[data-connect-filter]');
      await filter.fill('north');
      await filter.press('Enter');
      await dialog.locator(`[data-connect-ready="${NORTH}"]`).waitFor();
      await dialog.screenshot({ path: join(output, 'ready-inline.png') });
      check(
        `testing a server costs at most ${CONNECT_LOGIN_BUDGET} SSH logins`,
        loginsTo(NORTH).length <= CONNECT_LOGIN_BUDGET,
        `${loginsTo(NORTH).length} logins`
      );
      await click(dialog.getByRole('button', { name: /Connect 2 Agents/ }));
      await dialog.waitFor({ state: 'detached' });
      const surface = page.locator('[data-remote-agent]').first();
      await surface.waitFor();
      check(
        `a connect takes ${CONNECT_CLICK_BUDGET} clicks or fewer after ⌘N`,
        clicks - 1 <= CONNECT_CLICK_BUDGET,
        `${clicks - 1} clicks after the filter, ${clicks} counting the failed detour`
      );

      // Send access in one click, approving only Exawatt's own request.
      const approve = surface.locator(
        '[data-composer-action="approve-send-access"]'
      );
      await approve.waitFor();
      const before = loginsTo(NORTH).length;
      await approve.click();
      await surface.locator('form[data-composer-target]').waitFor();
      await surface.screenshot({ path: join(output, 'one-click-granted.png') });
      check('one click grants send access', true);
      check(
        `the one click costs at most ${ONE_CLICK_LOGIN_BUDGET} SSH logins`,
        loginsTo(NORTH).length - before <= ONE_CLICK_LOGIN_BUDGET,
        `${loginsTo(NORTH).length - before} logins`
      );
      check(
        'the one click approves Exawatt’s own request and no other',
        approvals.length === 1 &&
          approvals[0].alias === NORTH &&
          approvals[0].deviceId !== OTHER_DEVICE &&
          gateways[NORTH].pending.some(
            entry => entry.deviceId === OTHER_DEVICE
          ),
        JSON.stringify(approvals)
      );

      // The second server: marked, defaulted into the same Project, and the
      // copy path finishing with the exact command.
      await openConnect();
      await server(NORTH).scrollIntoViewIfNeeded();
      const northState = await server(NORTH).getAttribute('data-server-state');
      const northText = (await server(NORTH).textContent()) ?? '';
      check(
        'a connected server names its coworkers and cannot connect twice',
        northState === 'connected' &&
          /Marcus/.test(northText) &&
          (await server(NORTH).getByRole('button').count()) === 0 &&
          (await server(NORTH).getByText('Manage').count()) === 1,
        northText
      );
      await click(dialog.getByRole('button', { name: SOUTH }));
      await dialog.locator(`[data-connect-ready="${SOUTH}"]`).waitFor();
      await click(dialog.getByRole('button', { name: /Connect Tyler/ }));
      await dialog.waitFor({ state: 'detached' });
      check(
        `the second connect also takes ${CONNECT_CLICK_BUDGET} clicks`,
        clicks <= CONNECT_CLICK_BUDGET,
        `${clicks} clicks`
      );
      const plan = JSON.parse(
        readFileSync(join(userData, 'connected-agent-projection.json'), 'utf8')
      );
      check(
        'both servers’ coworkers share one Project by default',
        plan.mappings.length === 3 &&
          new Set(plan.mappings.map(mapping => mapping.projectId)).size === 1,
        JSON.stringify(plan.mappings.map(mapping => mapping.projectLabel))
      );

      const tyler = page.locator('[data-remote-agent]', { hasText: 'Tyler' });
      await tyler
        .locator('[data-composer-action-rank="secondary"]', {
          hasText: 'Show commands',
        })
        .click();
      const commands = tyler.locator('[data-approve-commands]');
      await page.waitForFunction(
        () =>
          [...document.querySelectorAll('[data-approve-commands]')].some(node =>
            /devices approve [0-9a-f-]{36}/.test(node.textContent ?? '')
          ),
        null,
        { timeout: 20_000 }
      );
      const shown = (await commands.textContent()) ?? '';
      await tyler.screenshot({ path: join(output, 'copy-path.png') });
      check(
        'the copy path shows the exact login and request',
        shown.startsWith(`ssh ${SOUTH}\n`) &&
          /openclaw devices approve [0-9a-f-]{36}$/.test(shown),
        shown
      );
      const requestId = shown.match(/approve ([0-9a-f-]{36})/)?.[1] ?? '';
      const byHand = gateways[SOUTH].approveRequest(requestId);
      check(
        'the command names Exawatt’s own request',
        byHand !== null && byHand.deviceId !== OTHER_DEVICE
      );
      await tyler.getByRole('button', { name: 'Check again' }).click();
      await tyler.locator('form[data-composer-target]').waitFor();
      check('Check again finishes the copy path', true);

      const sourceLog = existsSync(
        join(userData, 'logs', 'connected-sources.jsonl')
      )
        ? readFileSync(
            join(userData, 'logs', 'connected-sources.jsonl'),
            'utf8'
          )
        : '';
      check(
        'the one click leaves evidence of how far it got, naming no server',
        sourceLog.includes('"step":"approved"') &&
          !ALIASES.some(alias => sourceLog.includes(alias)),
        ''
      );
      check(
        'renderer emitted no uncaught page errors',
        pageErrors.length === 0,
        pageErrors.join('; ')
      );
    },
    { maxMs: 240_000 }
  );
} finally {
  control.close();
  await Promise.all(Object.values(gateways).map(gateway => gateway.close()));
  rmSync(root, { recursive: true, force: true });
}

if (failures.length > 0) {
  throw new Error(`Connect flow eval failed: ${failures.join(', ')}`);
}
console.log(`PASS connect flow: one screen, send access, budgets (${output})`);
