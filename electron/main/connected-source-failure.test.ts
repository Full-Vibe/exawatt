import { describe, expect, it } from 'vitest';
import type { SourceFailureClass } from '@exawatt/core';
import {
  BOOTSTRAP_FAILURE_TO_SOURCE_FAILURE,
  TUNNEL_FAILURE_TO_SOURCE_FAILURE,
  classifyAuthorityRefusal,
  classifyHandshakeFailure,
} from './connected-source-failure';

/**
 * What kind of no was that (ENG-010)?
 *
 * These cases moved here with the code they exercise. They were written
 * against the Gateway session because that is where the tables and the two
 * matchers used to live; nothing in them ever needed a session, a socket, or a
 * clock, and the classification is the thing that decides an operator's next
 * step whoever happens to be calling it.
 *
 * Every sentence quoted below is one a Gateway actually answered with during
 * the live runs recorded in the project doc. None of them names a host, a
 * user, a server, or a credential.
 */

describe('classifying a refused handshake', () => {
  it('classifies what the source said, and guesses nothing when it said nothing', () => {
    for (const sentence of [
      'unauthorized: device token mismatch (rotate/reissue device token)',
      'device identity mismatch',
      'NOT_PAIRED: pairing required',
      'FORBIDDEN: operator.write scope required',
      'invalid token',
    ]) {
      expect(classifyHandshakeFailure(sentence)).toBe('auth-rejected');
    }

    for (const sentence of [
      'INTERNAL: the Gateway is restarting',
      'connection closed',
      null,
    ]) {
      // An unexplained refusal is not evidence about the credential. Guessing
      // one would discard a working device and send the operator to re-pair
      // something that was never the problem.
      expect(classifyHandshakeFailure(sentence)).toBe('gateway-down');
    }
  });

  it('reads the source’s own words whatever case it shouted them in', () => {
    expect(classifyHandshakeFailure('UNAUTHORIZED: DEVICE TOKEN')).toBe(
      'auth-rejected'
    );
  });
});

describe('classifying a refused authority request', () => {
  it('tells an approval apart from an outage in the Gateway own words', () => {
    for (const message of [
      'INVALID_REQUEST: unauthorized: device token scope mismatch (re-pair or approve scope upgrade)',
      'NOT_PAIRED: pairing required: device is asking for more scopes than currently approved',
    ]) {
      expect(classifyAuthorityRefusal(message)).toBe('approval-required');
    }
    for (const message of [
      'INTERNAL: the Gateway is restarting',
      'connection timeout after 10000ms',
      '',
    ]) {
      expect(classifyAuthorityRefusal(message)).toBe('refused');
    }
  });

  it('answers a different question than the credential one does', () => {
    // Both lists mention pairing, and they still disagree on purpose: a
    // refusal that only says "unauthorized" is evidence the saved credential
    // is spent, and no evidence at all that a person has an approval waiting.
    expect(classifyHandshakeFailure('unauthorized')).toBe('auth-rejected');
    expect(classifyAuthorityRefusal('unauthorized')).toBe('refused');
  });
});

describe('the failure vocabularies', () => {
  it('classifies every tunnel and bootstrap failure it can receive', () => {
    const sourceClasses: SourceFailureClass[] = [
      'host-unreachable',
      'gateway-down',
      'auth-rejected',
      'approval-required',
      'incompatible',
      'unknown',
    ];
    for (const mapped of Object.values(TUNNEL_FAILURE_TO_SOURCE_FAILURE)) {
      expect(sourceClasses).toContain(mapped);
    }
    for (const mapped of Object.values(BOOTSTRAP_FAILURE_TO_SOURCE_FAILURE)) {
      expect(sourceClasses).toContain(mapped);
    }
  });

  it('never reports a fault on this machine as one on the server', () => {
    // A target Exawatt could not even form is a configuration fault here, and
    // `host-unreachable` would send the operator to check a network that is
    // fine.
    expect(TUNNEL_FAILURE_TO_SOURCE_FAILURE['invalid-target']).toBe('unknown');
    expect(BOOTSTRAP_FAILURE_TO_SOURCE_FAILURE['invalid-target']).toBe(
      'unknown'
    );
  });
});
