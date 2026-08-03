import assert from 'node:assert/strict';
import test from 'node:test';
import {
  appBundleForExecutable,
  assertStableBrowserIdentity,
  defaultMacBrowserCandidates,
  QA_BROWSER_ALLOW_UNSTABLE_ENV,
  QA_BROWSER_EXECUTABLE_ENV,
  resolveQaBrowser,
} from './lib/qa-browser.mjs';

const signed = ({
  identifier = 'com.example.browser',
  teamIdentifier = 'TEAM123456',
} = {}) => ({
  identifier,
  teamIdentifier,
  signature: '00deadbeef',
  cdHash: 'abc123',
  timestamp: null,
  runtimeVersion: '26.0.0',
  authorities: [`Developer ID Application: Example (${teamIdentifier})`],
});

const stableSelection = candidate => ({
  kind: 'signed-system-browser',
  name: candidate.name,
  executablePath: candidate.executablePath,
  helperPath: '/Applications/Browser.app/helper',
  mainSignature: signed(),
  helperSignature: signed({ identifier: 'com.example.browser.helper' }),
  launchOptions: { executablePath: candidate.executablePath },
});

test('macOS candidates prefer signed Google Chrome and retain Brave fallback', () => {
  const candidates = defaultMacBrowserCandidates('/Users/tester');
  assert.equal(candidates[0].name, 'Google Chrome');
  assert.equal(
    candidates[0].executablePath,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  );
  assert.equal(candidates[2].name, 'Brave Browser');
});

test('appBundleForExecutable resolves a macOS app executable', () => {
  assert.equal(
    appBundleForExecutable(
      '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'
    ),
    '/Applications/Brave Browser.app'
  );
  assert.throws(
    () => appBundleForExecutable('/usr/local/bin/chromium'),
    /not a macOS application-bundle executable/
  );
});

test('browser identity requires the same stable signer on main and network helper', () => {
  const result = assertStableBrowserIdentity({
    name: 'Browser',
    executablePath: '/Applications/Browser.app/Contents/MacOS/Browser',
    helperPath: '/Applications/Browser.app/helper',
    mainSignature: signed(),
    helperSignature: signed({ identifier: 'com.example.browser.helper' }),
  });
  assert.equal(result.kind, 'signed-system-browser');

  assert.throws(
    () =>
      assertStableBrowserIdentity({
        name: 'Browser',
        executablePath: '/Applications/Browser.app/Contents/MacOS/Browser',
        helperPath: '/Applications/Browser.app/helper',
        mainSignature: signed(),
        helperSignature: {
          ...signed({ identifier: 'helper' }),
          signature: 'adhoc',
          teamIdentifier: 'not set',
          authorities: [],
        },
      }),
    /network helper is ad-hoc/
  );

  assert.throws(
    () =>
      assertStableBrowserIdentity({
        name: 'Browser',
        executablePath: '/Applications/Browser.app/Contents/MacOS/Browser',
        helperPath: '/Applications/Browser.app/helper',
        mainSignature: signed(),
        helperSignature: signed({
          identifier: 'helper',
          teamIdentifier: 'OTHER12345',
        }),
      }),
    /network helper uses Team OTHER12345/
  );
});

test('macOS resolver skips an invalid preferred browser and selects the signed fallback', async () => {
  const inspected = [];
  const result = await resolveQaBrowser(
    { executablePath: () => '/cache/playwright-browser' },
    {
      platform: 'darwin',
      home: '/Users/tester',
      env: {},
      exists: () => true,
      inspectCandidate: async candidate => {
        inspected.push(candidate.name);
        if (candidate.name === 'Google Chrome') {
          throw new Error('invalid signature');
        }
        return stableSelection(candidate);
      },
    }
  );
  assert.deepEqual(inspected, [
    'Google Chrome',
    'Google Chrome',
    'Brave Browser',
  ]);
  assert.equal(result.name, 'Brave Browser');
});

test('explicit browser path is validated and does not silently fall back', async () => {
  const explicit =
    '/Applications/Custom Browser.app/Contents/MacOS/Custom Browser';
  await assert.rejects(
    resolveQaBrowser(
      { executablePath: () => '/cache/playwright-browser' },
      {
        platform: 'darwin',
        env: { [QA_BROWSER_EXECUTABLE_ENV]: explicit },
        exists: () => true,
        inspectCandidate: async () => {
          throw new Error('ad-hoc helper');
        },
      }
    ),
    error =>
      error.message.includes('No stable signed Chromium browser') &&
      error.message.includes('Custom Browser: ad-hoc helper')
  );
});

test('macOS refuses Playwright managed Chrome unless explicitly opted in', async () => {
  await assert.rejects(
    resolveQaBrowser(
      { executablePath: () => '/cache/playwright-browser' },
      {
        platform: 'darwin',
        env: {},
        exists: () => false,
      }
    ),
    /intentionally refused/
  );

  const result = await resolveQaBrowser(
    { executablePath: () => '/cache/playwright-browser' },
    {
      platform: 'darwin',
      env: { [QA_BROWSER_ALLOW_UNSTABLE_ENV]: '1' },
      exists: path => path === '/cache/playwright-browser',
    }
  );
  assert.equal(result.kind, 'playwright-managed-browser');
  assert.match(result.warning, /explicit unstable macOS browser override/);
});

test('non-macOS retains Playwright managed browser behavior', async () => {
  const result = await resolveQaBrowser(
    { executablePath: () => '/cache/playwright-browser' },
    {
      platform: 'linux',
      env: {},
      exists: path => path === '/cache/playwright-browser',
    }
  );
  assert.equal(result.kind, 'playwright-managed-browser');
  assert.deepEqual(result.launchOptions, {});
  assert.equal(result.warning, null);
});
