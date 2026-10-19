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

  it('is in force for this test file', () => {
    for (const key of LOGIN_ENVIRONMENT_KEYS) {
      if (key === 'HOME') continue;
      expect(process.env[key], key).toBeUndefined();
    }
    expect(
      process.env.HOME?.startsWith(join(tmpdir(), 'exawatt-test-homes'))
    ).toBe(true);
  });
});
