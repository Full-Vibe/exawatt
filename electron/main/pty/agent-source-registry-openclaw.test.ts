/**
 * OpenClaw's "configured" fact comes from `~/.openclaw/openclaw.json` when
 * the Gateway itself does not answer, so a file that is there and cannot be
 * read must read as unknown, never as "needs a configuration", and must never
 * replace the last complete observation (BUG-245). Drives the real registry
 * through the test-harness bin, where `openclaw` is a script whose Gateway
 * status fails.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { agentSourceObservationComplete } from '@exawatt/core';

const PRIOR = {
  test: process.env.EXAWATT_TEST,
  bin: process.env.EXAWATT_TEST_HARNESS_BIN,
  home: process.env.HOME,
};

let bin: string;
let home: string;

function restore(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

beforeEach(() => {
  bin = fs.mkdtempSync(
    path.join(os.tmpdir(), 'exawatt-registry-openclaw-bin-')
  );
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'exawatt-registry-openclaw-'));
  fs.mkdirSync(path.join(home, '.openclaw'));
  fs.writeFileSync(
    path.join(bin, 'openclaw'),
    '#!/bin/sh\nif [ "$1" = "--version" ]; then echo 2026.9.1; exit 0; fi\necho "{}"\nexit 1\n',
    { mode: 0o755 }
  );
  process.env.EXAWATT_TEST = '1';
  process.env.EXAWATT_TEST_HARNESS_BIN = bin;
  process.env.HOME = home;
});

afterEach(() => {
  restore('EXAWATT_TEST', PRIOR.test);
  restore('EXAWATT_TEST_HARNESS_BIN', PRIOR.bin);
  restore('HOME', PRIOR.home);
  fs.rmSync(bin, { recursive: true, force: true });
  fs.rmSync(home, { recursive: true, force: true });
});

async function openClawSnapshot() {
  vi.resetModules();
  const registry = await import('./agent-source-registry');
  const snapshot = await registry.inspectAgentSources('/bin/sh', 'all');
  const openclaw = snapshot.sources.find(
    source => source.id === 'openclaw-local'
  );
  if (!openclaw) throw new Error('no OpenClaw source');
  return openclaw;
}

const config = () => path.join(home, '.openclaw', 'openclaw.json');

describe('OpenClaw configuration in the source registry', () => {
  it('reads a hand-edited JSON5 configuration the way OpenClaw does', async () => {
    fs.writeFileSync(
      config(),
      '{\n  // edited by hand\n  gateway: { port: 4242, },\n}\n'
    );
    const openclaw = await openClawSnapshot();
    expect(openclaw.configured).toBe(true);
    expect(openclaw.state).toBe('degraded');
  });

  it('reports a configuration it could not read as unknown, and never remembers that', async () => {
    fs.writeFileSync(config(), '{ gateway: ');
    const openclaw = await openClawSnapshot();
    expect(openclaw.state).toBe('unknown');
    expect(openclaw.facts.reachability.state).toBe('unknown');
    expect(openclaw.facts.reachability.detail).toMatch(/not valid JSON5/);
    expect(openclaw.unobservedProbes).toContain('configuration');
    expect(agentSourceObservationComplete(openclaw)).toBe(false);
  });

  it('still asks for a configuration when there is truly none', async () => {
    const openclaw = await openClawSnapshot();
    expect(openclaw.configured).toBe(false);
    expect(openclaw.state).toBe('action-required');
  });
});
