// Generated for the public repository by the "public-dogfood-tooling" recipe.
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  EXPECTED_DOGFOOD_IDENTIFIER,
  EXPECTED_DOGFOOD_TEAM_IDENTIFIER,
  assertStableDeveloperIdSignature,
  hasStableSignerIdentity,
  parseCodesignDetails,
  parseCodeSigningIdentities,
  selectDeveloperIdIdentity,
  teamIdentifierFromIdentityName,
} from './lib/macos-code-signing.mjs';

test('dogfood signing requires the official distribution identity', () => {
  assert.equal(EXPECTED_DOGFOOD_IDENTIFIER, 'ai.exawatt.desktop');
});

const developerId = {
  fingerprint: 'A'.repeat(40),
  name: `Developer ID Application: Example Org (${EXPECTED_DOGFOOD_TEAM_IDENTIFIER})`,
};

test('parses valid security identities without treating summary lines as identities', () => {
  const output = [
    `  1) ${'B'.repeat(40)} "Apple Development: Example (${EXPECTED_DOGFOOD_TEAM_IDENTIFIER})"`,
    `  2) ${developerId.fingerprint} "${developerId.name}"`,
    '     2 valid identities found',
  ].join('\n');

  assert.deepEqual(parseCodeSigningIdentities(output), [
    {
      fingerprint: 'B'.repeat(40),
      name: `Apple Development: Example (${EXPECTED_DOGFOOD_TEAM_IDENTIFIER})`,
    },
    developerId,
  ]);
});

test('selects the only Developer ID Application identity and derives its team', () => {
  assert.equal(
    selectDeveloperIdIdentity([
      {
        fingerprint: 'B'.repeat(40),
        name: `Apple Development: Example (${EXPECTED_DOGFOOD_TEAM_IDENTIFIER})`,
      },
      developerId,
    ]),
    developerId
  );
  assert.equal(
    teamIdentifierFromIdentityName(developerId.name),
    EXPECTED_DOGFOOD_TEAM_IDENTIFIER
  );
});

test('requires an exact fingerprint when Developer ID identities are ambiguous', () => {
  const second = {
    fingerprint: 'C'.repeat(40),
    name: `Developer ID Application: Renewed Example Org (${EXPECTED_DOGFOOD_TEAM_IDENTIFIER})`,
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

test('never substitutes a sole Developer ID identity from another Team', () => {
  const otherTeam = {
    fingerprint: 'C'.repeat(40),
    name: 'Developer ID Application: Other Org (OTHERID123)',
  };
  assert.throws(
    () => selectDeveloperIdIdentity([otherTeam]),
    new RegExp(`Exawatt Team ${EXPECTED_DOGFOOD_TEAM_IDENTIFIER}`)
  );
  assert.throws(
    () => selectDeveloperIdIdentity([otherTeam], otherTeam.fingerprint),
    new RegExp(`require Team ${EXPECTED_DOGFOOD_TEAM_IDENTIFIER}`)
  );
});

test('fails concretely when no Developer ID Application identity exists', () => {
  assert.throws(
    () =>
      selectDeveloperIdIdentity([
        {
          fingerprint: 'B'.repeat(40),
          name: `Apple Development: Example (${EXPECTED_DOGFOOD_TEAM_IDENTIFIER})`,
        },
      ]),
    /Import the existing Exawatt Developer ID certificate/
  );
});

test('parses and accepts a stable Developer ID code signature', () => {
  const signature = parseCodesignDetails(
    [
      'Identifier=com.exawatt.app',
      `Authority=Developer ID Application: Example Org (${EXPECTED_DOGFOOD_TEAM_IDENTIFIER})`,
      'Authority=Developer ID Certification Authority',
      `TeamIdentifier=${EXPECTED_DOGFOOD_TEAM_IDENTIFIER}`,
      'CDHash=1234',
      'Timestamp=Jul 19, 2026 at 1:00:00 AM',
      'Runtime Version=26.4.0',
    ].join('\n')
  );

  assert.doesNotThrow(() =>
    assertStableDeveloperIdSignature(signature, {
      expectedIdentifier: 'com.exawatt.app',
      expectedTeamIdentifier: EXPECTED_DOGFOOD_TEAM_IDENTIFIER,
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
        { expectedTeamIdentifier: EXPECTED_DOGFOOD_TEAM_IDENTIFIER }
      ),
    new RegExp(`expected ${EXPECTED_DOGFOOD_TEAM_IDENTIFIER}`)
  );
});

test('rejects signatures without a timestamp or hardened runtime', () => {
  const base = {
    identifier: 'com.exawatt.app',
    teamIdentifier: EXPECTED_DOGFOOD_TEAM_IDENTIFIER,
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
