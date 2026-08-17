import assert from 'node:assert/strict';
import test from 'node:test';

import { validateCompanyOverlayManifest } from './lib/company-composition.mjs';

function desktopEntry(overrides = {}) {
  return {
    source: 'company/overlay/desktop/config/distribution.json',
    target: 'distribution/distribution.json',
    role: 'official-distribution',
    profile: 'official-desktop',
    mode: 'add',
    ...overrides,
  };
}

test('official-desktop structurally refuses hosted-web roles', () => {
  const entry = desktopEntry({ role: 'hosted-route' });
  assert.throws(
    () =>
      validateCompanyOverlayManifest({ schemaVersion: 1, entries: [entry] }),
    /role hosted-route is not valid for official-desktop/
  );
});

test('official-desktop cannot disguise a hosted route as distribution config', () => {
  const hostedTargets = [
    'src/app/api/feedback/route.ts',
    'src/app/admin/invites/page.tsx',
    'src/lib/auth/admin.ts',
    'src/lib/invites/service.ts',
    'src/lib/goal-visuals/server.ts',
  ];
  for (const target of hostedTargets) {
    assert.throws(
      () =>
        validateCompanyOverlayManifest({
          schemaVersion: 1,
          entries: [desktopEntry({ target })],
        }),
      /hosted-web code/
    );
  }
});

test('profile inputs live under disjoint source roots', () => {
  assert.throws(
    () =>
      validateCompanyOverlayManifest({
        schemaVersion: 1,
        entries: [
          desktopEntry({
            source: 'company/overlay/web/config/distribution.json',
          }),
        ],
      }),
    /must live under company\/overlay\/desktop/
  );

  assert.doesNotThrow(() =>
    validateCompanyOverlayManifest({
      schemaVersion: 1,
      entries: [desktopEntry()],
    })
  );
});
