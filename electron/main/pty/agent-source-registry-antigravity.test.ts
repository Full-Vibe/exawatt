/**
 * Antigravity's sign-in and catalog facts come from one command, `agy
 * models`, which needs the account's sign-in AND the network. A listing that
 * fails or lists nothing must therefore read as unknown, never as signed out
 * or as an empty catalog, and must never block a launch (ENG-003 S5.3).
 * Drives the real registry through the test-harness bin, where `agy` is a
 * script answering `--version` and `models`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  agentSourceLaunchVerdict,
  agentSourceObservationComplete,
} from '@exawatt/core';

const PRIOR = {
  test: process.env.EXAWATT_TEST,
  bin: process.env.EXAWATT_TEST_HARNESS_BIN,
};

let bin: string;

function restore(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

function fakeAgy(version: string, models: string): void {
  fs.writeFileSync(
    path.join(bin, 'agy'),
    `#!/bin/sh\nif [ "$1" = "--version" ]; then printf '%s\\n' '${version}'; exit 0; fi\n` +
      `if [ "$1" = "models" ]; then ${models}; fi\nexit 1\n`,
    { mode: 0o755 }
  );
}

beforeEach(() => {
  bin = fs.mkdtempSync(path.join(os.tmpdir(), 'exawatt-registry-agy-bin-'));
  process.env.EXAWATT_TEST = '1';
  process.env.EXAWATT_TEST_HARNESS_BIN = bin;
});

afterEach(() => {
  fs.rmSync(bin, { recursive: true, force: true });
  restore('EXAWATT_TEST', PRIOR.test);
  restore('EXAWATT_TEST_HARNESS_BIN', PRIOR.bin);
});

async function antigravitySnapshot() {
  vi.resetModules();
  const registry = await import('./agent-source-registry');
  const snapshot = await registry.inspectAgentSources('/bin/sh', 'all');
  const source = snapshot.sources.find(
    candidate => candidate.harness === 'antigravity'
  );
  if (!source) throw new Error('no Antigravity source');
  return source;
}

describe('Antigravity CLI in the source registry', () => {
  it('is ready when agy models lists the account’s models', async () => {
    fakeAgy(
      '1.2.17',
      `printf 'Fetching available models...\\n'; printf 'fixture-flash\\tFixture Flash\\n'; printf 'fixture-sonnet\\tFixture Sonnet\\n'; exit 0`
    );
    const source = await antigravitySnapshot();
    expect(source.state).toBe('ready');
    expect(source.facts.authentication.state).toBe('ready');
    expect(source.facts.modelDiscovery.value).toBe('2 models reported');
    expect(source.facts.compatibility.value).toBe('Compatible');
    expect(source.summary).toContain('does not yet tell Exawatt when it needs you');
    expect(agentSourceObservationComplete(source)).toBe(true);
    expect(agentSourceLaunchVerdict(source)).toEqual({ kind: 'clear' });
  });

  it('reads a failed listing as unknown, not as signed out, and never blocks the launch', async () => {
    fakeAgy('1.2.17', `printf 'Error: could not reach the account\\n' >&2; exit 1`);
    const source = await antigravitySnapshot();
    expect(source.state).toBe('unknown');
    expect(source.facts.authentication.state).toBe('unknown');
    expect(source.facts.authentication.detail).toContain(
      'could not reach the account'
    );
    expect(source.facts.modelDiscovery.state).toBe('unknown');
    // The probe answered, so coverage is complete; the state is what is unknown.
    expect(source.unobservedProbes).toEqual([]);
    expect(source.actions.authenticate).toBe(false);
    expect(agentSourceLaunchVerdict(source).kind).toBe('unproven');
  });

  it('reads an empty listing the same way', async () => {
    fakeAgy('1.2.17', `printf 'Fetching available models...\\n'; exit 0`);
    const source = await antigravitySnapshot();
    expect(source.state).toBe('unknown');
    expect(source.facts.modelDiscovery.value).toBe('Not listed');
    expect(agentSourceLaunchVerdict(source).kind).toBe('unproven');
  });

  it('refuses a version older than the verified contract', async () => {
    fakeAgy('1.0.4', `printf 'fixture-flash\\tFixture Flash\\n'; exit 0`);
    const source = await antigravitySnapshot();
    expect(source.state).toBe('incompatible');
    expect(source.launchable).toBe(false);
  });
});
