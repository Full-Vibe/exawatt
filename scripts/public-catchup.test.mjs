import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { parseCatchupArgs, runPublicCatchup } from './public-catchup.mjs';

const sourceSha = 'a'.repeat(40),
  previous = 'b'.repeat(40),
  candidate = 'c'.repeat(40),
  digest = 'd'.repeat(64);
async function fixture(fn) {
  const root = await mkdtemp(path.join(tmpdir(), 'public-catchup-contract-'));
  const calls = [];
  const state = { tip: previous, source: sourceSha, held: true };
  const deps = {
    resolveRemote: async () => ({ url: 'fixture-public', name: 'public' }),
    readHold: async () =>
      state.held
        ? { expectedPublicSha: previous, publicRepository: 'fixture-public' }
        : null,
    clearHold: async () => {
      calls.push('clear');
      state.held = false;
    },
    stateRoot: async () => root,
    git: async (_root, ...args) => {
      if (args[0] === 'ls-remote') return `${state.tip}\trefs/heads/master`;
      if (args[0] === 'rev-parse') return state.source;
      if (args[0] === 'push') {
        calls.push(args);
        return '';
      }
      return '';
    },
    lock: async () => {
      calls.push('lock');
      return { release: async () => calls.push('release') };
    },
    project: async args => ({
      ...args,
      sourceSha,
      publicSha: candidate,
      planDigest: digest,
      projectedPaths: ['package.json'],
      unrenderedOutputs: [],
      epochUpdate: { sourceSha, publicSha: candidate },
    }),
    certify: async () => {
      calls.push('certify');
      return {
        status: 'passed',
        sourceSha,
        publicSha: candidate,
        planDigest: digest,
      };
    },
    publish: async (_root, prepared, ops) => {
      calls.push('publish');
      await ops.push(prepared);
      return { state: 'published', recorded: true };
    },
  };
  try {
    await fn({
      root,
      calls,
      state,
      deps,
      options: { sourceSha, expectedPublicSha: previous, execute: true },
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('default catch-up preserves a preview and never publishes or clears a hold', () =>
  fixture(async ({ root, calls, deps, options }) => {
    const result = await runPublicCatchup(
      root,
      { ...options, execute: false },
      deps
    );
    assert.equal(result.state, 'preview');
    assert.equal(
      JSON.parse(await readFile(path.join(result.attempt, 'preview.json')))
        .publicSha,
      candidate
    );
    assert.deepEqual(calls, []);
  }));
test('execution certifies before locking and pushes only the certified immutable SHA without force', () =>
  fixture(async ({ root, calls, deps, options }) => {
    const result = await runPublicCatchup(root, options, deps);
    assert.equal(result.state, 'published');
    assert.deepEqual(calls, [
      'certify',
      'lock',
      'publish',
      ['push', '--quiet', 'fixture-public', `${candidate}:refs/heads/master`],
      'clear',
      'release',
    ]);
  }));
test('failed or mismatched certification cannot publish', () =>
  fixture(async ({ root, calls, deps, options }) => {
    deps.certify = async () => ({
      status: 'passed',
      sourceSha,
      publicSha: previous,
      planDigest: digest,
    });
    await assert.rejects(
      runPublicCatchup(root, options, deps),
      /certification/
    );
    assert.deepEqual(calls, []);
  }));
test('a source movement during certification leaves the remote and hold alone', () =>
  fixture(async ({ root, calls, state, deps, options }) => {
    const certify = deps.certify;
    deps.certify = async () => {
      const evidence = await certify();
      state.source = candidate;
      return evidence;
    };
    await assert.rejects(
      runPublicCatchup(root, options, deps),
      /current integrated/
    );
    assert.deepEqual(calls, ['certify', 'lock', 'release']);
    assert.equal(state.held, true);
  }));
test('a public movement during certification leaves the hold alone', () =>
  fixture(async ({ root, calls, state, deps, options }) => {
    const certify = deps.certify;
    deps.certify = async () => {
      const evidence = await certify();
      state.tip = candidate;
      return evidence;
    };
    await assert.rejects(runPublicCatchup(root, options, deps), /tip changed/);
    assert.deepEqual(calls, ['certify', 'lock', 'release']);
  }));
test('unrecorded publication retains maintenance custody for recovery', () =>
  fixture(async ({ root, calls, state, deps, options }) => {
    deps.publish = async () => ({ state: 'published', recorded: false });
    await assert.rejects(
      runPublicCatchup(root, options, deps),
      /hold retained/
    );
    assert.equal(state.held, true);
    assert.deepEqual(calls, ['certify', 'lock', 'release']);
  }));
test('execution without a matching hold fails before preparing a candidate', () =>
  fixture(async ({ root, state, deps, options }) => {
    state.held = false;
    deps.project = async () => assert.fail('must not project');
    await assert.rejects(
      runPublicCatchup(root, options, deps),
      /maintenance hold/
    );
  }));
test('CLI defaults to preview and rejects unknown options', () => {
  assert.equal(
    parseCatchupArgs(['--source', sourceSha, '--expected-public-sha', previous])
      .execute,
    false
  );
  assert.throws(() => parseCatchupArgs(['--force']), /Usage/);
});
