// ENG-022 H12 regression pins. The policy is what matters here: an attached
// client keeps a dev server alive, an abandoned one exits, and a probe that
// could not measure anything never counts as abandoned.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_IDLE_TTL_MS,
  UNKNOWN_CONNECTIONS,
  countEstablishedConnections,
  nextIdleState,
  resolveDevPort,
  resolveIdleTtlMs,
  watchForIdle,
} from './lib/dev-idle-watch.mjs';

test('the last -p wins, matching Next and the doubled package script', () => {
  // `pnpm dev -p 7041` expands to `next dev -p 7000 -p 7041`.
  assert.equal(resolveDevPort(['dev', '-p', '7000', '-p', '7041']), 7041);
  assert.equal(resolveDevPort(['dev', '--port=7090']), 7090);
  assert.equal(resolveDevPort(['dev'], { env: { PORT: '7010' } }), 7010);
  assert.equal(resolveDevPort(['dev']), 3000);
});

test('an operator can disable the watch outright', () => {
  assert.equal(resolveIdleTtlMs('0'), 0);
  assert.equal(resolveIdleTtlMs('nonsense'), 0);
  assert.equal(resolveIdleTtlMs(undefined), DEFAULT_IDLE_TTL_MS);
  assert.equal(resolveIdleTtlMs('5'), 5 * 60 * 1000);
});

test('an attached client refreshes the deadline', () => {
  const state = nextIdleState({
    connections: 2,
    lastAttachedAt: 0,
    now: 5_000,
    ttlMs: 1_000,
  });
  assert.equal(state.exit, false);
  assert.equal(state.lastAttachedAt, 5_000);
});

test('no client for the full TTL exits', () => {
  assert.equal(
    nextIdleState({ connections: 0, lastAttachedAt: 0, now: 999, ttlMs: 1_000 })
      .exit,
    false
  );
  assert.equal(
    nextIdleState({ connections: 0, lastAttachedAt: 0, now: 1_000, ttlMs: 1_000 })
      .exit,
    true
  );
});

test('an unmeasurable probe never reads as abandoned', () => {
  const state = nextIdleState({
    connections: UNKNOWN_CONNECTIONS,
    lastAttachedAt: 0,
    now: 10 ** 9,
    ttlMs: 1_000,
  });
  assert.equal(state.exit, false);
});

test('a missing lsof reports UNKNOWN, an empty match reports zero', async () => {
  const missing = await countEstablishedConnections(7000, {
    run: async () => {
      const error = new Error('spawn lsof ENOENT');
      error.code = 'ENOENT';
      throw error;
    },
  });
  assert.equal(missing, UNKNOWN_CONNECTIONS);

  const noMatch = await countEstablishedConnections(7000, {
    run: async () => {
      const error = new Error('exit 1');
      error.code = 1;
      error.stdout = '';
      throw error;
    },
  });
  assert.equal(noMatch, 0);

  const two = await countEstablishedConnections(7000, {
    run: async () => ({ stdout: '431\n518\n' }),
  });
  assert.equal(two, 2);
});

test('a disabled watch never probes and never fires', async () => {
  let probed = 0;
  const stop = watchForIdle({
    port: 7000,
    ttlMs: 0,
    pollIntervalMs: 1,
    probe: async () => {
      probed += 1;
      return 0;
    },
    onIdle: () => assert.fail('a disabled watch must not shut anything down'),
  });
  await new Promise(resolve => setTimeout(resolve, 20));
  stop();
  assert.equal(probed, 0);
});

test('the watch shuts an abandoned server down and stops polling', async () => {
  let clock = 0;
  let fired = 0;
  const stop = watchForIdle({
    port: 7000,
    ttlMs: 30,
    pollIntervalMs: 1,
    now: () => clock,
    probe: async () => {
      clock += 10;
      return 0;
    },
    onIdle: () => {
      fired += 1;
    },
  });
  await new Promise(resolve => setTimeout(resolve, 60));
  stop();
  assert.equal(fired, 1, 'shuts down exactly once');
});

test('a server that keeps a client is never shut down', async () => {
  let clock = 0;
  const stop = watchForIdle({
    port: 7000,
    ttlMs: 30,
    pollIntervalMs: 1,
    now: () => clock,
    probe: async () => {
      clock += 10;
      return 1;
    },
    onIdle: () => assert.fail('an attached server must stay up'),
  });
  await new Promise(resolve => setTimeout(resolve, 60));
  stop();
});
