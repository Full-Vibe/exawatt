import { beforeEach, describe, expect, it } from 'vitest';
import {
  __resetAnalyticsForTests,
  captureAnalyticsEvent,
  initAnalytics,
  isAnalyticsEmitting,
} from './client';

beforeEach(() => {
  __resetAnalyticsForTests();
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
