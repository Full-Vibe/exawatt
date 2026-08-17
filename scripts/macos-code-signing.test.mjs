// Generated for the public repository by the "public-dogfood-tooling" recipe.
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertStableDeveloperIdSignature,
  hasStableSignerIdentity,
  parseCodesignDetails,
  parseCodeSigningIdentities,
  selectDeveloperIdIdentity,
  teamIdentifierFromIdentityName,
} from './lib/macos-code-signing.mjs';

const TEST_TEAM = '5G5A77XLHZ';

const developerId = {
  fingerprint: 'A'.repeat(40),
  name: `Developer ID Application: Example Org (${TEST_TEAM})`,
};

test('parses valid security identities without treating summary lines as identities', () => {
  const output = [
    `  1) ${'B'.repeat(40)} "Apple Development: Example (${TEST_TEAM})"`,
    `  2) ${developerId.fingerprint} "${developerId.name}"`,
    '     2 valid identities found',
  ].join('\n');

  assert.deepEqual(parseCodeSigningIdentities(output), [
    {
      fingerprint: 'B'.repeat(40),
      name: `Apple Development: Example (${TEST_TEAM})`,
    },
    developerId,
  ]);
});

test('selects the only Developer ID Application identity and derives its team', () => {
  assert.equal(
    selectDeveloperIdIdentity([
      {
        fingerprint: 'B'.repeat(40),
        name: `Apple Development: Example (${TEST_TEAM})`,
      },
      developerId,
    ]),
    developerId
  );
  assert.equal(teamIdentifierFromIdentityName(developerId.name), TEST_TEAM);
});

test('requires an exact fingerprint when Developer ID identities are ambiguous', () => {
  const second = {
    fingerprint: 'C'.repeat(40),
    name: `Developer ID Application: Renewed Example Org (${TEST_TEAM})`,
  };
  assert.throws(
    () => selectDeveloperIdIdentity([developerId, second]),
    /Multiple Developer ID Application identities/
  );
  assert.equal(
    selectDeveloperIdIdentity(
      [developerId, second],
      developerId.fingerprint.toLowerCase()
    ),
    developerId
  );
});

test('uses any distributor by default and enforces an explicitly pinned Team', () => {
  const otherTeam = {
    fingerprint: 'C'.repeat(40),
    name: 'Developer ID Application: Other Org (OTHERID123)',
  };
  assert.equal(selectDeveloperIdIdentity([otherTeam]), otherTeam);
  assert.throws(
    () =>
      selectDeveloperIdIdentity([otherTeam], otherTeam.fingerprint, TEST_TEAM),
    new RegExp(`requires Team ${TEST_TEAM}`)
  );
});

test('fails concretely when no Developer ID Application identity exists', () => {
  assert.throws(
    () =>
      selectDeveloperIdIdentity([
        {
          fingerprint: 'B'.repeat(40),
          name: `Apple Development: Example (${TEST_TEAM})`,
        },
      ]),
    /Import a distribution signing certificate/
  );
});

test('parses and accepts a stable Developer ID code signature', () => {
  const signature = parseCodesignDetails(
    [
      'Identifier=com.exawatt.app',
      `Authority=Developer ID Application: Example Org (${TEST_TEAM})`,
      'Authority=Developer ID Certification Authority',
      `TeamIdentifier=${TEST_TEAM}`,
      'CDHash=1234',
      'Timestamp=Jul 19, 2026 at 1:00:00 AM',
      'Runtime Version=26.4.0',
    ].join('\n')
  );

  assert.doesNotThrow(() =>
    assertStableDeveloperIdSignature(signature, {
      expectedIdentifier: 'com.exawatt.app',
      expectedTeamIdentifier: TEST_TEAM,
    })
  );
});

test('rejects ad-hoc and cross-team nested signatures', () => {
  assert.throws(
    () =>
      assertStableDeveloperIdSignature({
        identifier: 'com.exawatt.app',
        teamIdentifier: 'not set',
        signature: 'adhoc',
        authorities: [],
      }),
    /no stable Team Identifier/
  );
  assert.throws(
    () =>
      assertStableDeveloperIdSignature(
        {
          identifier: 'com.exawatt.app.helper',
          teamIdentifier: 'OTHERID123',
          signature: null,
          cdHash: '1234',
          timestamp: 'Jul 19, 2026 at 1:00:00 AM',
          runtimeVersion: '26.4.0',
          authorities: [developerId.name],
        },
        { expectedTeamIdentifier: TEST_TEAM }
      ),
    new RegExp(`expected ${TEST_TEAM}`)
  );
});

test('rejects signatures without a timestamp or hardened runtime', () => {
  const base = {
    identifier: 'com.exawatt.app',
    teamIdentifier: TEST_TEAM,
    signature: null,
    cdHash: '1234',
    timestamp: 'Jul 19, 2026 at 1:00:00 AM',
    runtimeVersion: '26.4.0',
    authorities: [developerId.name],
  };
  assert.throws(
    () => assertStableDeveloperIdSignature({ ...base, timestamp: null }),
    /secure signing timestamp/
  );
  assert.throws(
    () => assertStableDeveloperIdSignature({ ...base, runtimeVersion: null }),
    /hardened-runtime options/
  );
});

test('recognizes a stable signer boundary independently from signature hardening', () => {
  assert.equal(
    hasStableSignerIdentity({
      identifier: 'com.exawatt.app',
      teamIdentifier: 'OTHERID123',
      signature: null,
      authorities: ['Apple Development: Other Org (OTHERID123)'],
    }),
    true
  );
  assert.equal(
    hasStableSignerIdentity({
      identifier: 'com.exawatt.app',
      teamIdentifier: 'not set',
      signature: 'adhoc',
      authorities: [],
    }),
    false
  );
});
