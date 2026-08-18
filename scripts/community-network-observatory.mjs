#!/usr/bin/env node
/**
 * ENG-030 OS4 — what a packaged COMMUNITY build actually puts on the wire.
 *
 * `verify:community-build` proves the community composition builds.
 * `verify:community-runtime` proves every request-time entrypoint answers
 * without an account. `community-closure.test.ts` proves no module anywhere in
 * the shipped trees can construct an Exawatt service client. All three are
 * statements about SOURCE. This one is the observation: a real packaged
 * community app, launched, driven through sign-in, the workspace, and a
 * launch, with every name it tries to resolve recorded.
 *
 * ── WHAT THIS IS, EXACTLY ────────────────────────────────────────────────
 *
 * It is NOT a link-layer packet capture. macOS ships `/dev/bpf*` root-only and
 * this machine has no ChmodBPF, so `tcpdump` needs `sudo`, which no unattended
 * gate may take. What runs instead is a two-instrument observatory, and each
 * instrument states its own coverage:
 *
 *   1. RESOLVER INTERCEPTION (complete, for the Chromium network stack).
 *      `--host-resolver-rules=MAP * 127.0.0.1:<sink>` (loopback excluded)
 *      redirects every hostname Chromium resolves to a loopback sink that
 *      records the TLS SNI or HTTP Host and then blackholes the connection.
 *      Nothing named can escape it, and a request that would have failed DNS
 *      is still recorded — which is strictly more than a packet capture sees.
 *      This covers the renderer, Electron main's `net.fetch` (the transport
 *      the auth coordinator and the Claude plan read both use), and every
 *      Chromium background service.
 *      Two POSITIVE CONTROLS prove the instrument is live before any absence
 *      is believed: one probe from main through `net.fetch`, one from the
 *      renderer through an `<img>` (the renderer's own CSP is `connect-src
 *      'self' ws:`, so a `fetch()` probe would be refused before DNS — that
 *      refusal is a second layer, not this instrument). An unobserved control
 *      FAILS the run. Absence is only evidence when the instrument is proven.
 *
 *   2. SOCKET SAMPLING (broad, sampling-limited).
 *      `lsof` every ~200 ms over every process running a binary from inside
 *      the bundle under observation — Electron main, its helpers, and the
 *      loopback Next standalone server child — so anything that bypasses the
 *      Chromium resolver (Node's own `fetch`/undici, a native module) is seen
 *      by its socket rather than by its name. Two limits, both stated: a
 *      connection that opens and closes inside one sampling interval can be
 *      missed, and a process the operator's own Agent Source launched is out
 *      of scope by design — that is their traffic, not this build's network
 *      identity (decision `0036` §6). Its positive control is the sink traffic
 *      itself: the sampler must observe the app connecting to the sink.
 *
 * ── WHAT A GREEN RUN PROVES ──────────────────────────────────────────────
 *
 *   • Over the observation window, exercising sign-in, the workspace, and a
 *     launch, a packaged community build resolved no hostname at all, and
 *     opened no socket to any address off loopback.
 *   • In particular none to an Exawatt-owned service, and none to Anthropic.
 *
 * ── WHAT IT DOES NOT PROVE ───────────────────────────────────────────────
 *
 *   • Anything outside the window, or on a path this exercise never walks.
 *   • The automatic own-account (Anthropic) read. `EXAWATT_TEST=1` is required
 *     for a non-focus-stealing launch, and test mode is one of the two inputs
 *     to `isClaudePlanRemoteReadAllowed`. The run therefore cannot observe
 *     that boundary, so the OWN-ACCOUNT section below asserts the decision
 *     itself against what this repository currently declares, and prints it.
 */

import { execFile, execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

import { withElectronApp } from './lib/electron-eval.mjs';
import {
  assertPackagedContract,
  assertPackagedSource,
  resolvePackagedApp,
} from './lib/packaged-app.mjs';

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const ROOT = process.cwd();

/** Host suffixes that identify an Exawatt-operated service. */
const EXAWATT_SUFFIXES = ['exawatt.ai', 'supabase.co', 'posthog.com'];
/** The own-account vendor. Never an Exawatt service; a separate family. */
const ANTHROPIC_SUFFIXES = ['anthropic.com'];
/** Reserved TLD (RFC 2606): resolvable by nothing, mapped by the rule above. */
const PROBE_HOST = 'observatory-probe.exawatt-gate.invalid';

// The probe is exempted from the verdict by name, so a probe host inside a
// watched family would blind the gate to that family.
for (const suffix of [...EXAWATT_SUFFIXES, ...ANTHROPIC_SUFFIXES]) {
  if (PROBE_HOST.endsWith(suffix)) {
    throw new Error(
      `The control probe host ${PROBE_HOST} is inside a watched family (${suffix}), ` +
        'which would exempt that family from the verdict. Use a reserved name.'
    );
  }
}

const OBSERVATION_MS = Number(process.env.EXAWATT_OBSERVE_MS ?? 60_000);
const SAMPLE_INTERVAL_MS = 200;

/* ------------------------------------------------------------------ */
/* instrument 1 — the loopback resolver sink                           */
/* ------------------------------------------------------------------ */

/** Pull the SNI out of a TLS ClientHello, or the Host out of an HTTP request. */
function peerNameFrom(first) {
  if (first.length > 0 && first[0] === 0x16) {
    try {
      // record header(5) + handshake header(4) + version(2) + random(32)
      let at = 43;
      at += 1 + first[at]; // session id
      at += 2 + first.readUInt16BE(at); // cipher suites
      at += 1 + first[at]; // compression methods
      const extensionsEnd = at + 2 + first.readUInt16BE(at);
      at += 2;
      while (at + 4 <= extensionsEnd) {
        const type = first.readUInt16BE(at);
        const length = first.readUInt16BE(at + 2);
        if (type === 0x0000) {
          // server_name: list length(2) + type(1) + name length(2)
          const nameLength = first.readUInt16BE(at + 7);
          return first.toString('utf8', at + 9, at + 9 + nameLength);
        }
        at += 4 + length;
      }
    } catch {
      /* a truncated or unexpected hello names nothing */
    }
    return null;
  }
  const text = first.toString('utf8', 0, Math.min(first.length, 2048));
  return /^host:[ \t]*([^\r\n]+)/im.exec(text)?.[1]?.trim() ?? null;
}

async function startResolverSink() {
  const connections = [];
  const held = new Set();
  const server = createServer(socket => {
    held.add(socket);
    socket.on('error', () => {});
    socket.once('data', chunk => {
      connections.push({
        at: Date.now(),
        host: peerNameFrom(chunk),
        bytes: chunk.length,
      });
    });
    // Hold briefly rather than resetting: the socket has to live long enough
    // for the sampler to see it, which is that instrument's positive control.
    const timer = setTimeout(() => socket.destroy(), 2_000);
    socket.on('close', () => {
      clearTimeout(timer);
      held.delete(socket);
    });
  });
  await new Promise((ok, fail) => {
    server.once('error', fail);
    server.listen(0, '127.0.0.1', ok);
  });
  return {
    port: server.address().port,
    connections,
    async stop() {
      for (const socket of held) socket.destroy();
      await new Promise(ok => server.close(ok));
    },
  };
}

/* ------------------------------------------------------------------ */
/* instrument 2 — process-tree socket sampling                         */
/* ------------------------------------------------------------------ */

/**
 * The app's own processes, by EXECUTABLE PATH rather than by ancestry.
 *
 * Descending the `ppid` chain is the obvious way to find them and it is not
 * sound here: pids are recycled, so a stranger whose parent pid was recycled
 * into this tree joins it, and a short-lived child that exits between the `ps`
 * read and the `lsof` read hands its pid to whoever takes it next. The first
 * runs of this gate did exactly that and blamed a packaged community build for
 * a sibling agent's `opencode` TLS connections. Asking instead "is this pid
 * running a binary inside the bundle under observation?" cannot be confused by
 * either, and it is also the more honest scope: the Next standalone server
 * child runs `process.execPath` from inside the bundle and stays covered, while
 * an Agent Source shell the operator launched is their own process making their
 * own traffic (decision `0036` §6), not this build's network identity.
 */
async function snapshotBundleProcesses(bundlePath) {
  const { stdout } = await execFileAsync('ps', ['-axo', 'pid=,comm=']);
  const command = new Map();
  for (const line of stdout.split('\n')) {
    const match = /^\s*(\d+)\s+(.*)$/.exec(line);
    if (!match) continue;
    const executable = match[2].trim();
    if (!executable.startsWith(bundlePath)) continue;
    command.set(Number(match[1]), executable.split('/').pop());
  }
  return { pids: [...command.keys()], command };
}

function isLoopback(address) {
  return (
    address.startsWith('127.') ||
    address === '::1' ||
    address === '[::1]' ||
    address === '*'
  );
}

/** `lsof -F` machine output → the remote peers this process tree holds. */
function parseSockets(output) {
  const peers = [];
  let pid = null;
  let command = null;
  for (const line of output.split('\n')) {
    const tag = line[0];
    const value = line.slice(1);
    if (tag === 'p') pid = Number(value);
    if (tag === 'c') command = value;
    if (tag !== 'n') continue;
    const arrow = value.indexOf('->');
    if (arrow < 0) continue; // a listener, not a peer
    const remote = value.slice(arrow + 2).replace(/\s*\(.*\)$/, '');
    const port = remote.lastIndexOf(':');
    if (port < 0) continue;
    peers.push({
      pid,
      command,
      address: remote.slice(0, port),
      port: Number(remote.slice(port + 1)),
      raw: remote,
    });
  }
  return peers;
}

function startSocketSampler(bundlePath) {
  const peers = new Map();
  let reusedPids = 0;
  let samples = 0;
  let stopped = false;
  const loop = (async () => {
    while (!stopped) {
      try {
        const tree = await snapshotBundleProcesses(bundlePath);
        if (tree.pids.length === 0) {
          await new Promise(ok => setTimeout(ok, SAMPLE_INTERVAL_MS));
          continue;
        }
        const { stdout } = await execFileAsync('lsof', [
          '-nP',
          '-i',
          '-a',
          '+c',
          '0',
          '-p',
          tree.pids.join(','),
          '-F',
          'pcn',
        ]).catch(error => ({ stdout: error.stdout ?? '' }));
        samples += 1;
        for (const peer of parseSockets(stdout)) {
          if (tree.command.get(peer.pid) !== peer.command) {
            // The pid changed hands between the `ps` read and the `lsof` read.
            reusedPids += 1;
            continue;
          }
          const key = `${peer.command} ${peer.raw}`;
          if (!peers.has(key)) {
            peers.set(key, { ...peer, firstSeen: Date.now() });
          }
        }
      } catch {
        /* a process that exits mid-sample is normal, not a finding */
      }
      await new Promise(ok => setTimeout(ok, SAMPLE_INTERVAL_MS));
    }
  })();
  return {
    async stop() {
      stopped = true;
      await loop;
      return { peers: [...peers.values()], reusedPids, samples };
    },
  };
}

/* ------------------------------------------------------------------ */
/* the package under observation                                       */
/* ------------------------------------------------------------------ */

const expectedSourceSha =
  process.env.EXAWATT_BUILD_SOURCE_SHA ??
  execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();

function packagedTreeError(candidate) {
  if (!candidate || !existsSync(candidate.executablePath)) {
    return new Error('no local package');
  }
  try {
    assertPackagedContract(candidate.appPath, candidate.digest);
    assertPackagedSource(candidate.appPath, expectedSourceSha);
    return null;
  } catch (error) {
    return error;
  }
}

async function resolveOrNull() {
  try {
    return await resolvePackagedApp();
  } catch {
    return null; // `@exawatt/core` runtime is a build product; try again after
  }
}

let packaged = await resolveOrNull();
let treeError = packagedTreeError(packaged);
if (!process.env.EXAWATT_APP_PATH && treeError) {
  console.log(
    `[observatory] ${treeError.message}; building the exact current tree`
  );
  execFileSync('pnpm', ['electron:build:dir'], { stdio: 'inherit' });
  // Packaging stages dist-electron/node_modules onto the DEVELOPMENT module
  // resolution path (incident 0012). Leaving it behind poisons every dev
  // Electron eval that runs after this gate in the same tree.
  execFileSync('node', ['scripts/discard-electron-snapshot.mjs'], {
    stdio: 'inherit',
  });
  packaged = await resolvePackagedApp();
  treeError = packagedTreeError(packaged);
}
if (!packaged) packaged = await resolvePackagedApp();
if (treeError) throw treeError;
assertPackagedContract(packaged.appPath, packaged.digest);
assertPackagedSource(packaged.appPath, expectedSourceSha);

// Observing the wrong composition would make every absence below meaningless
// in exactly the way incident `0015` was written about, so the run states the
// composition it is proving and refuses any other.
const contract = packaged.contract;
const nonNull = [
  contract.brand !== null && 'brand',
  contract.account !== null && 'account',
  contract.analytics !== null && 'analytics',
  contract.updates !== null && 'updates',
  ...Object.entries(contract.services)
    .filter(([, ref]) => ref !== null)
    .map(([name]) => `services.${name}`),
  ...Object.entries(contract.enrichment)
    .filter(([, ref]) => ref !== null)
    .map(([name]) => `enrichment.${name}`),
].filter(Boolean);
if (nonNull.length > 0) {
  throw new Error(
    `This gate observes the COMMUNITY composition. The resolved contract ` +
      `(${packaged.identity.productName}, digest ${packaged.digest.slice(0, 12)}) ` +
      `declares ${nonNull.join(', ')}. Unset EXAWATT_DISTRIBUTION_CONFIG_JSON ` +
      'and EXAWATT_DISTRIBUTION_PROFILE and run again.'
  );
}

console.log(
  `[observatory] ${packaged.identity.productName} (${packaged.identity.appId}) ` +
    `distribution ${packaged.digest.slice(0, 12)}; every capability null`
);

/* ------------------------------------------------------------------ */
/* the run                                                             */
/* ------------------------------------------------------------------ */

const sink = await startResolverSink();
const userData = mkdtempSync(join(tmpdir(), 'exawatt-observatory-'));
const findings = [];
let sampler = null;
/** Non-null once the run has a verdict to report as a failure. */
let failure = null;

try {
  const observed = await withElectronApp(
    {
      executablePath: packaged.executablePath,
      cwd: ROOT,
      args: [
        // Every name to the sink, with loopback excluded so the app's own
        // renderer origin and Next server are untouched. The exclusions are
        // NOT optional: Chromium applies these rules to IP literals too, so
        // `MAP *` alone rewrites the port of `http://127.0.0.1:<renderer>`
        // and the workspace never loads. Exclusion rules are evaluated before
        // map rules regardless of their order in the list.
        `--host-resolver-rules=MAP * 127.0.0.1:${sink.port},` +
          ' EXCLUDE localhost, EXCLUDE 127.0.0.1, EXCLUDE ::1',
      ],
      env: {
        ...process.env,
        EXAWATT_TEST: '1',
        EXAWATT_USER_DATA: userData,
        EXAWATT_RENDERER_LOGS: '1',
      },
    },
    async (app, page) => {
      const startedAt = Date.now();
      sampler = startSocketSampler(packaged.appPath);
      page.setDefaultTimeout(30_000);

      const steps = [];
      await page.locator('[data-command-altitude]').waitFor();
      const origin = new URL(page.url()).origin;
      if (!origin.startsWith('http://127.0.0.1:')) {
        throw new Error(`Packaged renderer is not on loopback: ${origin}`);
      }
      steps.push('workspace rendered');

      // ── positive controls, before any absence is believed ──────────────
      const mainProbe = await app.evaluate(async ({ net }, host) => {
        try {
          await net.fetch(`https://${host}/main-probe`);
          return 'completed';
        } catch (error) {
          return `refused: ${String(error?.message ?? error)}`;
        }
      }, PROBE_HOST);
      await page.evaluate(host => {
        const image = new Image();
        image.src = `https://${host}/renderer-probe.png`;
        // `img-src ... https:` is open in the community CSP, so this reaches
        // the resolver; `connect-src 'self' ws:` would refuse a fetch() probe
        // before DNS, which is a different layer than the one under test.
        document.body.appendChild(image);
      }, PROBE_HOST);
      const rendererProbe = await page
        .evaluate(async host => {
          try {
            await fetch(`https://${host}/renderer-connect-probe`);
            return 'completed';
          } catch (error) {
            return `refused: ${String(error?.message ?? error)}`;
          }
        }, PROBE_HOST)
        .catch(error => `refused: ${String(error?.message ?? error)}`);
      await page.waitForTimeout(1_500);
      steps.push('controls fired');

      // ── the exercise: sign-in, the workspace, a launch, privacy ────────
      await page.goto(`${origin}/sign-in`);
      await page.waitForLoadState('domcontentloaded');
      const signInText = await page.locator('body').innerText();
      steps.push('sign-in rendered');

      await page.goto(`${origin}/settings`);
      await page.waitForLoadState('domcontentloaded');
      steps.push('settings rendered');

      await page.goto(`${origin}/workspace`);
      await page.locator('[data-command-altitude]').waitFor();
      const created = await page.evaluate(
        async () =>
          await window.electron?.pty?.create({ harness: 'shell', cwd: '/tmp' })
      );
      if (!created?.ok) {
        throw new Error(`Packaged shell failed: ${created?.error ?? 'none'}`);
      }
      await page.evaluate(async id => {
        await window.electron?.pty?.write(id, "printf 'OBSERVATORY_OK\\n'\n");
      }, created.session.id);
      await page.waitForFunction(async id => {
        const buffer = await window.electron?.pty?.buffer(id);
        return buffer?.includes('OBSERVATORY_OK');
      }, created.session.id);
      steps.push('launch round trip');

      // Idle out the rest of the window: a periodic timer is exactly the kind
      // of caller a single navigation pass would never provoke.
      const remaining = OBSERVATION_MS - (Date.now() - startedAt);
      if (remaining > 0) await page.waitForTimeout(remaining);
      steps.push(`idled ${Math.max(0, Math.round(remaining / 1000))}s`);

      return {
        steps,
        mainProbe,
        rendererProbe,
        signInRendered: signInText.trim().length,
        windowMs: Date.now() - startedAt,
      };
    },
    { maxMs: OBSERVATION_MS + 120_000, firstWindowMs: 45_000 }
  );

  const { peers, reusedPids, samples } = await sampler.stop();
  sampler = null;
  await sink.stop();

  /* ---------------------------------------------------------------- */
  /* verdict                                                          */
  /* ---------------------------------------------------------------- */

  const probes = sink.connections.filter(c => c.host === PROBE_HOST);
  const unnamed = sink.connections.filter(c => c.host === null);
  const foreign = sink.connections.filter(
    c => c.host !== null && c.host !== PROBE_HOST
  );
  const sinkPeers = peers.filter(
    p => isLoopback(p.address) && p.port === sink.port
  );
  const offLoopback = peers.filter(p => !isLoopback(p.address));

  console.log(`\n[observatory] exercise: ${observed.steps.join(' -> ')}`);
  console.log(
    `[observatory] window ${Math.round(observed.windowMs / 1000)}s; ` +
      `sink saw ${sink.connections.length} connection(s); ` +
      `sampler took ${samples} samples and saw ${peers.length} distinct peer(s)` +
      (reusedPids > 0 ? `, dropping ${reusedPids} reused-pid sample(s)` : '')
  );
  console.log(
    `[observatory] renderer connect-src probe: ${observed.rendererProbe}`
  );
  for (const connection of sink.connections) {
    console.log(`  sink  <- ${connection.host ?? '(name not offered)'}`);
  }
  for (const peer of peers) {
    console.log(`  socket   ${peer.command} -> ${peer.raw}`);
  }

  // The instruments prove themselves first. An unproven instrument reporting
  // nothing is indistinguishable from a silent app, which is the exact shape
  // incident `0017` cost eighteen hours.
  if (probes.length === 0) {
    findings.push(
      'INSTRUMENT UNPROVEN: neither positive control reached the sink, so the ' +
        'resolver interception is not known to be live and no absence below ' +
        `is evidence. main probe reported: ${observed.mainProbe}`
    );
  }
  if (observed.signInRendered === 0) {
    findings.push(
      'VACUOUS RUN: /sign-in rendered nothing, so this window did not exercise ' +
        'the surface it claims to have exercised.'
    );
  }
  if (sinkPeers.length === 0) {
    findings.push(
      'INSTRUMENT UNPROVEN: the socket sampler never observed the app holding ' +
        'a connection to the sink, so its absence report is not evidence.'
    );
  }

  for (const connection of foreign) {
    const host = connection.host.toLowerCase();
    const family = EXAWATT_SUFFIXES.some(s => host.endsWith(s))
      ? 'AN EXAWATT SERVICE'
      : ANTHROPIC_SUFFIXES.some(s => host.endsWith(s))
        ? 'ANTHROPIC'
        : 'a third party';
    findings.push(
      `A packaged community build resolved ${connection.host} (${family}).`
    );
  }
  for (const connection of unnamed) {
    findings.push(
      'A packaged community build opened a connection through the resolver ' +
        'without offering a name (no SNI, no Host header).'
    );
  }
  for (const peer of offLoopback) {
    findings.push(
      `A packaged community build held a socket off loopback: ${peer.command} -> ${peer.raw}.`
    );
  }

  /* ---------------------------------------------------------------- */
  /* own-account (Anthropic) — a different family, stated not implied  */
  /* ---------------------------------------------------------------- */

  // Decision `0036` §6 (amended 2026-08-16) requires the automatic own-account
  // read to be gated on a distribution-declared stable signing identity,
  // because `app.isPackaged` is not a durable boundary after the repository
  // split: a contributor's ad-hoc package is packaged too (incident `0011`).
  // Schema V1 does not carry `ownAccount` yet, so the boundary is still
  // `packaged && !test`. This asserts what the repository ACTUALLY declares so
  // the roadmap cannot drift from it in either direction.
  const compiledPlanAccount = resolve(
    ROOT,
    'dist-electron/main/consumption/claude-plan-account.js'
  );
  if (!existsSync(compiledPlanAccount)) {
    throw new Error(
      `${compiledPlanAccount} is missing, so the own-account boundary cannot ` +
        'be read from the same source the package was built from. Run ' +
        '`pnpm electron:compile` (or `pnpm worktree:setup`) first.'
    );
  }
  const { isClaudePlanRemoteReadAllowed } = require(compiledPlanAccount);
  const adHocPackagedAutomatic = isClaudePlanRemoteReadAllowed({
    packaged: true,
    testMode: false,
    developmentOptIn: undefined,
  });
  const OWN_ACCOUNT_BOUNDARY_TODAY = true; // see the comment above
  if (adHocPackagedAutomatic !== OWN_ACCOUNT_BOUNDARY_TODAY) {
    findings.push(
      'The own-account boundary changed: an ad-hoc packaged community build ' +
        `now computes automatic Anthropic read = ${adHocPackagedAutomatic}. ` +
        'That is the milestone property moving — update OS4.2 and this gate ' +
        'together rather than letting one describe the other wrongly.'
    );
  }
  console.log(
    `\n[observatory] OPEN — own-account read: an ad-hoc packaged community ` +
      `build computes automatic Anthropic read = ${adHocPackagedAutomatic} ` +
      '(`packaged && !test`). This run cannot observe it: EXAWATT_TEST=1 is ' +
      'required for a non-focus-stealing launch and is one of that gate’s ' +
      'own inputs. OS4.2 stays open on `ownAccount.claudePlanUsage`.'
  );

  if (findings.length > 0) {
    failure = `\nFAIL community network observatory:\n - ${findings.join('\n - ')}`;
  } else {
    console.log(
      `\nPASS community network observatory (${packaged.identity.productName}): ` +
        `over ${Math.round(observed.windowMs / 1000)}s exercising sign-in, the ` +
        'workspace, and a launch, the packaged build resolved no hostname ' +
        `except the ${probes.length} deliberate control probe(s) and opened no ` +
        'socket off loopback. Resolver interception and socket sampling were ' +
        'both proven live in this run.'
    );
  }
} catch (error) {
  failure = String(error?.stack ?? error);
} finally {
  if (sampler) await sampler.stop();
  await sink.stop().catch(() => {});
  rmSync(userData, { recursive: true, force: true, maxRetries: 5 });
}

// End deliberately. A gate that does not EXIT hangs a landing floor forever,
// and Playwright's transport sockets can outlive `app.close()` — one run held
// the process open for minutes after printing its verdict. The write callback
// is what makes this safe: `process.exit` truncates a pipe that has not
// flushed, and this gate's whole output is its evidence.
if (failure) console.error(failure);
await new Promise(resolve => process.stdout.write('', resolve));
process.exit(failure ? 1 : 0);
