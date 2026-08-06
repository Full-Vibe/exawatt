import { describe, expect, it } from 'vitest';
import {
  ANALYTICS_ALLOWLIST_VERSION,
  ANALYTICS_EVENT_NAMES,
  ANALYTICS_EVENT_PROPERTIES,
  isAnalyticsEventName,
  toAnalyticsPayload,
  type AnalyticsEvent,
} from './events';

describe('analytics event allowlist', () => {
  it('authorizes exactly the four events decisions 0031/0034 name', () => {
    expect([...ANALYTICS_EVENT_NAMES]).toEqual([
      'app_launched',
      'sign_in_attempted',
      'hosted_call_failed',
      'app_crashed',
    ]);
  });

  it('declares a property set for every event and no others', () => {
    expect(Object.keys(ANALYTICS_EVENT_PROPERTIES).sort()).toEqual(
      [...ANALYTICS_EVENT_NAMES].sort()
    );
  });

  it('emits only declared properties', () => {
    const events: AnalyticsEvent[] = [
      {
        name: 'app_launched',
        surface: 'desktop',
        platform: 'darwin',
        delivery: 'signed',
        appVersion: '0.1.8',
        signedIn: true,
      },
      {
        name: 'sign_in_attempted',
        surface: 'desktop',
        method: 'google',
        outcome: 'failed',
        failure: 'cancelled',
      },
      {
        name: 'hosted_call_failed',
        surface: 'web',
        service: 'goal_visuals',
        failure: 'rate_limited',
        statusCode: 429,
      },
      {
        name: 'app_crashed',
        surface: 'desktop',
        scope: 'renderer',
        reason: 'out_of_memory',
        appVersion: '0.1.8',
      },
    ];

    for (const event of events) {
      const payload = toAnalyticsPayload(event);
      expect(payload).not.toBeNull();
      expect(Object.keys(payload!.properties).sort()).toEqual(
        [...ANALYTICS_EVENT_PROPERTIES[event.name]].sort()
      );
      expect(payload!.properties.allowlist_version).toBe(
        ANALYTICS_ALLOWLIST_VERSION
      );
    }
  });

  it('builds the launch payload a released desktop build sends', () => {
    expect(
      toAnalyticsPayload({
        name: 'app_launched',
        surface: 'desktop',
        platform: 'darwin',
        delivery: 'signed',
        appVersion: '0.1.8',
        signedIn: false,
      })
    ).toEqual({
      name: 'app_launched',
      properties: {
        allowlist_version: 1,
        surface: 'desktop',
        platform: 'darwin',
        delivery: 'signed',
        app_version: '0.1.8',
        signed_in: false,
      },
    });
  });

  it('never lets content through a property a JS caller forged', () => {
    const forged = {
      name: 'sign_in_attempted',
      surface: 'desktop',
      method: 'google',
      outcome: 'succeeded',
      // Everything below is what decision 0031 excludes.
      projectName: 'exawatt',
      prompt: 'refactor the auth coordinator',
      path: '/Users/jake/Code/exawatt',
      email: 'jake@example.com',
    } as unknown as AnalyticsEvent;

    const payload = toAnalyticsPayload(forged);
    expect(Object.keys(payload!.properties).sort()).toEqual([
      'allowlist_version',
      'failure',
      'method',
      'outcome',
      'surface',
    ]);
    expect(JSON.stringify(payload)).not.toContain('exawatt.ai/Users');
    expect(JSON.stringify(payload)).not.toContain('refactor');
    expect(JSON.stringify(payload)).not.toContain('jake@example.com');
  });

  it('degrades unknown enum members instead of shipping them verbatim', () => {
    const payload = toAnalyticsPayload({
      name: 'hosted_call_failed',
      surface: 'kitchen' as never,
      service: '/Users/jake/secret-project' as never,
      failure: 'exploded' as never,
      statusCode: 42,
    });
    expect(payload!.properties).toEqual({
      allowlist_version: 1,
      surface: 'web',
      service: 'unknown',
      failure: 'unknown',
      status_code: null,
    });
  });

  it('accepts only version-shaped app versions', () => {
    const version = (value: unknown) =>
      toAnalyticsPayload({
        name: 'app_crashed',
        surface: 'desktop',
        scope: 'main',
        reason: 'crashed',
        appVersion: value as string,
      })!.properties.app_version;

    expect(version('0.1.8')).toBe('0.1.8');
    expect(version('1.2.3-beta.1')).toBe('1.2.3-beta.1');
    expect(version('/Users/jake/Code/exawatt')).toBeNull();
    expect(version(undefined)).toBeNull();
  });

  it('bounds status codes to real HTTP statuses', () => {
    const status = (value: unknown) =>
      toAnalyticsPayload({
        name: 'hosted_call_failed',
        surface: 'web',
        service: 'context_labels',
        failure: 'server_error',
        statusCode: value as number,
      })!.properties.status_code;

    expect(status(503)).toBe(503);
    expect(status(99)).toBeNull();
    expect(status(600)).toBeNull();
    expect(status('503')).toBeNull();
  });

  it('refuses an event name that is not on the allowlist', () => {
    expect(isAnalyticsEventName('session_transcript')).toBe(false);
    expect(
      toAnalyticsPayload({ name: 'session_transcript' } as unknown as AnalyticsEvent)
    ).toBeNull();
  });
});
