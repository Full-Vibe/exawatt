import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LOGIN_ENVIRONMENT_KEYS } from './harness-state-variables';
import { makeHermetic } from './hermetic-environment.test-support';

/** BUG-298: no app-node test reads a variable the product resolves from the
 *  operator's login shell. */
describe('the hermetic test environment', () => {
  it('clears every variable the login-environment resolver reads', () => {
    const operator = Object.fromEntries(
      LOGIN_ENVIRONMENT_KEYS.map(key => [key, `/operator/${key}`])
    );
    makeHermetic(operator, '/private/home');

    expect(operator).toEqual({ HOME: '/private/home' });
  });

  it('clears the bus and Session variables of the Session it runs in', () => {
    const session: NodeJS.ProcessEnv = {
      EXAWATT_BUS_PORT: '53026',
      EXAWATT_BUS_TOKEN: 'token',
      EXAWATT_SESSION_ID: 'session',
      PATH: '/usr/bin',
    };
    makeHermetic(session, '/private/home');

    expect(session).toEqual({ HOME: '/private/home', PATH: '/usr/bin' });
  });

  it('is in force for this test file', () => {
    for (const key of LOGIN_ENVIRONMENT_KEYS) {
      if (key === 'HOME') continue;
      expect(process.env[key], key).toBeUndefined();
    }
    expect(
      Object.keys(process.env).filter(key =>
        /^EXAWATT_(?:BUS|SESSION)_/u.test(key)
      )
    ).toEqual([]);
    expect(
      process.env.HOME?.startsWith(join(tmpdir(), 'exawatt-test-homes'))
    ).toBe(true);
  });
});
