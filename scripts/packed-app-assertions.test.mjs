import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { assertBundleIdentity } from './lib/packed-app-assertions.mjs';

const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
const basePlist = {
  CFBundleShortVersionString: version,
  CFBundleVersion: version,
};

test('community package refuses any official scheme or bundle identity', () => {
  const config = {
    appId: 'ai.exawatt.community',
    productName: 'Exawatt Community',
    mac: {},
  };
  assert.doesNotThrow(() =>
    assertBundleIdentity(
      'Exawatt Community.app',
      {
        ...basePlist,
        CFBundleIdentifier: 'ai.exawatt.community',
        CFBundleName: 'Exawatt Community',
      },
      { builderConfig: config }
    )
  );
  assert.throws(
    () =>
      assertBundleIdentity(
        'Exawatt Community.app',
        {
          ...basePlist,
          CFBundleIdentifier: 'ai.exawatt.community',
          CFBundleName: 'Exawatt Community',
          CFBundleURLTypes: [{ CFBundleURLSchemes: ['exawatt'] }],
        },
        { builderConfig: config }
      ),
    /declares none/
  );
});

test('a branded package must carry its exact name, app id, and protocol', () => {
  const config = {
    appId: 'ai.example.agent-console',
    productName: 'Agent Console',
    protocols: [{ name: 'Agent Console', schemes: ['agent-console'] }],
    mac: { icon: 'assets/agent-console.icns' },
  };
  const plist = {
    ...basePlist,
    CFBundleIdentifier: 'ai.example.agent-console',
    CFBundleName: 'Agent Console',
    CFBundleURLTypes: [{ CFBundleURLSchemes: ['agent-console'] }],
  };
  assert.doesNotThrow(() =>
    assertBundleIdentity('Agent Console.app', plist, {
      builderConfig: config,
    })
  );
  assert.throws(
    () =>
      assertBundleIdentity(
        'Agent Console.app',
        { ...plist, CFBundleURLTypes: [] },
        { builderConfig: config }
      ),
    /declares agent-console/
  );
});
