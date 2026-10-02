// The boundaries every Electron eval crosses, held by reading the scripts
// (BUG-213, BUG-216, BUG-217).
//
// Five gates were quarantined on the same day for defects of one family: an
// eval that launched Electron beside `withElectronApp` and skipped its
// cross-worktree lock and teardown, three packaged evals that launched a
// package nothing had built, a fake `claude` that answered none of the
// product's probes, and waits that never waited. Each was local to one script
// and invisible until that script ran. These tests read every script under
// `scripts/` instead, so the next one fails here, at landing, before anything
// launches:
//
// - Electron starts through `scripts/lib/electron-eval.mjs` and nowhere else,
//   except where `LAUNCH_EXCEPTIONS` says why it cannot;
// - a packaged launch takes `packaged: await ensurePackagedApp()` and no eval
//   builds or points at a package itself;
// - a fake harness comes from `writeFakeHarness`, which owns every probe
//   answer, and that fixture knows every local CLI the product declares;
// - an async page condition is polled by `waitForPageCondition`, never handed
//   to `page.waitForFunction`, which treats the returned Promise as truthy.
//
// The launcher enforces the first three again at runtime (`withElectronApp`
// refuses an `executablePath`, a package `ensurePackagedApp` did not return,
// and an unmarked fake harness), so a script that slips past a pattern here
// still cannot run.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { FAKE_HARNESSES } from './lib/harness-probe-fixture.mjs';
import { git } from './lib/hermetic-git.mjs';
import { installFeedbackTransport } from './lib/feedback-reporting-eval.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const LAUNCHER = 'scripts/lib/electron-eval.mjs';
const PACKAGER = 'scripts/lib/packaged-app.mjs';
const HARNESS_FIXTURE = 'scripts/lib/harness-probe-fixture.mjs';

/** Scripts that start Electron outside `withElectronApp`, each with the reason
 *  it cannot use it. A reason has to be a property of what the script proves,
 *  never that migrating it is work. */
const LAUNCH_EXCEPTIONS = new Map([
  [
    'scripts/electron-dev.mjs',
    'the interactive `pnpm electron:dev` launcher: it hands the app to a person for as long as they use it, and is not an eval',
  ],
  [
    'scripts/electron-product-update-eval.mjs',
    'drives the installed /Applications bundle through LaunchServices and attaches over CDP, because the relaunch it proves is performed by macOS and the updater, not by a process Playwright owns',
  ],
]);

const LAUNCHES_ELECTRON = [
  {
    pattern: /\b_electron\b/u,
    what: "Playwright's Electron driver (`_electron`)",
  },
  { pattern: /\bconnectOverCDP\s*\(/u, what: 'a CDP attach to a running app' },
  {
    pattern:
      /\b(?:spawn|spawnSync|execFile|execFileSync)\(\s*['"](?:electron|\/usr\/bin\/open)['"]/u,
    what: 'a spawned Electron or LaunchServices process',
  },
];

/** Line and block comments removed, so prose about a pattern is not the
 *  pattern. A `//` preceded by a non-space (a URL) is kept. */
function code(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .replace(/(^|\s)\/\/.*$/gmu, '$1');
}

/** Every tracked or new script under `scripts/` that runs as code. Tests are
 *  excluded: they name these patterns in order to refuse them. */
function scripts() {
  return git(root, [
    'ls-files',
    '--cached',
    '--others',
    '--exclude-standard',
    '--',
    'scripts',
  ])
    .split('\n')
    .filter(file => /\.m?js$/u.test(file) && !/\.test\.m?js$/u.test(file))
    .filter(file => existsSync(path.join(root, file)))
    .sort()
    .map(file => ({
      file,
      source: code(readFileSync(path.join(root, file), 'utf8')),
    }));
}

const SCRIPTS = scripts();

function feedbackPageDouble() {
  let routeHandler;
  const registrations = [];
  const requestWaiters = [];
  return {
    registrations,
    page: {
      async route(matcher, handler) {
        registrations.push(matcher);
        routeHandler = handler;
      },
      async unroute(matcher, handler) {
        assert.equal(matcher, registrations[0]);
        assert.equal(handler, routeHandler);
        routeHandler = undefined;
      },
      waitForRequest(predicate) {
        return new Promise(resolve =>
          requestWaiters.push({ predicate, resolve })
        );
      },
    },
    dispatch(payload, method = 'POST') {
      const fulfilled = [];
      let continued = false;
      const request = {
        method: () => method,
        url: () => registrations[0],
        postData: () => JSON.stringify(payload),
      };
      for (const waiter of requestWaiters.splice(0)) {
        assert.ok(waiter.predicate(request));
        waiter.resolve(request);
      }
      const completed = routeHandler({
        request: () => request,
        async fulfill(response) {
          fulfilled.push(response);
        },
        async continue() {
          continued = true;
        },
      });
      return { completed, fulfilled, continued: () => continued };
    },
  };
}

test('feedback scenes intercept the configured operation and hold receipt completion explicitly', async () => {
  const double = feedbackPageDouble();
  const endpoint = 'https://intake.example.test/custom/v1/report?scope=desktop';
  const transport = await installFeedbackTransport(double.page, endpoint);
  assert.deepEqual(double.registrations, [endpoint]);
  const held = transport.hold({ attachmentStored: false });
  const payload = {
    idempotencyKey: '11111111-2222-4333-8444-555555555555',
    attachment: { dataUrl: 'data:image/png;base64,ZmFrZQ==' },
  };
  const first = double.dispatch(payload);
  assert.deepEqual((await held.observed).payload, payload);
  assert.deepEqual(
    first.fulfilled,
    [],
    'pending is proved before the transport completes'
  );
  held.release();
  await first.completed;
  const receipt = JSON.parse(first.fulfilled[0].body);
  assert.equal(receipt.schemaVersion, 1);
  assert.equal(receipt.attachmentStored, false);
  assert.equal(first.fulfilled[0].headers['Exawatt-Service-Version'], '1');
  assert.equal(first.fulfilled[0].headers['Access-Control-Allow-Origin'], '*');
  assert.match(
    first.fulfilled[0].headers['Access-Control-Expose-Headers'],
    /Exawatt-Service-Version/u
  );
  assert.match(receipt.id, /^[a-f\d-]{36}$/u);
  const retry = double.dispatch(payload);
  await retry.completed;
  const reconciled = JSON.parse(retry.fulfilled[0].body);
  assert.equal(
    reconciled.id,
    receipt.id,
    'retry receipts identify the same saved report'
  );
  assert.equal(reconciled.duplicate, true);
  assert.equal(reconciled.attachmentStored, true);
  await transport.dispose();
});

test('feedback preflight and capability reads never reach a real service or consume a held submission', async () => {
  const double = feedbackPageDouble();
  const transport = await installFeedbackTransport(
    double.page,
    'https://intake.example.test/report'
  );
  transport.enqueue({ attachmentStored: false });
  const preflight = double.dispatch(null, 'OPTIONS');
  await preflight.completed;
  assert.equal(preflight.fulfilled[0].status, 204);
  assert.equal(preflight.continued(), false);
  assert.match(
    preflight.fulfilled[0].headers['Access-Control-Allow-Headers'],
    /authorization/u
  );
  const capability = double.dispatch(null, 'GET');
  await capability.completed;
  assert.equal(capability.continued(), false);
  assert.equal(JSON.parse(capability.fulfilled[0].body).canTriage, false);
  assert.deepEqual(transport.payloads, []);
  const submission = double.dispatch({
    idempotencyKey: '11111111-2222-4333-8444-555555555555',
    attachment: {},
  });
  await submission.completed;
  assert.equal(
    JSON.parse(submission.fulfilled[0].body).attachmentStored,
    false
  );
});

test('absent feedback configuration installs no intake interceptor', async () => {
  const double = feedbackPageDouble();
  const transport = await installFeedbackTransport(double.page, null);
  assert.deepEqual(double.registrations, []);
  assert.deepEqual(transport.payloads, []);
  await transport.dispose();
});

test('the injected feedback failure is accepted by the production V1 problem decoder', async () => {
  const { decodeCompatibleServiceProblem } = createRequire(import.meta.url)(
    '@exawatt/core/distribution'
  );
  const double = feedbackPageDouble();
  const endpoint = {
    url: 'https://intake.example.test/report',
    protocolVersion: 1,
  };
  const transport = await installFeedbackTransport(double.page, endpoint.url);
  transport.enqueue({ error: 'Simulated reporting failure' });
  const request = double.dispatch({
    idempotencyKey: '11111111-2222-4333-8444-555555555555',
  });
  await request.completed;
  const encoded = request.fulfilled[0];
  const response = new Response(encoded.body, {
    status: encoded.status,
    headers: { ...encoded.headers, 'content-type': encoded.contentType },
  });
  const problem = await decodeCompatibleServiceProblem(endpoint, response);
  assert.equal(problem.status, response.status);
  assert.equal(problem.retryable, true);
});

test('the scan sees the launcher and the scripts it launches for', () => {
  const files = SCRIPTS.map(script => script.file);
  for (const file of [LAUNCHER, PACKAGER, HARNESS_FIXTURE]) {
    assert.ok(files.includes(file), `${file} is not among the scanned scripts`);
  }
  assert.ok(
    SCRIPTS.filter(script => /\bwithElectronApp\(/u.test(script.source))
      .length > 10,
    'the scan found almost no Electron evals; its file list is wrong'
  );
});

test('Electron starts through withElectronApp and nowhere else', () => {
  const offenders = SCRIPTS.filter(
    script => script.file !== LAUNCHER && !LAUNCH_EXCEPTIONS.has(script.file)
  ).flatMap(script =>
    LAUNCHES_ELECTRON.filter(({ pattern }) => pattern.test(script.source)).map(
      ({ what }) => `${script.file}: ${what}`
    )
  );
  assert.deepEqual(
    offenders,
    [],
    'Launch Electron with withElectronApp (scripts/lib/electron-eval.mjs): ' +
      'it holds the cross-worktree eval lock and guarantees teardown. A ' +
      'script that truly cannot belongs in LAUNCH_EXCEPTIONS with its reason.'
  );
});

test('every launch exception still exists and still launches', () => {
  for (const [file, reason] of LAUNCH_EXCEPTIONS) {
    assert.ok(reason.length > 40, `${file} needs a reason, not a label`);
    const script = SCRIPTS.find(candidate => candidate.file === file);
    assert.ok(script, `${file} is gone; remove its launch exception`);
    assert.ok(
      LAUNCHES_ELECTRON.some(({ pattern }) => pattern.test(script.source)),
      `${file} no longer launches Electron itself; remove its exception`
    );
  }
});

test('a packaged launch takes the package ensurePackagedApp proved', () => {
  const evals = SCRIPTS.filter(
    script =>
      script.file !== LAUNCHER && /\bwithElectronApp\(/u.test(script.source)
  );
  const bareExecutable = evals
    .filter(script => /\bexecutablePath\s*:/u.test(script.source))
    .map(script => script.file);
  assert.deepEqual(
    bareExecutable,
    [],
    'withElectronApp takes `packaged: await ensurePackagedApp()`, never an executablePath'
  );
  const packagedWithoutHelper = evals
    .filter(script => /\bpackaged\b\s*[,:}]/u.test(script.source))
    .filter(script => !/\bensurePackagedApp\b/u.test(script.source))
    .map(script => script.file);
  assert.deepEqual(
    packagedWithoutHelper,
    [],
    'a packaged eval gets its package from ensurePackagedApp (scripts/lib/packaged-app.mjs)'
  );
});

test('no eval builds a package of its own', () => {
  // Release, dogfood and recertification build packages on purpose; an eval
  // is the script that launches one.
  const builders = SCRIPTS.filter(
    script =>
      script.file !== PACKAGER && /\bwithElectronApp\(/u.test(script.source)
  )
    .filter(script => /['"`]electron:build(?::dir)?['"`]/u.test(script.source))
    .map(script => script.file);
  assert.deepEqual(
    builders,
    [],
    'build the package an eval launches with ensurePackagedApp, which reuses ' +
      "one that matches this tree's contract and source instead of rebuilding"
  );
});

test('a fake harness answers probes only through writeFakeHarness', () => {
  const handRolled = SCRIPTS.filter(script => script.file !== HARNESS_FIXTURE)
    .filter(script =>
      /\[\s*"\$\d"\s*=\s*["']--version["']\s*\]|===?\s*["']--version["']|\bincludes\(\s*["']--version["']\s*\)/u.test(
        script.source
      )
    )
    .map(script => script.file);
  assert.deepEqual(
    handRolled,
    [],
    'make a fake harness with writeFakeHarness (scripts/lib/harness-probe-fixture.mjs); ' +
      'it owns every question the product asks one, and pass answers to vary them'
  );
});

test('the harness fixture knows every local CLI the product declares', () => {
  const contract = JSON.parse(
    readFileSync(path.join(root, 'contracts', 'agent-sources.json'), 'utf8')
  );
  const declared = contract.sources
    .map(source => source.harness)
    .filter(harness => typeof harness === 'string');
  assert.ok(declared.length > 0, 'the contract declares no local CLI');
  assert.deepEqual(
    declared.filter(harness => !FAKE_HARNESSES.includes(harness)),
    [],
    'teach PROBES in scripts/lib/harness-probe-fixture.mjs what the product asks each new harness'
  );
});

test('an async page condition is polled, never handed to waitForFunction', () => {
  const noOpWaits = SCRIPTS.filter(script =>
    /\.waitForFunction\(\s*async\b/u.test(script.source)
  ).map(script => script.file);
  assert.deepEqual(
    noOpWaits,
    [],
    'page.waitForFunction tests the returned value for truthiness, and a ' +
      'Promise is truthy, so an async predicate never waits; use ' +
      'waitForPageCondition from scripts/lib/electron-eval.mjs'
  );
});
