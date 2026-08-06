import { describe, expect, it } from 'vitest';
import { hasAccountSession, readLaunchContext } from './launch-context';

describe('launch context', () => {
  it('describes a signed release desktop launch', () => {
    expect(
      readLaunchContext({
        isElectron: true,
        platform: 'darwin',
        delivery: 'signed',
        version: '0.1.8',
        signedIn: false,
      })
    ).toEqual({
      name: 'app_launched',
      surface: 'desktop',
      platform: 'darwin',
      delivery: 'signed',
      appVersion: '0.1.8',
      signedIn: false,
    });
  });

  it('describes a hosted web launch', () => {
    expect(
      readLaunchContext({ isElectron: false, signedIn: true })
    ).toMatchObject({
      surface: 'web',
      platform: 'web',
      delivery: 'hosted',
      appVersion: null,
      signedIn: true,
    });
  });

  it('degrades an unrecognized platform or delivery channel', () => {
    expect(
      readLaunchContext({
        isElectron: true,
        platform: 'plan9',
        delivery: 'nightly',
        version: 'main@f3eb7cc',
        signedIn: false,
      })
    ).toMatchObject({
      platform: 'unknown',
      delivery: 'unknown',
      appVersion: null,
    });
  });
});

describe('account session presence', () => {
  it('reads presence, never the token', () => {
    expect(
      hasAccountSession('sb-numfrucdnnksxbnfftpa-auth-token=base64-payload')
    ).toBe(true);
    expect(
      hasAccountSession('theme=dark; sb-abc123-auth-token.0=chunk; other=1')
    ).toBe(true);
  });

  it('is false without an auth cookie', () => {
    expect(hasAccountSession('theme=dark; exawatt.appearance.v1=x')).toBe(false);
    expect(hasAccountSession('')).toBe(false);
    expect(hasAccountSession(null)).toBe(false);
  });

  it('does not mistake an unrelated cookie for a session', () => {
    expect(hasAccountSession('described-sb-auth-token-note=1')).toBe(false);
  });
});
