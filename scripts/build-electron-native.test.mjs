import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { minimatch } from 'minimatch';
import { buildElectronNative } from './build-electron-native.mjs';

test('non-macOS source adapters require no macOS native addons', () => {
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
  assert.ok(built.includes('notification-authorization'));
  assert.ok(built.includes('screen-lock-snapshot'));
  const { command, args } = calls.find(call =>
    call.args.at(-1).endsWith('notification-authorization.mm')
  );
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

test('every built native capability is included and unpacked in the desktop app', () => {
  const calls = [];
  buildElectronNative({
    platform: 'darwin',
    run: (_command, args) => calls.push(args),
  });
  const config = parse(readFileSync('electron-builder.yml', 'utf8'));
  for (const args of calls) {
    const binary = args[args.indexOf('-o') + 1].slice(process.cwd().length + 1);
    assert.ok(
      config.files
        .filter(pattern => !pattern.startsWith('!'))
        .some(pattern => minimatch(binary, pattern))
    );
    assert.ok(
      config.files
        .filter(pattern => pattern.startsWith('!'))
        .every(pattern => !minimatch(binary, pattern.slice(1)))
    );
    assert.ok(config.asarUnpack.some(pattern => minimatch(binary, pattern)));
  }
  const screenLock = calls.find(args =>
    args.at(-1).endsWith('screen-lock-snapshot.mm')
  );
  assert.ok(screenLock.includes('CoreGraphics'));
  assert.ok(screenLock.includes('CoreFoundation'));
});
