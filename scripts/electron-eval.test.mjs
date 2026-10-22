// Eval-harness preflights (ENG-022): the two silent killers of agent
// iteration — an unbuilt node-pty binding (bare "posix_spawnp failed."
// at every PTY spawn) and a dev server that serves a DIFFERENT checkout
// than the one under test — must fail loudly before any Electron launch.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
  realpathSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  assertNodePtyBuilt,
  nodePtyBindingPath,
} from './lib/native-preflight.mjs';
import { createRequire } from 'node:module';
import { _electron as electron } from 'playwright-core';
import {
  anchorMainEvaluate,
  assertDevServerServesTree,
  declareUnlockedHost,
  isExternalTeardown,
  resetForRelaunch,
  resetThrowawayUserData,
  runElectronAttempt,
  waitForPageCondition,
  waitForTreeExit,
  withElectronApp,
} from './lib/electron-eval.mjs';
import { captureElectronProcessGroup } from './lib/electron-process-group.mjs';
import {
  assertFixtureHarnesses,
  FAKE_HARNESSES,
  writeFakeHarness,
} from './lib/harness-probe-fixture.mjs';
import {
  RUNTIME_PACKAGES,
  assertNoPackagingSnapshot,
  discardRuntimeDependencies,
  isRuntimePayloadPath,
  packagesAlongPath,
  resolveRuntimeClosure,
} from './lib/electron-runtime-deps.mjs';

const listen = handler =>
  new Promise(resolve => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () =>
      resolve({ server, origin: `http://127.0.0.1:${server.address().port}` })
    );
  });

test(
  'the verified launch group reaps an orphan holding output pipes and leaves a foreign group alive',
  {
    skip: process.platform === 'win32',
  },
  async t => {
    const foreign = spawn(
      process.execPath,
      [
        '-e',
        `
    process.on('message', () => process.send('pong'));
    process.send('ready');
  `,
      ],
      { detached: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] }
    );
    const leader = spawn(
      process.execPath,
      [
        '-e',
        `
    const {spawn} = require('node:child_process');
    const helper = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      stdio: ['ignore', process.stdout, process.stderr]
    });
    helper.unref();
    process.send({helper: helper.pid});
    process.once('message', () => process.exit(0));
  `,
      ],
      { detached: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] }
    );
    const closed = once(leader, 'close');
    t.after(() => {
      for (const child of [leader, foreign]) {
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch {
          /* already gone */
        }
      }
    });
    await Promise.all([once(foreign, 'message'), once(leader, 'message')]);
    const group = captureElectronProcessGroup(leader.pid);
    assert.ok(group, 'the detached launch group must be verified');
    assert.equal(
      captureElectronProcessGroup(process.pid),
      null,
      'the harness group must never be admitted'
    );
    group.captureMembers();
    const exited = once(leader, 'exit');
    leader.send('orphan');
    await exited;
    assert.equal(
      leader.stdout.destroyed,
      false,
      'the orphan still holds its exited parent output pipe'
    );
    assert.equal(group.forceKill(), true);
    await closed;
    assert.equal(leader.stdout.destroyed, true);
    assert.equal(
      group.forceKill(),
      false,
      'a departed group is never signalled again'
    );
    const pong = once(foreign, 'message');
    foreign.send('ping');
    assert.equal((await pong)[0], 'pong', 'a foreign group remains usable');
  }
);

const DISTRIBUTION_DIGEST = 'a'.repeat(64);

function prepareDistributionIdentity(root, digest = DISTRIBUTION_DIGEST) {
  const directory = join(root, '.exawatt-build');
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'distribution.sha256'), `${digest}\n`);
}

test('a tree without the node-pty binding fails with the rebuild remedy, not posix_spawnp', () => {
  const root = mkdtempSync(join(tmpdir(), 'preflight-'));
  assert.equal(nodePtyBindingPath(root), null);
  assert.throws(
    () => assertNodePtyBuilt(root),
    /worktree:setup|electron:rebuild/
  );
});

test('a built binding passes the preflight', () => {
  const root = mkdtempSync(join(tmpdir(), 'preflight-'));
  const release = join(root, 'node_modules', 'node-pty', 'build', 'Release');
  mkdirSync(release, { recursive: true });
  writeFileSync(join(release, 'pty.node'), '');
  assert.ok(nodePtyBindingPath(root));
  assert.doesNotThrow(() => assertNodePtyBuilt(root));
});

test('a dev server serving the SAME tree passes', async () => {
  const root = mkdtempSync(join(tmpdir(), 'devid-'));
  prepareDistributionIdentity(root);
  const { server, origin } = await listen((_request, response) => {
    response.setHeader('content-type', 'application/json');
    response.end(
      JSON.stringify({
        repoRoot: root,
        distributionDigest: DISTRIBUTION_DIGEST,
      })
    );
  });
  try {
    await assertDevServerServesTree(`${origin}/workspace`, realpathSync(root));
  } finally {
    server.close();
  }
});

test('a dev server serving another distribution is refused loudly', async () => {
  const root = mkdtempSync(join(tmpdir(), 'devid-'));
  prepareDistributionIdentity(root);
  const { server, origin } = await listen((_request, response) => {
    response.setHeader('content-type', 'application/json');
    response.end(
      JSON.stringify({ repoRoot: root, distributionDigest: 'b'.repeat(64) })
    );
  });
  try {
    await assert.rejects(
      assertDevServerServesTree(`${origin}/workspace`, root),
      /WRONG DISTRIBUTION/
    );
  } finally {
    server.close();
  }
});

test('a dev server serving ANOTHER tree is refused loudly', async () => {
  const served = mkdtempSync(join(tmpdir(), 'devid-served-'));
  const testing = mkdtempSync(join(tmpdir(), 'devid-testing-'));
  const { server, origin } = await listen((_request, response) => {
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ repoRoot: served }));
  });
  try {
    await assert.rejects(
      assertDevServerServesTree(`${origin}/workspace`, testing),
      /WRONG TREE/
    );
  } finally {
    server.close();
  }
});

test('an identity-less server (older tree / prod) is tolerated with a warning', async () => {
  const root = mkdtempSync(join(tmpdir(), 'devid-'));
  const { server, origin } = await listen((_request, response) => {
    response.statusCode = 404;
    response.end();
  });
  try {
    await assertDevServerServesTree(`${origin}/workspace`, root);
  } finally {
    server.close();
  }
});

test('an UNHEALTHY server (stale deleted-worktree dev server 500s) is refused', async () => {
  const root = mkdtempSync(join(tmpdir(), 'devid-'));
  const { server, origin } = await listen((_request, response) => {
    response.statusCode = 500;
    response.end();
  });
  try {
    await assert.rejects(
      assertDevServerServesTree(`${origin}/workspace`, root),
      /unhealthy/
    );
  } finally {
    server.close();
  }
});

test('no server answering fails fast with the start-a-dev-server remedy', async () => {
  const root = mkdtempSync(join(tmpdir(), 'devid-'));
  const { server, origin } = await listen(() => {});
  server.close();
  await assert.rejects(
    assertDevServerServesTree(`${origin}/workspace`, root),
    /No dev server is answering/
  );
});

test('a non-URL dev target (packaged-app evals) is skipped', async () => {
  await assertDevServerServesTree('not a url', '/nowhere');
});

/* ------------------------------------------------------------------ */
/* BUG-016 — a packaging snapshot on the dev resolution path            */
/* ------------------------------------------------------------------ */

test('a dev tree carrying a packaging snapshot is refused before launch', async () => {
  const root = mkdtempSync(join(tmpdir(), 'snapshot-'));
  mkdirSync(join(root, 'dist-electron', 'node_modules', '@exawatt', 'core'), {
    recursive: true,
  });
  await assert.rejects(
    () => assertNoPackagingSnapshot(root),
    /electron:compile/
  );
});

test('a dev tree with no snapshot resolves the workspace and passes', async () => {
  const root = mkdtempSync(join(tmpdir(), 'snapshot-'));
  mkdirSync(join(root, 'dist-electron', 'main'), { recursive: true });
  await assert.doesNotReject(() => assertNoPackagingSnapshot(root));
});

test('discarding is idempotent and leaves the compiled main alone', async () => {
  const root = mkdtempSync(join(tmpdir(), 'snapshot-'));
  mkdirSync(join(root, 'dist-electron', 'node_modules', 'node-pty'), {
    recursive: true,
  });
  mkdirSync(join(root, 'dist-electron', 'main'), { recursive: true });
  writeFileSync(join(root, 'dist-electron', 'main', 'main.js'), '');
  await discardRuntimeDependencies(root);
  await discardRuntimeDependencies(root);
  assert.equal(existsSync(join(root, 'dist-electron', 'node_modules')), false);
  assert.ok(existsSync(join(root, 'dist-electron', 'main', 'main.js')));
  await assert.doesNotReject(() => assertNoPackagingSnapshot(root));
});

/* ------------------------------------------------------------------ */
/* BUG-030 — what the packaging snapshot is allowed to contain          */
/* ------------------------------------------------------------------ */

test('a nested node_modules is never runtime payload, at any depth', () => {
  // How the TypeScript compiler and vitest reached users: the snapshot was a
  // dereferencing copy, and pnpm links devDependencies here.
  assert.equal(isRuntimePayloadPath('node_modules'), false);
  assert.equal(isRuntimePayloadPath('node_modules/typescript/bin/tsc'), false);
  assert.equal(isRuntimePayloadPath('node_modules/.bin/tsc'), false);
  // node-gyp writes build stamps under a nested path of the same shape.
  assert.equal(
    isRuntimePayloadPath(
      'build/Release/node-addon-api@7.1.1/node_modules/x.stamp'
    ),
    false
  );
  assert.equal(isRuntimePayloadPath('dist-cjs/index.js'), true);
  assert.equal(isRuntimePayloadPath('lib/node_modules_helper.js'), true);
});

test('only the target platform prebuilt binaries are runtime payload', () => {
  assert.equal(
    isRuntimePayloadPath('prebuilds/darwin-arm64/node.napi.node', 'darwin'),
    true
  );
  assert.equal(
    isRuntimePayloadPath('prebuilds/darwin-x64/node.napi.node', 'darwin'),
    true
  );
  assert.equal(
    isRuntimePayloadPath('prebuilds/win32-x64/node.napi.node', 'darwin'),
    false
  );
  assert.equal(isRuntimePayloadPath('build/Release/pty.node', 'darwin'), true);
});

test('the runtime closure is exactly the declared roots plus production deps', () => {
  const closure = resolveRuntimeClosure(process.cwd());
  for (const name of RUNTIME_PACKAGES)
    assert.ok(closure.has(name), `missing ${name}`);
  // Everything else in the closure must be reachable through a `dependencies`
  // edge, so nothing enters the payload by being installed nearby.
  const reachable = new Set(RUNTIME_PACKAGES);
  for (const { directory } of closure.values()) {
    const manifest = JSON.parse(
      readFileSync(join(directory, 'package.json'), 'utf8')
    );
    for (const dependency of Object.keys(manifest.dependencies ?? {})) {
      reachable.add(dependency);
    }
  }
  for (const name of closure.keys())
    assert.ok(reachable.has(name), `stray ${name}`);
  assert.equal(closure.has('typescript'), false);
  assert.equal(closure.has('vitest'), false);
});

test('a bundle path reports every package it passes through', () => {
  assert.deepEqual(
    packagesAlongPath(
      'dist-electron/node_modules/@exawatt/core/node_modules/typescript/bin/tsc'
    ),
    ['@exawatt/core', 'typescript']
  );
  assert.deepEqual(packagesAlongPath('dist-electron/main/main.js'), []);
});

test('the launcher eval drives the composer through the shared settle owner', () => {
  // BUG-101: the eval reimplemented a local `showLauncherDrawer` that waited
  // for the drawer handle to be VISIBLE rather than ENABLED, skipping
  // `waitForLauncherToSettle`. Until the Agent Source registry answers for
  // every harness the setup chips render role="presentation" with no
  // aria-checked, so `.count()`/`.innerText()` — neither of which auto-waits —
  // asserted against a placeholder row and failed with zero retries.
  const evalSource = readFileSync(
    new URL('./electron-project-agent-launcher-eval.mjs', import.meta.url),
    'utf8'
  );
  assert.doesNotMatch(
    evalSource,
    /function showLauncherDrawer/,
    'the local drawer helper is back; drive the launcher through openSetupDrawer'
  );
  assert.match(
    evalSource,
    /waitForLauncherToSettle/,
    'the eval must wait for the launcher to settle before reading setup state'
  );
  // Every read of the selected configuration is settle-dependent.
  const radioReads =
    evalSource.split('[role="radio"][aria-checked="true"]').length - 1;
  assert.ok(
    radioReads > 0,
    'expected the eval to assert on the selected setup'
  );
});

// ── The launcher's boundaries (BUG-213, BUG-216, BUG-217). The static half
// lives in `eval-boundaries.test.mjs`; these hold the runtime half, which
// refuses before anything launches.

test('a packaged launch is refused without the package ensurePackagedApp proved', async () => {
  const body = async () => assert.fail('the launcher launched');
  await assert.rejects(
    withElectronApp({ executablePath: '/nowhere/Exawatt' }, body),
    /packaged: await ensurePackagedApp\(\)/
  );
  await assert.rejects(
    withElectronApp({ packaged: { executablePath: '/nowhere/Exawatt' } }, body),
    /the package ensurePackagedApp\(\) returned/
  );
});

function runFake(executable, args) {
  const result = spawnSync(executable, args, { encoding: 'utf8', input: '' });
  return { status: result.status, stdout: result.stdout };
}

test('every fake harness answers its version probe and then behaves as told', t => {
  const bin = mkdtempSync(join(tmpdir(), 'exawatt-fake-harness-'));
  t.after(() => rmSync(bin, { recursive: true, force: true }));
  for (const harness of FAKE_HARNESSES) {
    const executable = writeFakeHarness(bin, harness, {
      launch: 'printf "LAUNCHED:%s\\n" "$*"',
    });
    const version = runFake(executable, ['--version']);
    assert.equal(version.status, 0, `${harness} --version`);
    assert.ok(version.stdout.trim().length > 0, `${harness} --version`);
    assert.equal(
      runFake(executable, ['--resume', 'abc']).stdout,
      'LAUNCHED:--resume abc\n',
      `${harness} launch`
    );
  }
});

test('a fake harness takes answers the product asks for and refuses others', t => {
  const bin = mkdtempSync(join(tmpdir(), 'exawatt-fake-harness-'));
  t.after(() => rmSync(bin, { recursive: true, force: true }));
  const codex = writeFakeHarness(bin, 'codex', {
    answers: { version: 'codex-cli 1.2.3', loginStatus: null },
  });
  assert.equal(runFake(codex, ['--version']).stdout, 'codex-cli 1.2.3\n');
  assert.equal(runFake(codex, ['login', 'status']).status, 1);
  assert.equal(runFake(codex, ['app-server', '--stdio']).status, 0);
  const node = writeFakeHarness(bin, 'claude', {
    runtime: 'node',
    answers: { version: 'claude 1.2.3' },
  });
  assert.equal(runFake(node, ['--version']).stdout, 'claude 1.2.3\n');
  assert.throws(
    () => writeFakeHarness(bin, 'codex', { answers: { weather: 'sunny' } }),
    /asks codex no "weather" question/
  );
  assert.throws(
    () => writeFakeHarness(bin, 'nonesuch'),
    /No fixture probes for harness "nonesuch"/
  );
});

test('the launcher refuses a hand-rolled fake harness in a fixture bin', t => {
  const bin = mkdtempSync(join(tmpdir(), 'exawatt-fake-harness-'));
  t.after(() => rmSync(bin, { recursive: true, force: true }));
  writeFakeHarness(bin, 'codex');
  assert.doesNotThrow(() =>
    assertFixtureHarnesses({ EXAWATT_TEST_HARNESS_BIN: bin, PATH: bin })
  );
  // The shape `eval:electron:resume` used: a `claude` on a temp PATH entry
  // that answers no probe at all.
  writeFileSync(
    join(bin, 'claude'),
    '#!/bin/sh\nwhile read -r l; do :; done\n'
  );
  chmodSync(join(bin, 'claude'), 0o755);
  assert.throws(
    () => assertFixtureHarnesses({ PATH: `${bin}:/usr/bin` }),
    /fake claude that writeFakeHarness did not write/
  );
  assert.throws(
    () => assertFixtureHarnesses({ EXAWATT_TEST_HARNESS_BIN: bin }),
    /fake claude that writeFakeHarness did not write/
  );
});

test('an async page condition is awaited and polled until it holds', async () => {
  let calls = 0;
  const page = {
    evaluate: async (condition, arg) => {
      calls += 1;
      if (calls === 1) throw new Error('Execution context was destroyed');
      return condition(arg);
    },
  };
  const value = await waitForPageCondition(
    page,
    async target => (calls >= target ? 'held' : false),
    3,
    { interval: 0 }
  );
  assert.equal(value, 'held');
  assert.equal(calls, 3);
});

test('an async page condition that never holds names what it waited for', async () => {
  const page = { evaluate: async condition => condition() };
  await assert.rejects(
    waitForPageCondition(page, async () => false, undefined, {
      timeout: 0,
      label: 'the fixture Session',
    }),
    /TIMED OUT after 0ms waiting for the fixture Session/
  );
  const broken = {
    evaluate: async () => {
      throw new Error('window.electron is undefined');
    },
  };
  await assert.rejects(
    waitForPageCondition(broken, async () => true),
    /window\.electron is undefined/
  );
});

/** A main process whose callback leaves a chain of `depth` jobs ending in a
 *  collection: the shape of an eval call landing while main is busy. Every
 *  depth is tried, so the one that lands between Playwright's promise and the
 *  inspector's read is always among them. */
const COLLECTING_CALLBACK = (_electron, depth) => {
  let step = Promise.resolve();
  for (let i = 0; i < depth; i += 1) step = step.then(() => undefined);
  step.then(() => globalThis.__collect());
  return true;
};

test(
  'a main evaluate keeps its result through a collection that lands before the inspector reads it (BUG-295)',
  {
    // Electron needs a display on Linux; CI's batch has none.
    skip: process.platform !== 'darwin' && 'Electron needs a display here',
  },
  async t => {
    const dir = mkdtempSync(join(tmpdir(), 'exawatt-evaluate-anchor-'));
    writeFileSync(join(dir, 'package.json'), '{"main":"main.js"}');
    writeFileSync(
      join(dir, 'main.js'),
      `require('v8').setFlagsFromString('--expose-gc');
globalThis.__collect = require('vm').runInNewContext('gc');
require('electron').app.whenReady();`
    );
    const app = await electron.launch({
      executablePath: createRequire(import.meta.url)('electron'),
      args: [dir],
    });
    t.after(async () => {
      await app.close().catch(() => {});
      rmSync(dir, { recursive: true, force: true });
    });
    const lost = async evaluate => {
      let count = 0;
      for (let call = 0; call < 24; call += 1) {
        await evaluate(COLLECTING_CALLBACK, call % 6).catch(() => {
          count += 1;
        });
      }
      return count;
    };
    // The hazard is real on this Electron, so the anchored result means
    // something: Playwright's own evaluate loses results here.
    assert.ok(
      (await lost((fn, arg) => app.evaluate(fn, arg))) > 0,
      'the fixture no longer reproduces the collected promise'
    );
    const anchored = anchorMainEvaluate(app);
    assert.equal(await lost((fn, arg) => anchored.evaluate(fn, arg)), 0);
  }
);

test(
  "the harness declares a locked Mac unlocked through the app's own host observer, and leaves the app's reads alone (BUG-308)",
  {
    // Electron needs a display on Linux; CI's batch has none.
    skip: process.platform !== 'darwin' && 'Electron needs a display here',
  },
  async t => {
    const observer = new URL(
      '../dist-electron/main/host-power.js',
      import.meta.url
    );
    assert.ok(
      existsSync(observer),
      'compile the Electron main first: pnpm electron:compile'
    );
    const dir = mkdtempSync(join(tmpdir(), 'exawatt-declared-host-'));
    writeFileSync(join(dir, 'package.json'), '{"main":"main.js"}');
    // The Mac this fixture stands for is locked: every native read says so.
    writeFileSync(
      join(dir, 'main.js'),
      `const { app, powerMonitor } = require('electron');
const { observeHostPower } = require(${JSON.stringify(observer.pathname)});
globalThis.__host = app.whenReady().then(() =>
  observeHostPower(
    {
      isOnBatteryPower: () => false,
      getScreenLockState: () => 'locked',
      on: powerMonitor.on.bind(powerMonitor),
      removeListener: powerMonitor.removeListener.bind(powerMonitor),
    },
    () => {}
  )
);`
    );
    const app = anchorMainEvaluate(
      await electron.launch({
        executablePath: createRequire(import.meta.url)('electron'),
        args: [dir],
      })
    );
    t.after(async () => {
      await app.close().catch(() => {});
      rmSync(dir, { recursive: true, force: true });
    });
    const screenLock = () =>
      app.evaluate(
        async () => (await globalThis.__host).getSnapshot().screenLock
      );
    assert.equal(await screenLock(), 'locked');
    await declareUnlockedHost(app);
    assert.equal(await screenLock(), 'unlocked');
    // A declaration is an event, not a rule: the app's next native read
    // (resume) still answers for the real host.
    await app.evaluate(({ powerMonitor }) => powerMonitor.emit('resume'));
    assert.equal(await screenLock(), 'locked');
  }
);

/** A real Electron app with one hidden window: the boundary the attempt
 *  runner launches, closes and kills. */
function windowFixture() {
  const dir = mkdtempSync(join(tmpdir(), 'exawatt-attempt-'));
  writeFileSync(join(dir, 'package.json'), '{"main":"main.js"}');
  writeFileSync(
    join(dir, 'main.js'),
    `const { app, BrowserWindow } = require('electron');
app.whenReady().then(() => {
  const win = new BrowserWindow({ show: false });
  win.loadURL('data:text/html,<p>fixture</p>');
});`
  );
  return dir;
}

const attemptOf = (dir, body, maxMs, options = {}) =>
  runElectronAttempt({
    launchOpts: {
      executablePath: createRequire(import.meta.url)('electron'),
      args: [dir],
    },
    body,
    // A fresh directory: the orphan sweep matches nothing outside this test.
    evalRoot: dir,
    maxMs,
    firstWindowMs: 30_000,
    gracefulMs: 5_000,
    drivesHostPower: true,
    ...options,
  }).then(
    () => null,
    error => error
  );

/** A `ps` that fails as one does under load (EAGAIN, its own timeout): first
 *  on PATH from `install()` to `restore()`, so the harness's real calls hit
 *  it after the launch has verified its process group. */
function failingPs(t) {
  const bin = mkdtempSync(join(tmpdir(), 'exawatt-failing-ps-'));
  writeFileSync(
    join(bin, 'ps'),
    '#!/bin/sh\necho "ps: fork: Resource temporarily unavailable" >&2\nexit 1\n'
  );
  chmodSync(join(bin, 'ps'), 0o755);
  const original = process.env.PATH;
  const restore = () => {
    process.env.PATH = original;
  };
  t.after(() => {
    restore();
    rmSync(bin, { recursive: true, force: true });
  });
  return {
    install: () => {
      process.env.PATH = `${bin}:${original}`;
    },
    restore,
  };
}

/** The launched trees, verified by the test itself, so it can prove each is
 *  gone once the real `ps` is back, whatever teardown could verify. `gone()`
 *  also waits for each main's `close`, the event on which Playwright drops
 *  the signal handlers it added for that launch. */
function launchedTrees(t) {
  const launches = [];
  const gone = async () => {
    for (const { group, closed } of launches.splice(0)) {
      group?.forceKill();
      const deadline = Date.now() + 10_000;
      while (group && group.members().length > 0) {
        assert.ok(Date.now() < deadline, 'the launched tree must exit');
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      await closed;
    }
  };
  t.after(gone);
  return {
    track: app =>
      launches.push({
        group: captureElectronProcessGroup(app.process().pid),
        closed: once(app.process(), 'close'),
      }),
    gone,
  };
}

test(
  'a watchdog timeout fails as a timeout naming its budget and the last progress, screenshots before closing, and is never an external kill (BUG-314)',
  { skip: process.platform !== 'darwin' && 'Electron needs a display here' },
  async t => {
    const dir = windowFixture();
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    let runs = 0;
    let pid = 0;
    let exit = null;
    const error = await attemptOf(
      dir,
      async (app, page) => {
        runs += 1;
        pid = app.process().pid;
        console.log('[fixture] the window is open');
        // A step that never completes, as the hung roadmap step did.
        await page.waitForFunction(() => false, null, { timeout: 0 });
      },
      8_000,
      { reportExit: report => (exit = report) }
    );
    assert.equal(error?.name, 'ElectronEvalTimeout', String(error));
    assert.match(error.message, /8000ms/);
    assert.match(error.message, /\[fixture\] the window is open/);
    // A screenshot exists only if it was taken while the page was open.
    assert.ok(error.screenshot && statSync(error.screenshot).size > 0);
    assert.equal(isExternalTeardown(error), false);
    assert.equal(runs, 1);
    // The attempt settled only after its tree exited and main was reaped:
    // the profile is free.
    assert.equal(exit?.exited, true, exit?.detail);
    assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
  }
);

test(
  'a kill from outside the harness is still an external teardown, so the relaunch remains (BUG-314)',
  { skip: process.platform !== 'darwin' && 'Electron needs a display here' },
  async t => {
    const dir = windowFixture();
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const error = await attemptOf(
      dir,
      async (app, page) => {
        const pending = page.waitForFunction(() => false, null, {
          timeout: 0,
        });
        // Something outside this run kills the app mid-step.
        process.kill(app.process().pid, 'SIGKILL');
        await pending;
      },
      60_000
    );
    assert.ok(error, 'the killed run must fail');
    assert.equal(isExternalTeardown(error), true, String(error));
  }
);

test(
  "a ps that fails through teardown never replaces the run's result, and the signal handlers still go",
  { skip: process.platform !== 'darwin' && 'Electron needs a display here' },
  async t => {
    const dir = windowFixture();
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const ps = failingPs(t);
    const trees = launchedTrees(t);
    // Playwright adds its own signal handlers per launch and drops them once
    // that launch has closed; past that, none this run added may remain.
    const before = new Set([
      ...process.listeners('SIGINT'),
      ...process.listeners('SIGTERM'),
    ]);
    const added = () =>
      [...process.listeners('SIGINT'), ...process.listeners('SIGTERM')].filter(
        listener => !before.has(listener)
      );
    const attempt = async step => {
      let exit = null;
      const outcome = await runElectronAttempt({
        launchOpts: {
          executablePath: createRequire(import.meta.url)('electron'),
          args: [dir],
        },
        body: async app => {
          trees.track(app);
          ps.install();
          return step();
        },
        evalRoot: dir,
        maxMs: 60_000,
        firstWindowMs: 30_000,
        gracefulMs: 1_000,
        drivesHostPower: true,
        reportExit: report => (exit = report),
      }).then(
        value => ({ value }),
        error => ({ error })
      );
      ps.restore();
      return { outcome, exit };
    };

    const passed = await attempt(async () => 'passed');
    assert.deepEqual(passed.outcome, { value: 'passed' });
    const failure = new Error('the step failed');
    const failed = await attempt(async () => {
      throw failure;
    });
    assert.equal(failed.outcome.error, failure);
    for (const { exit } of [passed, failed]) {
      assert.equal(exit.exited, false);
      assert.match(exit.detail, /^ps failed: /);
    }
    await trees.gone();
    assert.deepEqual(added(), []);
  }
);

test(
  'a relaunch resets the profile only once the killed tree is verified gone, and refuses without that proof',
  { skip: process.platform !== 'darwin' && 'Electron needs a display here' },
  async t => {
    const dir = windowFixture();
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const ps = failingPs(t);
    const { track } = launchedTrees(t);
    const killedMidStep = async (gracefulMs, install = () => {}) => {
      let exit = null;
      const error = await attemptOf(
        dir,
        async (app, page) => {
          track(app);
          const pending = page.waitForFunction(() => false, null, {
            timeout: 0,
          });
          install();
          // Something outside this run kills the app mid-step.
          process.kill(app.process().pid, 'SIGKILL');
          await pending;
        },
        60_000,
        { gracefulMs, reportExit: report => (exit = report) }
      );
      ps.restore();
      assert.equal(isExternalTeardown(error), true, String(error));
      return { error, exit };
    };
    const profile = () => {
      const userData = mkdtempSync(join(tmpdir(), 'exawatt-relaunch-'));
      t.after(() => rmSync(userData, { recursive: true, force: true }));
      writeFileSync(join(userData, 'Preferences'), '{}');
      return userData;
    };

    const verified = await killedMidStep(5_000);
    assert.equal(verified.exit.exited, true);
    const reset = profile();
    resetForRelaunch(verified.exit, reset, verified.error);
    assert.equal(existsSync(reset), false);

    const unverified = await killedMidStep(1_000, ps.install);
    assert.equal(unverified.exit.exited, false);
    const kept = profile();
    assert.throws(
      () => resetForRelaunch(unverified.exit, kept, unverified.error),
      {
        name: 'ElectronEvalUnverifiedExit',
        message:
          /the previous Electron tree did not exit within 1000ms \(ps failed: .+\); not reusing its profile/,
      }
    );
    assert.equal(existsSync(join(kept, 'Preferences')), true);
  }
);

test(
  'a tree has exited only once its main is reaped, not when ps lists it as defunct',
  { skip: process.platform === 'win32' && 'no process groups here' },
  async t => {
    // The launch's main as the harness holds it: this process's own child,
    // leading its own process group.
    const main = spawn('/bin/sleep', ['30'], {
      detached: true,
      stdio: 'ignore',
    });
    t.after(() => main.kill('SIGKILL'));
    const group = captureElectronProcessGroup(main.pid);
    assert.ok(group, 'the child leads a verifiable group');
    const state = () =>
      spawnSync('ps', ['-o', 'stat=', '-p', String(main.pid)], {
        encoding: 'utf8',
      }).stdout.trim();

    // Alive: not reaped, so not exited, whatever the deadline.
    const alive = await waitForTreeExit({ main, group, timeoutMs: 300 });
    assert.equal(alive.exited, false);
    assert.match(alive.detail, /has not been reaped/);

    // Dead but unreaped: no loop turn has run since the kill, so Node has
    // not collected it and `ps` lists it as a zombie, outside the group.
    process.kill(main.pid, 'SIGKILL');
    const until = Date.now() + 5_000;
    while (!state().startsWith('Z')) {
      // Synchronous: the event loop, and with it the reap, waits.
      assert.ok(Date.now() < until, 'the killed child is listed as a zombie');
    }
    assert.deepEqual(group.members(), []);
    assert.doesNotThrow(() => process.kill(main.pid, 0));

    const exit = await waitForTreeExit({ main, group, timeoutMs: 10_000 });
    assert.equal(exit.exited, true, exit.detail);
    assert.throws(() => process.kill(main.pid, 0), { code: 'ESRCH' });
  }
);

test('a relaunch reset outlasts a dying writer still flushing into the profile (BUG-314)', async t => {
  const profile = mkdtempSync(join(tmpdir(), 'exawatt-reset-'));
  t.after(() => rmSync(profile, { recursive: true, force: true }));
  // A helper flushing its last writes for a moment after its group's kill:
  // it writes into the profile's subdirectories, never recreating the
  // profile itself, then exits on its own.
  const writer = spawn(
    process.execPath,
    [
      '-e',
      `const fs = require('fs');
const root = process.argv[1];
const end = Date.now() + 500;
for (let i = 0; Date.now() < end; i += 1) {
  try {
    fs.mkdirSync(root + '/d' + (i % 10));
  } catch {}
  try {
    fs.writeFileSync(root + '/d' + (i % 10) + '/f' + i, 'x');
  } catch {}
}`,
      profile,
    ],
    { stdio: 'ignore' }
  );
  const exited = once(writer, 'exit');
  t.after(() => writer.kill('SIGKILL'));
  await waitUntil(() => readdirSync(profile).length > 0);
  assert.doesNotThrow(() => resetThrowawayUserData(profile));
  await exited;
  assert.equal(existsSync(profile), false);
});

/** Until `condition()` holds; it waits for the effect, not a duration. */
async function waitUntil(condition) {
  while (!condition()) await new Promise(resolve => setImmediate(resolve));
}
