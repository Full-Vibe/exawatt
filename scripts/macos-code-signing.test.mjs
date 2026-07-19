// Generated for the public repository by the "public-dogfood-tooling" recipe.
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertStableDeveloperIdSignature,
  parseCodesignDetails,
  parseCodeSigningIdentities,
  selectDeveloperIdIdentity,
  teamIdentifierFromIdentityName,
} from './lib/macos-code-signing.mjs';

const developerId = {
  fingerprint: 'A'.repeat(40),
  name: 'Developer ID Application: Example Org (TEAMID1234)',
};

test('parses valid security identities without treating summary lines as identities', () => {
  const output = [
    `  1) ${'B'.repeat(40)} "Apple Development: Example (TEAMID1234)"`,
    `  2) ${developerId.fingerprint} "${developerId.name}"`,
    '     2 valid identities found',
  ].join('\n');

  assert.deepEqual(parseCodeSigningIdentities(output), [
    {
      fingerprint: 'B'.repeat(40),
      name: 'Apple Development: Example (TEAMID1234)',
    },
    developerId,
  ]);
});

test('selects the only Developer ID Application identity and derives its team', () => {
  assert.equal(
    selectDeveloperIdIdentity([
      {
        fingerprint: 'B'.repeat(40),
        name: 'Apple Development: Example (TEAMID1234)',
      },
      developerId,
    ]),
    developerId
  );
  assert.equal(teamIdentifierFromIdentityName(developerId.name), 'TEAMID1234');
});

test('requires an exact fingerprint when Developer ID identities are ambiguous', () => {
  const second = {
    fingerprint: 'C'.repeat(40),
    name: 'Developer ID Application: Other Org (OTHERID123)',
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

test('fails concretely when no Developer ID Application identity exists', () => {
  assert.throws(
    () =>
      selectDeveloperIdIdentity([
        {
          fingerprint: 'B'.repeat(40),
          name: 'Apple Development: Example (TEAMID1234)',
        },
      ]),
    /Import the existing Exawatt Developer ID certificate/
  );
});

test('parses and accepts a stable Developer ID code signature', () => {
  const signature = parseCodesignDetails(
    [
      'Identifier=com.exawatt.app',
      'Authority=Developer ID Application: Example Org (TEAMID1234)',
      'Authority=Developer ID Certification Authority',
      'TeamIdentifier=TEAMID1234',
      'CDHash=1234',
    ].join('\n')
  );

  assert.doesNotThrow(() =>
    assertStableDeveloperIdSignature(signature, {
      expectedIdentifier: 'com.exawatt.app',
      expectedTeamIdentifier: 'TEAMID1234',
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
          authorities: [developerId.name],
        },
        { expectedTeamIdentifier: 'TEAMID1234' }
      ),
    /expected TEAMID1234/
  );
});
