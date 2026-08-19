import { describe, expect, it } from 'vitest';
import {
  gatewayIdentityDrifted,
  normalizeGatewayIdentity,
  sameGatewayIdentity,
} from './gateway-identity';

/**
 * Which installation is behind a configured source (ENG-010 C3).
 *
 * The identity used to be sanitised twice — once as it came off a socket and
 * once, more weakly, as it came off disk — and compared twice. These cases
 * hold the one owner to both jobs, because a value that reads as equal in one
 * place and different in another is how a projection silently rebinds.
 *
 * Every id below is invented.
 */

describe('reading an identity from anywhere untrusted', () => {
  it('sorts and dedupes, so a writer’s order is not a different installation', () => {
    const fromDisk = normalizeGatewayIdentity({
      version: '2026.8.1',
      nativeAgentIds: ['quill', 'lumen', 'quill'],
    });
    const observed = normalizeGatewayIdentity({
      version: '2026.8.1',
      nativeAgentIds: ['lumen', 'quill'],
    });

    expect(fromDisk?.nativeAgentIds).toEqual(['lumen', 'quill']);
    expect(
      fromDisk && observed && sameGatewayIdentity(fromDisk, observed)
    ).toBe(true);
  });

  it('drops what could not be an id, and trims the version', () => {
    expect(
      normalizeGatewayIdentity({
        version: '  2026.8.1  ',
        nativeAgentIds: ['lumen', '', '  ', 7, null, 'x'.repeat(5_000)],
      })
    ).toEqual({ version: '2026.8.1', nativeAgentIds: ['lumen'] });
  });

  it('collapses nothing usable to null, which is “never seen”', () => {
    // Null must never read as an identity, because an identity that is empty
    // rather than absent is a roster with nothing in common with everything.
    for (const value of [
      null,
      undefined,
      'lumen',
      [],
      { version: '', nativeAgentIds: [] },
      { version: 7, nativeAgentIds: 'lumen' },
    ]) {
      expect(normalizeGatewayIdentity(value)).toBeNull();
    }
  });
});

describe('telling one installation from another', () => {
  const north = { version: '2026.8.1', nativeAgentIds: ['lumen', 'quill'] };

  it('is not drift when the source was simply upgraded', () => {
    // Asking the operator to remap on every OpenClaw update trains them to
    // dismiss the one prompt that matters.
    const upgraded = {
      version: '2026.9.0',
      nativeAgentIds: ['lumen', 'quill'],
    };
    expect(gatewayIdentityDrifted(north, upgraded)).toBe(false);
    expect(sameGatewayIdentity(north, upgraded)).toBe(false);
  });

  it('is not drift when an Agent was added or retired', () => {
    expect(
      gatewayIdentityDrifted(north, {
        version: '2026.8.1',
        nativeAgentIds: ['quill'],
      })
    ).toBe(false);
    expect(
      gatewayIdentityDrifted(north, {
        version: '2026.8.1',
        nativeAgentIds: ['lumen', 'quill', 'brier'],
      })
    ).toBe(false);
  });

  it('is drift when the new roster has nothing in common with the old one', () => {
    expect(
      gatewayIdentityDrifted(north, {
        version: '2026.8.1',
        nativeAgentIds: ['tessera', 'brier'],
      })
    ).toBe(true);
    // A source that configures nothing where it used to configure two is the
    // same disjointness, and the operator decides what it means.
    expect(
      gatewayIdentityDrifted(north, { version: '2026.8.1', nativeAgentIds: [] })
    ).toBe(true);
  });

  it('cannot drift against a source Exawatt has no history with', () => {
    expect(
      gatewayIdentityDrifted({ version: '', nativeAgentIds: [] }, north)
    ).toBe(false);
  });
});
