import { beforeEach, describe, expect, it } from 'vitest';
import {
  ANALYTICS_INSTALLATION_ID_STORAGE_KEY,
  ANALYTICS_OPT_OUT_STORAGE_KEY,
  __resetAnalyticsForTests,
  captureAnalyticsEvent,
  initAnalytics,
  isAnalyticsEmitting,
  readAnalyticsOptOut,
  readInstallationId,
  writeAnalyticsOptOut,
} from './client';

function fakeStorage(seed: Record<string, string> = {}) {
  const store = new Map(Object.entries(seed));
  return {
    store,
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  };
}

function blockedStorage() {
  return {
    getItem: () => {
      throw new Error('storage is blocked');
    },
    setItem: () => {
      throw new Error('storage is blocked');
    },
    removeItem: () => {
      throw new Error('storage is blocked');
    },
  };
}

beforeEach(() => {
  __resetAnalyticsForTests();
});

describe('runtime opt-out', () => {
  it('round-trips and defaults to opted in', () => {
    const storage = fakeStorage();
    expect(readAnalyticsOptOut(storage)).toBe(false);
    writeAnalyticsOptOut(true, storage);
    expect(storage.store.get(ANALYTICS_OPT_OUT_STORAGE_KEY)).toBe('true');
    expect(readAnalyticsOptOut(storage)).toBe(true);
    writeAnalyticsOptOut(false, storage);
    expect(readAnalyticsOptOut(storage)).toBe(false);
  });

  it('survives storage that throws', () => {
    expect(readAnalyticsOptOut(blockedStorage())).toBe(false);
    expect(() => writeAnalyticsOptOut(true, blockedStorage())).not.toThrow();
  });
});

describe('anonymous installation identity', () => {
  it('generates once and reuses it', () => {
    const storage = fakeStorage();
    const first = readInstallationId(storage, () => 'installation-uuid');
    expect(first).toBe('installation-uuid');
    expect(storage.store.get(ANALYTICS_INSTALLATION_ID_STORAGE_KEY)).toBe(
      'installation-uuid'
    );
    expect(readInstallationId(storage, () => 'a-different-uuid')).toBe(
      'installation-uuid'
    );
  });

  it('is never derived from an account', () => {
    const storage = fakeStorage();
    const id = readInstallationId(storage, () => crypto.randomUUID());
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
  });

  it('returns null rather than throwing when storage is blocked', () => {
    expect(readInstallationId(blockedStorage(), () => 'x')).toBeNull();
  });
});

describe('emission gate', () => {
  it('never initializes without distribution configuration', async () => {
    await expect(initAnalytics()).resolves.toEqual({
      enabled: false,
      reason: 'no_distribution_config',
    });
    expect(isAnalyticsEmitting()).toBe(false);
  });

  it('ignores poisoned legacy analytics variables', async () => {
    const previous = {
      key: process.env.NEXT_PUBLIC_POSTHOG_KEY,
      host: process.env.NEXT_PUBLIC_POSTHOG_HOST,
      disabled: process.env.NEXT_PUBLIC_ANALYTICS_DISABLED,
    };
    process.env.NEXT_PUBLIC_POSTHOG_KEY = 'poisoned-production-key';
    process.env.NEXT_PUBLIC_POSTHOG_HOST = 'https://www.exawatt.ai/ingest';
    process.env.NEXT_PUBLIC_ANALYTICS_DISABLED = 'false';
    try {
      await expect(initAnalytics()).resolves.toEqual({
        enabled: false,
        reason: 'no_distribution_config',
      });
      expect(isAnalyticsEmitting()).toBe(false);
    } finally {
      for (const [key, value] of Object.entries({
        NEXT_PUBLIC_POSTHOG_KEY: previous.key,
        NEXT_PUBLIC_POSTHOG_HOST: previous.host,
        NEXT_PUBLIC_ANALYTICS_DISABLED: previous.disabled,
      })) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  it('drops events rather than queueing them while disabled', async () => {
    await initAnalytics();
    expect(() =>
      captureAnalyticsEvent({
        name: 'sign_in_attempted',
        surface: 'web',
        method: 'google',
        outcome: 'started',
      })
    ).not.toThrow();
    expect(isAnalyticsEmitting()).toBe(false);
  });
});
