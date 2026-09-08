#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

import { withElectronApp } from './lib/electron-eval.mjs';
import {
  assertPackagedContract,
  assertPackagedSource,
  resolvePackagedApp,
} from './lib/packaged-app.mjs';
import { ConnectedGatewayFixture } from './lib/connected-gateway-fixture.mjs';

const LIVE = process.env.EXAWATT_FLEET_PACKAGED_LIVE === '1';
const LIVE_CONFIRMATION = 'two-customer-hosted-sources';
const EXPECTED_AGENTS = 3;
const FIXTURE_MESSAGE = 'Packaged fleet acceptance check';
const LIVE_DEVICE_LISTING_ATTEMPTS = 3;
const LIVE_DEVICE_LISTING_RETRY_MS = 750;
const require = createRequire(import.meta.url);

function check(name, condition, detail = '') {
  console.log(
    `${condition ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`
  );
  assert.ok(condition, name);
}

async function packageForCurrentTree() {
  const expectedSha = execFileSync('git', ['rev-parse', 'HEAD'], {
    encoding: 'utf8',
  }).trim();
  const overridden = Boolean(process.env.EXAWATT_APP_PATH);
  let packaged = await resolvePackagedApp();
  const usable = () => {
    if (!existsSync(packaged.executablePath)) return false;
    try {
      assertPackagedContract(packaged.appPath, packaged.digest);
      assertPackagedSource(packaged.appPath, expectedSha);
      return true;
    } catch {
      return false;
    }
  };
  if (!usable()) {
    if (overridden) {
      assertPackagedContract(packaged.appPath, packaged.digest);
      assertPackagedSource(packaged.appPath, expectedSha);
    }
    console.log(
      '[connected-fleet] no exact package; building the current tree'
    );
    execFileSync('pnpm', ['electron:build:dir'], { stdio: 'inherit' });
    execFileSync('node', ['scripts/discard-electron-snapshot.mjs'], {
      stdio: 'inherit',
    });
    packaged = await resolvePackagedApp();
  }
  assertPackagedContract(packaged.appPath, packaged.digest);
  assertPackagedSource(packaged.appPath, expectedSha);
  return packaged;
}

function localSource(gateway) {
  return {
    displayName: gateway.label,
    input: {
      adapterId: 'openclaw',
      placement: 'customer-hosted',
      displayName: gateway.label,
      transport: { kind: 'local-loopback', port: gateway.port },
      credentialOwner: 'exawatt-keychain',
    },
  };
}

function liveSources() {
  if (process.env.EXAWATT_FLEET_ALLOW_LIVE !== LIVE_CONFIRMATION) {
    throw new Error(
      `Live mode is inert until EXAWATT_FLEET_ALLOW_LIVE=${LIVE_CONFIRMATION}`
    );
  }
  const aliases = (process.env.EXAWATT_LIVE_OPENCLAW_ALIASES ?? '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);
  if (aliases.length !== 2) {
    throw new Error(
      'Live mode requires exactly two aliases in EXAWATT_LIVE_OPENCLAW_ALIASES.'
    );
  }
  if (
    aliases.some(
      alias => alias.startsWith('-') || !/^[A-Za-z0-9._-]{1,255}$/.test(alias)
    )
  ) {
    throw new Error('Live mode received an unusable SSH alias.');
  }
  return aliases.map(alias => ({
    displayName: alias,
    input: {
      adapterId: 'openclaw',
      placement: 'customer-hosted',
      displayName: alias,
      transport: { kind: 'ssh-alias', alias, remotePort: 1337 },
      credentialOwner: 'source-owned-ssh',
    },
  }));
}

function liveRemoteExec() {
  const compiled = join(
    process.cwd(),
    'dist-electron',
    'main',
    'gateway-bootstrap.js'
  );
  if (!existsSync(compiled)) {
    throw new Error(
      'Live mode requires the compiled Electron main from pnpm worktree:setup.'
    );
  }
  return require(compiled).createSshRemoteExec();
}

async function livePairedDeviceIds(alias) {
  const remoteExec = liveRemoteExec();
  let lastProblem = 'no attempt was made';
  for (let attempt = 1; attempt <= LIVE_DEVICE_LISTING_ATTEMPTS; attempt += 1) {
    const listed = await remoteExec({ kind: 'ssh-alias', alias }, [
      'openclaw',
      'devices',
      'list',
      '--json',
    ]);
    if (listed.code === 0) {
      try {
        const parsed = JSON.parse(listed.stdout);
        if (
          !parsed ||
          typeof parsed !== 'object' ||
          Array.isArray(parsed) ||
          !Array.isArray(parsed.paired)
        ) {
          throw new Error('the listing shape was invalid');
        }
        const ids = new Set();
        for (const device of parsed.paired) {
          const deviceId = device?.deviceId;
          if (
            typeof deviceId !== 'string' ||
            !/^[a-f0-9]{64}$/.test(deviceId) ||
            ids.has(deviceId)
          ) {
            throw new Error('the listing carried an invalid device identity');
          }
          ids.add(deviceId);
        }
        return ids;
      } catch {
        lastProblem = 'the listing was not valid device JSON';
      }
    } else {
      lastProblem = 'the listing command failed';
    }
    if (attempt < LIVE_DEVICE_LISTING_ATTEMPTS) {
      await new Promise(resolve =>
        setTimeout(resolve, LIVE_DEVICE_LISTING_RETRY_MS * attempt)
      );
    }
  }
  throw new Error(
    `Could not read the live device listing after ${LIVE_DEVICE_LISTING_ATTEMPTS} attempts: ${lastProblem}`
  );
}

async function removeLiveDevicesCreatedDuringRun(alias, before) {
  let current;
  try {
    current = await livePairedDeviceIds(alias);
  } catch (error) {
    console.warn(
      `[connected-fleet] live device cleanup skipped because the current listing was unreadable: ${error instanceof Error ? error.message : String(error)}`
    );
    return;
  }
  const remoteExec = liveRemoteExec();
  for (const deviceId of current) {
    if (before.has(deviceId)) continue;
    const removed = await remoteExec({ kind: 'ssh-alias', alias }, [
      'openclaw',
      'devices',
      'remove',
      deviceId,
    ]);
    if (removed.code !== 0) {
      throw new Error('A device created by the live run could not be removed.');
    }
  }
}

async function snapshotLivePairedDevices(sources) {
  const entries = await Promise.all(
    sources.map(async source => {
      const alias = source.input.transport.alias;
      return [alias, await livePairedDeviceIds(alias)];
    })
  );
  return new Map(entries);
}

async function preparePage(page) {
  page.setDefaultTimeout(30_000);
  await page.locator('[data-command-altitude]').waitFor({ timeout: 60_000 });
  await page.waitForURL(url => url.pathname === '/workspace');
  const bridge = await page.evaluate(() => ({
    electron: window.electron?.isElectron === true,
    connected: Boolean(window.electron?.connectedSources),
  }));
  check(
    'packaged renderer exposes the connected-source preload',
    bridge.electron && bridge.connected
  );
}

async function configureSources(page, sources) {
  return page.evaluate(async configured => {
    const api = window.electron?.connectedSources;
    if (!api) throw new Error('connected-source preload absent');
    const connected = [];
    for (const source of configured) {
      const added = await api.add(source.input);
      if (!added?.ok || !added.source) {
        throw new Error(
          `Could not add ${source.displayName}: ${JSON.stringify(added)}`
        );
      }
      const observed = await api.connect(added.source.id);
      if (!observed?.ok) {
        throw new Error(
          `Could not connect ${source.displayName}: ${JSON.stringify(observed)}`
        );
      }
      const mappings = observed.agents.map(agent => ({
        nativeAgentId: agent.nativeAgentId,
        projectId: `fixture-project-${added.source.id}-${agent.nativeAgentId}`,
        projectLabel: `${source.displayName} · ${agent.displayName}`,
        displayNameOverride: null,
      }));
      const mapped = await api.mapAgents(added.source.id, mappings);
      if (!mapped?.ok || mapped.mapped !== mappings.length) {
        throw new Error(
          `Could not map ${source.displayName}: ${JSON.stringify(mapped)}`
        );
      }
      connected.push({
        sourceId: added.source.id,
        displayName: source.displayName,
        agents: observed.agents,
      });
    }
    return connected;
  }, sources);
}

async function waitForRoster(page, count = EXPECTED_AGENTS) {
  let encoded;
  try {
    encoded = await page.evaluate(
      ({ expected, timeoutMs }) => {
        const api = window.electron?.connectedSources;
        if (!api) throw new Error('connected-source preload absent');

        return new Promise((resolve, reject) => {
          let settled = false;
          let reading = false;
          let readAgain = false;
          let lastCount = null;
          let lastReadFailed = false;
          let unsubscribe = () => {};
          let timeout = null;

          const cleanup = () => {
            if (timeout !== null) window.clearTimeout(timeout);
            unsubscribe();
          };
          const succeed = value => {
            if (settled) return;
            settled = true;
            cleanup();
            resolve(value);
          };
          const fail = error => {
            if (settled) return;
            settled = true;
            cleanup();
            reject(error);
          };
          const project = agents =>
            agents.map(agent => ({
              id: agent.id,
              sourceId: agent.source.id,
              nativeAgentId: agent.nativeAgentId,
              projectId: agent.projectId,
              primaryContextId: agent.primaryContextId,
            }));
          const read = async () => {
            if (settled) return;
            if (reading) {
              readAgain = true;
              return;
            }
            reading = true;
            try {
              do {
                readAgain = false;
                try {
                  const agents = await api.agents();
                  if (settled) return;
                  lastCount = Array.isArray(agents) ? agents.length : null;
                  lastReadFailed = false;
                  if (lastCount === expected) {
                    succeed(JSON.stringify(project(agents)));
                    return;
                  }
                } catch {
                  lastReadFailed = true;
                }
              } while (readAgain && !settled);
            } finally {
              reading = false;
              if (readAgain && !settled) void read();
            }
          };

          // Subscribe before the first pull so startup cannot move the roster
          // between an empty read and listener registration.
          unsubscribe =
            api.onChanged?.(() => {
              readAgain = true;
              void read();
            }) ?? (() => {});
          timeout = window.setTimeout(() => {
            fail(
              new Error(
                `roster subscription timed out (lastCount=${lastCount}, lastReadFailed=${lastReadFailed})`
              )
            );
          }, timeoutMs);
          void read();
        });
      },
      { expected: count, timeoutMs: 60_000 }
    );
  } catch (error) {
    const observed = await page.evaluate(async () => {
      const api = window.electron?.connectedSources;
      if (!api) return { preload: false };
      const [sources, statuses, agents] = await Promise.all([
        api.list(),
        api.status(),
        api.agents(),
      ]);
      return {
        preload: true,
        sourceCount: sources.length,
        rosterCount: agents.length,
        statuses: statuses.map(status => ({
          sourceId: status.sourceId,
          state: status.connection.state,
          snapshotRevision: status.snapshotRevision,
        })),
      };
    });
    throw new Error(
      `The connected roster never reached ${count} Agents. Observed: ${JSON.stringify(observed)}`,
      { cause: error }
    );
  }

  assert.equal(
    typeof encoded,
    'string',
    'the accepted roster must cross the evaluation boundary as JSON'
  );
  const roster = JSON.parse(encoded);
  assert.ok(
    Array.isArray(roster) && roster.length === count,
    'the accepted roster must be the exact coherent observation'
  );
  assert.ok(
    roster.every(
      agent =>
        typeof agent?.id === 'string' &&
        typeof agent.sourceId === 'string' &&
        typeof agent.nativeAgentId === 'string' &&
        typeof agent.projectId === 'string' &&
        (typeof agent.primaryContextId === 'string' ||
          agent.primaryContextId === null)
    ),
    'the accepted roster must contain complete source-qualified identities'
  );
  return roster;
}

function stableIdentities(agents) {
  return agents
    .map(agent => ({
      id: agent.id,
      sourceId: agent.sourceId,
      nativeAgentId: agent.nativeAgentId,
      projectId: agent.projectId,
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

async function openFromTeam(page, agentId) {
  await page.keyboard.press('Control+Meta+2');
  const tiles = page.locator('[data-expose-agent]');
  await page.waitForFunction(
    expected =>
      document.querySelectorAll('[data-expose-agent]').length === expected,
    EXPECTED_AGENTS
  );
  check(
    'Team renders every connected coworker once',
    (await tiles.count()) === EXPECTED_AGENTS
  );
  await page.locator(`[data-expose-agent="${agentId}"]`).click();
  await page.locator(`[data-remote-agent-pane="${agentId}"]`).waitFor();
  await page.locator(`[data-remote-agent="${agentId}"]`).waitFor();
  check('Team opens the selected remote Agent', true);
}

async function openFromFleet(page, agent) {
  const origin = new URL(page.url()).origin;
  const query = new URLSearchParams({
    altitude: 'agent',
    project: agent.projectId,
    agent: agent.id,
  });
  await page.goto(`${origin}/fleet/spatial?${query}`);
  await page.locator('[data-spatial-command]').waitFor({ timeout: 60_000 });
  await page.waitForFunction(
    expected =>
      Number(
        document
          .querySelector('[data-spatial-command]')
          ?.getAttribute('data-agent-count')
      ) >= expected,
    EXPECTED_AGENTS,
    { timeout: 60_000 }
  );
  const open = page.locator(`[data-open-agent="${agent.id}"]`);
  await open.waitFor({ timeout: 60_000 });
  check('Fleet inspects a connected coworker as an Agent', true);
  await open.click();
  await page.waitForURL(url => url.pathname === '/workspace');
  await page.locator(`[data-remote-agent-pane="${agent.id}"]`).waitFor();
  check('Fleet opens the remote Agent in the shared workspace', true);
}

async function grantAndSend(page, gateway, sourceId, agent) {
  const surface = page.locator(`[data-remote-agent="${agent.id}"]`);
  const request = surface.locator(
    '[data-composer-action="request-send-access"]'
  );
  await request.waitFor();
  await request.click();
  await surface
    .locator('[data-composer-withheld="write-access-awaiting-approval"]')
    .waitFor();
  check('send stays visibly gated until the source approves it', true);

  gateway.approveWrite();
  const outcome = await page.evaluate(
    id => window.electron.connectedSources.requestCommandAuthority(id),
    sourceId
  );
  check(
    'the approved source grants write authority',
    outcome?.outcome === 'granted' && outcome.authority === 'write',
    JSON.stringify(outcome)
  );
  const composer = surface.locator('form[data-composer-target]');
  await composer.waitFor();
  await composer.locator('textarea').fill(FIXTURE_MESSAGE);
  await composer.getByRole('button', { name: 'Send' }).click();
  await surface
    .getByText(`${gateway.label} received: ${FIXTURE_MESSAGE}`)
    .waitFor();
  check(
    'authority-gated send and streamed reply cross the packaged boundary',
    true
  );
  check(
    'Gateway received one message with an idempotency key',
    gateway.receivedMessages.length === 1 &&
      gateway.receivedMessages[0].message === FIXTURE_MESSAGE &&
      typeof gateway.receivedMessages[0].idempotencyKey === 'string'
  );
}

async function proveOneSourceOutage(
  page,
  failedGateway,
  failedSourceId,
  healthySourceId
) {
  await failedGateway.goAway();
  await page.waitForFunction(
    async ({ failed, healthy }) => {
      const statuses = await window.electron?.connectedSources?.status();
      const down = statuses?.find(status => status.sourceId === failed);
      const up = statuses?.find(status => status.sourceId === healthy);
      return (
        down?.connection.state !== 'live' && up?.connection.state === 'live'
      );
    },
    { failed: failedSourceId, healthy: healthySourceId },
    { timeout: 60_000 }
  );
  const lastKnown = await page.evaluate(async () => {
    const agents = await window.electron.connectedSources.agents();
    return agents.map(agent => ({
      sourceId: agent.source.id,
      stale: agent.connection.stalePresentation,
    }));
  });
  check(
    'one-source outage is visible without evicting its coworkers',
    lastKnown.length === EXPECTED_AGENTS &&
      lastKnown.some(row => row.sourceId === failedSourceId && row.stale)
  );

  await failedGateway.comeBack();
  await page.waitForFunction(
    async sourceId => {
      const statuses = await window.electron?.connectedSources?.status();
      return (
        statuses?.find(status => status.sourceId === sourceId)?.connection
          .state === 'live'
      );
    },
    failedSourceId,
    { timeout: 90_000 }
  );
  check('the failed source recovers to a fresh observation', true);
}

async function firstLaunch({ executablePath, env, sources, gateways }) {
  return withElectronApp(
    { executablePath, cwd: process.cwd(), env },
    async (_app, page) => {
      await preparePage(page);
      const configured = await configureSources(page, sources);
      const roster = await waitForRoster(page);
      check(
        'two Gateways project the canonical three-Agent fleet',
        roster.length === EXPECTED_AGENTS
      );

      const commandAgent = roster.find(
        agent => agent.primaryContextId !== null
      );
      assert.ok(commandAgent, 'the fleet needs one conversation-capable Agent');
      await openFromTeam(page, commandAgent.id);
      await openFromFleet(page, commandAgent);

      if (!LIVE) {
        const gateway = gateways.find(
          candidate => candidate.port === sources[0].input.transport.port
        );
        assert.ok(gateway, 'command Gateway fixture missing');
        await grantAndSend(page, gateway, configured[0].sourceId, commandAgent);
        await proveOneSourceOutage(
          page,
          gateway,
          configured[0].sourceId,
          configured[1].sourceId
        );
      } else {
        console.log(
          'PASS live mode is observation-only; no authority request or send was issued'
        );
      }
      return {
        identities: stableIdentities(await waitForRoster(page)),
        commandAgentId: commandAgent.id,
      };
    },
    { maxMs: 240_000, firstWindowMs: 60_000, attempts: 1 }
  );
}

async function secondLaunch({ executablePath, env, expected }) {
  return withElectronApp(
    { executablePath, cwd: process.cwd(), env },
    async (_app, page) => {
      await preparePage(page);
      const roster = await waitForRoster(page);
      assert.deepEqual(stableIdentities(roster), expected.identities);
      check(
        'relaunch preserves source-qualified Agent and Project identities',
        true
      );
      check(
        'the previously opened Agent resolves to the same identity after relaunch',
        roster.some(agent => agent.id === expected.commandAgentId)
      );
      const restoredAgent = roster.find(
        agent => agent.id === expected.commandAgentId
      );
      assert.ok(
        restoredAgent,
        'the restored fleet must contain the opened Agent'
      );
      await openFromTeam(page, restoredAgent.id);
      await openFromFleet(page, restoredAgent);
      check('relaunch restores Agent, Team, and Fleet UI parity', true);
    },
    { maxMs: 180_000, firstWindowMs: 60_000, attempts: 1 }
  );
}

const root = mkdtempSync(join(tmpdir(), 'exawatt-connected-fleet-'));
const userData = join(root, 'userData');
const fakeHome = join(root, 'home');
mkdirSync(userData, { recursive: true });
mkdirSync(fakeHome, { recursive: true });

const gateways = [];
let liveDevicesBefore = null;
try {
  const packaged = await packageForCurrentTree();
  let sources;
  let openClawStateDir;
  if (LIVE) {
    sources = liveSources();
    liveDevicesBefore = await snapshotLivePairedDevices(sources);
    console.log(
      '[connected-fleet] LIVE observation-only mode explicitly enabled'
    );
  } else {
    const north = new ConnectedGatewayFixture({
      label: 'Fixture North',
      agents: [
        { id: 'marcus', name: 'Marcus', hasPrimaryConversation: true },
        { id: 'scout', name: 'Scout', hasPrimaryConversation: true },
      ],
    });
    const south = new ConnectedGatewayFixture({
      label: 'Fixture South',
      agents: [{ id: 'tyler', name: 'Tyler', hasPrimaryConversation: false }],
    });
    gateways.push(north, south);
    await Promise.all(gateways.map(gateway => gateway.start()));
    sources = gateways.map(localSource);
    const configDir = join(fakeHome, '.openclaw');
    mkdirSync(configDir, { recursive: true });
    openClawStateDir = configDir;
    writeFileSync(
      join(configDir, 'openclaw.json'),
      JSON.stringify({
        gateway: {
          port: north.port,
          bind: 'loopback',
          auth: { mode: 'token', token: north.sharedToken },
        },
      })
    );
  }

  const env = {
    ...process.env,
    EXAWATT_TEST: '1',
    EXAWATT_USER_DATA: userData,
    EXAWATT_RENDERER_LOGS: '1',
    ...(openClawStateDir
      ? { EXAWATT_TEST_OPENCLAW_STATE_DIR: openClawStateDir }
      : {}),
  };
  const first = await firstLaunch({
    executablePath: packaged.executablePath,
    env,
    sources,
    gateways,
  });
  await secondLaunch({
    executablePath: packaged.executablePath,
    env,
    expected: first,
  });
  if (!LIVE) {
    check(
      'relaunch used saved scoped device credentials rather than source secrets',
      gateways.every(gateway => gateway.authenticationModes.at(-1) === 'device')
    );
  }
  console.log('\nCONNECTED FLEET PACKAGED EVAL PASSED');
} finally {
  try {
    await Promise.all(gateways.map(gateway => gateway.close()));
    if (liveDevicesBefore) {
      await Promise.all(
        [...liveDevicesBefore].map(([alias, before]) =>
          removeLiveDevicesCreatedDuringRun(alias, before)
        )
      );
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
