#!/usr/bin/env node
// Opt-in diagnostic, not a delivery gate (BUG-062 / BUG-082 readiness fact
// model). Answers two questions about ONE Agent Source registry read on this
// machine, with the operator's real login shell and real CLIs:
//
//   1. how many login shells it spawns;
//   2. how long it takes when the in-process cache has expired.
//
// The shell is wrapped by a same-basename script that counts invocations and
// execs the real shell, so `planLoginShell` still sees the real family. Only
// status commands run (`--version`, auth status, model lists): no agent turn,
// no inference, nothing billed. Timing is reported, never asserted against
// the host (BUG-057).
//
// After the readiness fact model landed it also reports the REMEMBERED read,
// the path the composer paints from first: it spawns no shell at all.
//
//   pnpm electron:compile
//   node scripts/agent-source-registry-probe.mjs
//
// REGISTRY_PROBE_RUNS (default 3) and REGISTRY_PROBE_SCOPE (`launch` |
// `all`) shape the run. Output is JSON on stdout.
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { loadavg, tmpdir, userInfo } from 'node:os';
import { basename, join, posix } from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { execFileSync } from 'node:child_process';

const repo = process.cwd();
const registryModule = join(
  repo,
  'dist-electron/main/pty/agent-source-registry.js'
);
if (!existsSync(registryModule)) {
  throw new Error(
    `Compiled registry missing at ${registryModule}. Run \`pnpm electron:compile\` first.`
  );
}
const storeModule = join(
  repo,
  'dist-electron/main/pty/agent-source-observation-store.js'
);

function loginShell() {
  try {
    return execFileSync(
      '/usr/bin/dscl',
      ['.', '-read', posix.join('/Users', userInfo().username), 'UserShell'],
      { encoding: 'utf8' }
    )
      .replace('UserShell:', '')
      .trim();
  } catch {
    return (process.env.SHELL || '/bin/zsh').trim();
  }
}

const realShell = loginShell();
const root = mkdtempSync(join(tmpdir(), 'exawatt-registry-probe-'));
const countFile = join(root, 'shells.log');
const wrapper = join(root, basename(realShell));
writeFileSync(
  wrapper,
  `#!/bin/sh\nprintf '%s\\n' "$*" >> '${countFile}'\nexec '${realShell}' "$@"\n`
);
chmodSync(wrapper, 0o755);

function shellsSpawned() {
  if (!existsSync(countFile)) return { count: 0, commands: [] };
  const commands = readFileSync(countFile, 'utf8')
    .split('\n')
    .filter(Boolean);
  return { count: commands.length, commands };
}

function resetShellCount() {
  if (existsSync(countFile)) rmSync(countFile);
}

const scope = process.env.REGISTRY_PROBE_SCOPE === 'all' ? 'all' : 'launch';
const runs = Math.max(1, Number.parseInt(process.env.REGISTRY_PROBE_RUNS ?? '3', 10));
const registry = await import(pathToFileURL(registryModule).href);
const report = {
  shell: realShell,
  scope,
  loadavg: loadavg(),
  live: [],
  remembered: null,
};

try {
  if (existsSync(storeModule) && registry.setAgentSourceObservationStore) {
    const { AgentSourceObservationStore } = await import(
      pathToFileURL(storeModule).href
    );
    registry.setAgentSourceObservationStore(
      new AgentSourceObservationStore(() => join(root, 'userData'))
    );
  }
  for (let run = 0; run < runs; run += 1) {
    resetShellCount();
    const started = performance.now();
    // refresh=true bypasses the five-second in-process cache: every run is a
    // cold registry read, which is what ⌘T pays after the cache expires.
    const snapshot = await registry.inspectAgentSources(wrapper, scope, true);
    const ms = Math.round(performance.now() - started);
    const shells = shellsSpawned();
    report.live.push({
      ms,
      loginShells: shells.count,
      commands: shells.commands,
      sources: snapshot.sources.map(source => ({
        adapterId: source.adapterId,
        state: source.state,
        launchable: source.launchable,
        unobservedProbes: source.unobservedProbes,
        origin: source.observation?.origin ?? null,
      })),
    });
  }
  if (registry.rememberedAgentSources) {
    resetShellCount();
    const started = performance.now();
    const remembered = await registry.rememberedAgentSources(wrapper, scope);
    report.remembered = {
      ms: Math.round((performance.now() - started) * 100) / 100,
      loginShells: shellsSpawned().count,
      sources:
        remembered?.sources.map(source => ({
          adapterId: source.adapterId,
          state: source.state,
          origin: source.observation?.origin ?? null,
          observedAt: source.observedAt,
        })) ?? null,
    };
  }
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log(JSON.stringify(report, null, 2));
