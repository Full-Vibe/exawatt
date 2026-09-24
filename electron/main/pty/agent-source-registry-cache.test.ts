/**
 * The registry cache and the one settled fact the operator changes in minutes
 * (BUG-180).
 *
 * A registry whose every launchable source is `ready` or `not-installed` is
 * served for five minutes without a re-probe, which is what makes a
 * steady-state ⌘T spawn no probe at all (BUG-062). But `not-installed` is the
 * fact the install guide exists to change: an operator who followed it and
 * came back to ⌘T was told "Claude Code is not installed" for up to five
 * minutes. These tests drive the real registry through the test-harness bin,
 * where the executable lookup is a file check, so installing a CLI is writing
 * a file.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const SHORT_WINDOW_MS = 5_000;
const PRIOR = {
  test: process.env.EXAWATT_TEST,
  bin: process.env.EXAWATT_TEST_HARNESS_BIN,
};

let bin: string;
let clock: number;

async function freshRegistry() {
  // The cache is module state; every case starts from a cold process.
  vi.resetModules();
  return import('./agent-source-registry');
}

function install(executable: string, script: string): void {
  fs.writeFileSync(path.join(bin, executable), `#!/bin/sh\n${script}\n`, {
    mode: 0o755,
  });
}

beforeEach(() => {
  bin = fs.mkdtempSync(path.join(os.tmpdir(), 'exawatt-registry-cache-'));
  process.env.EXAWATT_TEST = '1';
  process.env.EXAWATT_TEST_HARNESS_BIN = bin;
  clock = 1_800_000_000_000;
  vi.spyOn(Date, 'now').mockImplementation(() => clock);
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(bin, { recursive: true, force: true });
  if (PRIOR.test === undefined) delete process.env.EXAWATT_TEST;
  else process.env.EXAWATT_TEST = PRIOR.test;
  if (PRIOR.bin === undefined) delete process.env.EXAWATT_TEST_HARNESS_BIN;
  else process.env.EXAWATT_TEST_HARNESS_BIN = PRIOR.bin;
});

describe('a cached not-installed is re-confirmed before it is served', () => {
  it('sees a CLI installed after the registry settled, inside the settled window', async () => {
    const registry = await freshRegistry();
    const before = await registry.inspectAgentSources('/bin/sh', 'launch');
    const claudeBefore = before.sources.find(s => s.harness === 'claude');
    expect(claudeBefore?.state).toBe('not-installed');
    expect(registry.registryCacheWindowMs(before)).toBeGreaterThan(
      SHORT_WINDOW_MS
    );

    // The operator follows the install guide.
    install(
      'claude',
      [
        'case "$1" in',
        '  --version) echo "2.1.0 (Claude Code)" ;;',
        '  auth) echo \'{"loggedIn":true,"email":"fixture@example.com"}\' ;;',
        'esac',
      ].join('\n')
    );
    clock += SHORT_WINDOW_MS + 1_000;

    const after = await registry.inspectAgentSources('/bin/sh', 'launch');
    const claudeAfter = after.sources.find(s => s.harness === 'claude');
    expect(claudeAfter?.state).not.toBe('not-installed');
    expect(claudeAfter?.facts.installation.state).not.toBe('not-installed');
    // The main-process gate reads the same path and no longer refuses.
    expect(registry.agentSourceLaunchReadiness(after, 'claude')).not.toEqual(
      expect.objectContaining({ blocked: true })
    );
  });

  it('keeps serving the settled registry, with no full probe, while every absence holds', async () => {
    const registry = await freshRegistry();
    const first = await registry.inspectAgentSources('/bin/sh', 'launch');
    clock += SHORT_WINDOW_MS + 1_000;
    const second = await registry.inspectAgentSources('/bin/sh', 'launch');
    // The same observation: the absences were confirmed and nothing
    // re-probed (a re-probe would be stamped with the advanced clock).
    expect(second.observedAt).toBe(first.observedAt);
  });

  it('drops the stale negative from the no-probe paint once it is disproved', async () => {
    const registry = await freshRegistry();
    await registry.inspectAgentSources('/bin/sh', 'launch');
    // The new CLI holds its first probe open until the test releases it, so
    // the paint is read between the disproof and the new observation: the
    // window in which the old cache would still paint "not installed".
    const probed = path.join(bin, 'probed');
    const release = path.join(bin, 'release');
    install(
      'codex',
      `touch '${probed}'; while [ ! -e '${release}' ]; do sleep 0.02; done`
    );
    clock += SHORT_WINDOW_MS + 1_000;
    const probing = registry.inspectAgentSources('/bin/sh', 'launch');
    try {
      await vi.waitFor(() => expect(fs.existsSync(probed)).toBe(true), {
        timeout: 10_000,
      });
      const painted = await registry.rememberedAgentSources(
        '/bin/sh',
        'launch'
      );
      expect(
        painted?.sources.find(s => s.harness === 'codex')?.state ?? null
      ).not.toBe('not-installed');
    } finally {
      fs.writeFileSync(release, '');
      await probing;
    }
  });
});

describe('the pre-launch gate answers for the source it launches (BUG-210)', () => {
  function installReadyClaude(): void {
    install(
      'claude',
      [
        'case "$1" in',
        '  --version) echo "2.1.0 (Claude Code)" ;;',
        '  auth) echo \'{"loggedIn":true,"email":"fixture@example.com"}\' ;;',
        'esac',
      ].join('\n')
    );
  }

  function installSignedOutCodex(): void {
    install(
      'codex',
      [
        'case "$1" in',
        '  --version) echo "codex-cli 0.63.0" ;;',
        '  login) echo "Not logged in"; exit 1 ;;',
        'esac',
      ].join('\n')
    );
  }

  it('starts a ready source with no probe while ANOTHER source is unsettled', async () => {
    installReadyClaude();
    installSignedOutCodex();
    const registry = await freshRegistry();
    const first = await registry.inspectAgentSources('/bin/sh', 'launch');
    expect(first.sources.find(s => s.harness === 'claude')?.state).toBe(
      'ready'
    );
    // The signed-out source holds the whole registry to the short window,
    // which is the condition every Start used to pay a full probe for.
    expect(first.sources.find(s => s.harness === 'codex')?.state).not.toBe(
      'ready'
    );
    expect(registry.registryCacheWindowMs(first)).toBe(SHORT_WINDOW_MS);

    clock += SHORT_WINDOW_MS + 1_000;
    const gate = await registry.inspectAgentSources(
      '/bin/sh',
      'launch',
      false,
      'claude'
    );
    // Served from the observation already held: a re-probe would be stamped
    // with the advanced clock.
    expect(gate.observedAt).toBe(first.observedAt);
    expect(registry.agentSourceLaunchReadiness(gate, 'claude')).toEqual({
      known: true,
      blocked: false,
    });
  });

  it('re-probes when the launched source itself is the unsettled one', async () => {
    installReadyClaude();
    installSignedOutCodex();
    const registry = await freshRegistry();
    const first = await registry.inspectAgentSources('/bin/sh', 'launch');
    clock += SHORT_WINDOW_MS + 1_000;
    const gate = await registry.inspectAgentSources(
      '/bin/sh',
      'launch',
      false,
      'codex'
    );
    expect(gate.observedAt).toBeGreaterThan(first.observedAt);
  });

  it('re-probes a ready source once its fact is no longer fresh', async () => {
    installReadyClaude();
    installSignedOutCodex();
    const registry = await freshRegistry();
    const first = await registry.inspectAgentSources('/bin/sh', 'launch');
    clock += 5 * 60_000 + 1_000;
    const gate = await registry.inspectAgentSources(
      '/bin/sh',
      'launch',
      false,
      'claude'
    );
    expect(gate.observedAt).toBeGreaterThan(first.observedAt);
  });
});
