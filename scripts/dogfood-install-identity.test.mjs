import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { dogfoodInstallLayout } from './lib/dogfood-install-identity.mjs';
import { resolvePackagedApp } from './lib/packaged-app.mjs';

test('official and community dogfood installs coexist', async () => {
  const community = await resolvePackagedApp({
    root: '/source',
    appPathOverride: undefined,
    inputJson: undefined,
  });
  const official = await resolvePackagedApp({
    root: '/source',
    appPathOverride: undefined,
    inputJson: await readFile(
      new URL('./distribution.official.example.json', import.meta.url),
      'utf8'
    ),
  });
  const options = {
    installDir: '/Applications',
    homeDirectory: '/Users/operator',
  };

  assert.deepEqual(dogfoodInstallLayout(community, options), {
    target: '/Applications/Exawatt Community.app',
    staging: '/Applications/.Exawatt Community.transaction.app',
    statePath:
      '/Users/operator/Library/Application Support/ai.exawatt.community/update-state.json',
  });
  assert.deepEqual(dogfoodInstallLayout(official, options), {
    target: '/Applications/Exawatt.app',
    staging: '/Applications/.Exawatt.transaction.app',
    statePath:
      '/Users/operator/Library/Application Support/Exawatt/update-state.json',
  });
});
