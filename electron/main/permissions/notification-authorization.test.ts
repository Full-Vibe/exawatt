import { describe, expect, it } from 'vitest';
import {
  NOTIFICATION_AUTHORIZATION_BINARY,
  loadNotificationAuthorization,
} from './notification-authorization';

const addon = {
  read: async () => 'granted',
  request: async () => 'granted',
};

describe('loading the native read', () => {
  it('loads the compiled addon beside the compiled main', () => {
    let loaded = '';
    const result = loadNotificationAuthorization('darwin', file => {
      loaded = file;
      return addon;
    });
    expect(result).not.toBeNull();
    expect(loaded).toBe(NOTIFICATION_AUTHORIZATION_BINARY);
    expect(loaded).toMatch(/native[\\/]notification-authorization\.node$/);
  });

  it('is absent off macOS without trying to load anything', () => {
    const result = loadNotificationAuthorization('linux', () => {
      throw new Error('must not load');
    });
    expect(result).toBeNull();
  });

  it('is absent, not an error, when the library will not load', () => {
    expect(
      loadNotificationAuthorization('darwin', () => {
        throw new Error('code signature invalid');
      })
    ).toBeNull();
  });

  it('is absent when the library lacks its two calls', () => {
    expect(
      loadNotificationAuthorization('darwin', () => ({ read: async () => 'x' }))
    ).toBeNull();
  });
});
