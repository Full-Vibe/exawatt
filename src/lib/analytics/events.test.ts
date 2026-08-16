import { describe, expect, it } from 'vitest';
import {
  ANALYTICS_ALLOWLIST_VERSION,
  ANALYTICS_EVENT_NAMES,
  ANALYTICS_EVENT_PROPERTIES,
  ANALYTICS_EXCEPTION_PROPERTIES,
  HOSTED_FAILURES,
  hostedFailureForStatus,
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

  it('declares the crash payload as an allowlist, not a denylist', () => {
    expect([...ANALYTICS_EXCEPTION_PROPERTIES]).toEqual([
      '$exception_list',
      '$exception_level',
    ]);
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
      path: '/Users/example/Code/exawatt',
      email: 'developer@example.com',
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
    expect(JSON.stringify(payload)).not.toContain('developer@example.com');
  });

  it('degrades unknown enum members instead of shipping them verbatim', () => {
    const payload = toAnalyticsPayload({
      name: 'hosted_call_failed',
      surface: 'kitchen' as never,
      service: '/Users/example/secret-project' as never,
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
    expect(version('/Users/example/Code/exawatt')).toBeNull();
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

  it('buckets every status the routes actually return', () => {
    // Route evidence, so a future edit has to argue with the code rather than
    // with a taste: a wrong bucket is worse than a coarse one.
    expect(hostedFailureForStatus(401)).toBe('unauthorized');
    expect(hostedFailureForStatus(403)).toBe('unauthorized');
    // `claim_*_quota` refusal in the three hosted routes, sent with
    // `Retry-After: 3600`. A throttle, and the same reading as a Supabase or
    // vendor 429.
    expect(hostedFailureForStatus(429)).toBe('rate_limited');
    // Reserved for the status that says only "allowance spent".
    expect(hostedFailureForStatus(402)).toBe('quota_exhausted');
    expect(hostedFailureForStatus(408)).toBe('timeout');
    expect(hostedFailureForStatus(504)).toBe('timeout');
    expect(hostedFailureForStatus(500)).toBe('server_error');
    expect(hostedFailureForStatus(502)).toBe('server_error');
    expect(hostedFailureForStatus(503)).toBe('server_error');
    expect(hostedFailureForStatus(400)).toBe('invalid_response');
    expect(hostedFailureForStatus(404)).toBe('invalid_response');
    expect(hostedFailureForStatus(413)).toBe('invalid_response');
    expect(hostedFailureForStatus(422)).toBe('invalid_response');
    expect(hostedFailureForStatus(200)).toBe('unknown');
  });

  it('does not call an operator-stats conflict a quota', () => {
    // `src/app/api/operator-stats/route.ts` returns 409 for "Link GitHub
    // before publishing your operator profile" — a precondition on account
    // state. Counting it as `quota_exhausted` made a capacity dashboard lie.
    expect(hostedFailureForStatus(409)).not.toBe('quota_exhausted');
    expect(hostedFailureForStatus(409)).toBe('invalid_response');
  });

  it('emits every failure it maps to as a declared enum member', () => {
    const statuses = [
      200, 400, 401, 402, 403, 404, 408, 409, 413, 422, 429, 500, 502, 503, 504,
    ];
    for (const status of statuses) {
      expect(HOSTED_FAILURES).toContain(hostedFailureForStatus(status));
    }
  });

  it('refuses an event name that is not on the allowlist', () => {
    expect(isAnalyticsEventName('session_transcript')).toBe(false);
    expect(
      toAnalyticsPayload({ name: 'session_transcript' } as unknown as AnalyticsEvent)
    ).toBeNull();
  });
});
