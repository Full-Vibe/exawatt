import assert from 'node:assert/strict';
import test from 'node:test';
import {
  reportEnvironmentResult,
  runWorktreeSetup,
} from './lib/worktree-setup.mjs';

function harness({
  platform = 'darwin',
  bindingPresent = false,
  environment = {
    status: 'skipped-unconfigured',
    pullStatus: 'not-configured',
  },
  failAt = null,
} = {}) {
  const calls = [];
  const messages = [];
  return {
    calls,
    messages,
    execute: () =>
      runWorktreeSetup({
        platform,
        say: message => messages.push(message),
        run: command => {
          calls.push(command);
          if (command === failAt) throw new Error(`failed: ${command}`);
        },
        prepareEnvironment: () => {
          calls.push('environment');
          return environment;
        },
        hasNodePtyBinding: () => bindingPresent,
      }),
  };
}

test('community setup skips optional env and still runs every required stage', () => {
  const setup = harness();
  assert.equal(setup.execute().pullStatus, 'not-configured');
  assert.deepEqual(setup.calls, [
    'pnpm install --prefer-offline',
    'pnpm qa:browser:doctor',
    'environment',
    'pnpm electron:rebuild',
    'pnpm electron:compile',
  ]);
  assert.match(setup.messages.join('\n'), /community-safe setup/);
  assert.match(setup.messages.at(-1), /ready/);
});

test('an existing native binding skips only the rebuild', () => {
  const setup = harness({ platform: 'linux', bindingPresent: true });
  setup.execute();
  assert.deepEqual(setup.calls, [
    'pnpm install --prefer-offline',
    'environment',
    'pnpm electron:compile',
  ]);
});

for (const [name, environment] of [
  [
    'linked checkout without Vercel CLI',
    {
      status: 'copied',
      pullStatus: 'cli-unavailable',
      snapshotSource: '/private/main',
    },
  ],
  [
    'linked checkout without Vercel access or private env',
    {
      status: 'missing-source',
      pullStatus: 'failed',
      snapshotSource: '/private/main',
    },
  ],
]) {
  test(`${name} still completes every required stage`, () => {
    const setup = harness({ environment });
    setup.execute();
    assert.deepEqual(setup.calls, [
      'pnpm install --prefer-offline',
      'pnpm qa:browser:doctor',
      'environment',
      'pnpm electron:rebuild',
      'pnpm electron:compile',
    ]);
    assert.match(setup.messages.at(-1), /ready/);
  });
}

for (const requiredStage of [
  'pnpm install --prefer-offline',
  'pnpm qa:browser:doctor',
  'pnpm electron:rebuild',
  'pnpm electron:compile',
]) {
  test(`required setup stage fails visibly: ${requiredStage}`, () => {
    const setup = harness({ failAt: requiredStage });
    assert.throws(setup.execute, new RegExp(`failed: ${requiredStage}`));
    assert.equal(
      setup.messages.some(message => message.startsWith('ready')),
      false
    );
  });
}

test('linked fallback messaging distinguishes missing CLI and missing env', () => {
  const messages = [];
  reportEnvironmentResult(
    {
      status: 'missing-source',
      pullStatus: 'cli-unavailable',
      snapshotSource: '/private/main',
    },
    message => messages.push(message)
  );
  assert.match(messages[0], /CLI unavailable/);
  assert.match(messages[1], /continuing without \.env\.local/);
});
