/**
 * Qwen Code's sign-in and model facts come from its settings file, so an
 * unreadable file must read as unknown, never as "signed out" or "no models",
 * and must never replace the last complete observation (BUG-242).
 * Drives the real registry through the test-harness bin, where the qwen
 * executable is a script that answers `--version`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { agentSourceObservationComplete } from '@exawatt/core';

const PRIOR = {
  test: process.env.EXAWATT_TEST,
  bin: process.env.EXAWATT_TEST_HARNESS_BIN,
  qwenHome: process.env.QWEN_HOME,
};

let bin: string;
let qwenHome: string;

function restore(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

beforeEach(() => {
  bin = fs.mkdtempSync(path.join(os.tmpdir(), 'exawatt-registry-qwen-bin-'));
  qwenHome = fs.mkdtempSync(path.join(os.tmpdir(), 'exawatt-registry-qwen-'));
  fs.writeFileSync(path.join(bin, 'qwen'), '#!/bin/sh\necho 0.24.4\n', {
    mode: 0o755,
  });
  process.env.EXAWATT_TEST = '1';
  process.env.EXAWATT_TEST_HARNESS_BIN = bin;
  process.env.QWEN_HOME = qwenHome;
});

afterEach(() => {
  fs.rmSync(bin, { recursive: true, force: true });
  fs.rmSync(qwenHome, { recursive: true, force: true });
  restore('EXAWATT_TEST', PRIOR.test);
  restore('EXAWATT_TEST_HARNESS_BIN', PRIOR.bin);
  restore('QWEN_HOME', PRIOR.qwenHome);
});

async function qwenSnapshot() {
  vi.resetModules();
  const registry = await import('./agent-source-registry');
  const snapshot = await registry.inspectAgentSources('/bin/sh', 'all');
  const qwen = snapshot.sources.find(source => source.harness === 'qwen');
  if (!qwen) throw new Error('no Qwen Code source');
  return qwen;
}

describe('Qwen Code settings in the source registry', () => {
  it('reads a commented settings file the way Qwen Code does', async () => {
    fs.writeFileSync(
      path.join(qwenHome, 'settings.json'),
      '\uFEFF{\n  // written by /auth\n  "security": { "auth": { "selectedType": "openai" } }\n}\n'
    );
    const qwen = await qwenSnapshot();
    expect(qwen.state).toBe('ready');
    expect(qwen.facts.authentication.state).toBe('ready');
  });

  it('reports settings it could not read as unknown, and never remembers that', async () => {
    fs.writeFileSync(path.join(qwenHome, 'settings.json'), '{ "security": ');
    const qwen = await qwenSnapshot();
    expect(qwen.state).toBe('unknown');
    expect(qwen.facts.authentication.state).toBe('unknown');
    expect(qwen.facts.modelDiscovery.state).toBe('unknown');
    expect(qwen.unobservedProbes).toEqual(
      expect.arrayContaining(['authentication', 'model catalog'])
    );
    expect(qwen.actions.authenticate).toBe(false);
    // Incomplete observations never overwrite the last complete one.
    expect(agentSourceObservationComplete(qwen)).toBe(false);
  });

  it('still says "sign in" when there is truly no settings file', async () => {
    const qwen = await qwenSnapshot();
    expect(qwen.state).toBe('action-required');
    expect(qwen.facts.authentication.state).toBe('action-required');
  });
});
