import assert from 'node:assert/strict';
import test from 'node:test';
import { buildElectronNative } from './build-electron-native.mjs';

test('no native addon is built off macOS, where nothing prompts', () => {
  const calls = [];
  const built = buildElectronNative({
    platform: 'linux',
    run: (...call) => calls.push(call),
  });
  assert.deepEqual(built, []);
  assert.deepEqual(calls, []);
});

test('on macOS the addon is compiled for the host arch against the N-API headers', () => {
  const calls = [];
  const built = buildElectronNative({
    root: process.cwd(),
    platform: 'darwin',
    arch: 'arm64',
    run: (command, args) => calls.push({ command, args }),
  });
  assert.deepEqual(built, ['notification-authorization']);
  const { command, args } = calls[0];
  assert.equal(command, 'xcrun');
  assert.ok(args.includes('-bundle'));
  assert.equal(args[args.indexOf('-arch') + 1], 'arm64');
  assert.ok(args.some(arg => arg.endsWith('node-api-headers/include')));
  assert.ok(args.includes('UserNotifications'));
  assert.ok(args.at(-1).endsWith('notification-authorization.mm'));
  assert.ok(
    args[args.indexOf('-o') + 1].endsWith(
      'dist-electron/native/notification-authorization.node'
    )
  );
});

test('an Intel host compiles for x86_64', () => {
  const calls = [];
  buildElectronNative({
    platform: 'darwin',
    arch: 'x64',
    run: (_command, args) => calls.push(args),
  });
  assert.equal(calls[0][calls[0].indexOf('-arch') + 1], 'x86_64');
});
