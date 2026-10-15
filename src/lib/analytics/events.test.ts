import { describe, expect, it } from 'vitest';
import {
  ACCOUNT_ONLY_EVENTS,
  ACCOUNT_STREAM_EVENTS,
  ANALYTICS_ALLOWLIST_VERSION,
  ANALYTICS_EVENT_NAMES,
  ANALYTICS_EVENT_PROPERTIES,
  ANALYTICS_EXCEPTION_PROPERTIES,
  HOSTED_FAILURES,
  hostedFailureForStatus,
  isAnalyticsEventName,
  sanitizeAnalyticsPath,
  sanitizeReferrerHost,
  toAnalyticsPayload,
  type AnalyticsEvent,
} from './events';
import { EVERY_ANALYTICS_EVENT } from './examples.test-support';

describe('analytics event allowlist', () => {
  it('authorizes exactly the events decisions 0031 and 0053 name', () => {
    expect([...ANALYTICS_EVENT_NAMES]).toEqual([
      'app_launched',
      'sign_in_attempted',
      'hosted_call_failed',
      'app_crashed',
      'page_viewed',
      'download_requested',
      'project_opened',
      'agent_launched',
      'agent_directed',
      'agent_finished',
    ]);
  });

  it('keeps the account stream to activity, and website events off it', () => {
    for (const name of ACCOUNT_STREAM_EVENTS) {
      expect(isAnalyticsEventName(name)).toBe(true);
    }
    for (const name of ACCOUNT_ONLY_EVENTS) {
      expect(ACCOUNT_STREAM_EVENTS).toContain(name);
    }
    expect(ACCOUNT_STREAM_EVENTS).not.toContain('page_viewed');
    expect(ACCOUNT_STREAM_EVENTS).not.toContain('download_requested');
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
    for (const event of EVERY_ANALYTICS_EVENT) {
      const payload = toAnalyticsPayload(event);
      expect(payload, event.name).not.toBeNull();
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

describe('page_viewed carries a path and a hostname, nothing else', () => {
  const view = (url: string, referrer: string | null = null) =>
    toAnalyticsPayload({ name: 'page_viewed', surface: 'web', url, referrer })
      ?.properties;

  it('yields the same event with or without a query, UTM, click id or fragment', () => {
    const plain = view('https://www.exawatt.ai/download');
    for (const url of [
      'https://www.exawatt.ai/download?c=FRIEND-CODE',
      'https://www.exawatt.ai/download?utm_source=hn&utm_medium=social&utm_campaign=launch',
      'https://www.exawatt.ai/download?gclid=abc&fbclid=def&msclkid=ghi',
      'https://www.exawatt.ai/download/#fragment',
      '/download?ttclid=1',
    ]) {
      expect(view(url)).toEqual(plain);
    }
    expect(plain).toEqual({
      allowlist_version: ANALYTICS_ALLOWLIST_VERSION,
      surface: 'web',
      path: '/download',
      referrer_host: null,
    });
  });

  it('keeps only the referring hostname', () => {
    expect(
      view(
        'https://www.exawatt.ai/',
        'https://news.ycombinator.com/item?id=4242&utm_source=x'
      )?.referrer_host
    ).toBe('news.ycombinator.com');
    expect(sanitizeReferrerHost('android-app://com.slack/')).toBeNull();
    expect(sanitizeReferrerHost('not a url at all')).toBeNull();
  });

  it('masks identifier segments so a page is a page, not a record', () => {
    expect(
      sanitizeAnalyticsPath(
        '/workspace/session/0b8e4f5e-3c1d-4a2b-9f6e-7d8c9b0a1e2f'
      )
    ).toBe('/workspace/session/:id');
    expect(sanitizeAnalyticsPath('/run/123456')).toBe('/run/:id');
    expect(sanitizeAnalyticsPath('/u/jake')).toBe('/u/jake');
    expect(sanitizeAnalyticsPath('')).toBeNull();
    expect(
      toAnalyticsPayload({ name: 'page_viewed', surface: 'web', url: '' })
    ).toBeNull();
  });
});

describe('the activation events', () => {
  it('refuses a Project opened from a source decision 0053 does not name', () => {
    expect(
      toAnalyticsPayload({
        name: 'project_opened',
        surface: 'desktop',
        source: '/Users/example/Code/secret' as never,
        bound: 'folder',
      })
    ).toBeNull();
  });

  it('keeps harness hints and harnesses to catalog ids', () => {
    expect(
      toAnalyticsPayload({
        name: 'project_opened',
        surface: 'desktop',
        source: 'browse',
        harnessHint: 'claude-opus-5-secret-model' as never,
        bound: 'folderless',
      })?.properties.harness_hint
    ).toBeNull();
    expect(
      toAnalyticsPayload({
        name: 'agent_launched',
        surface: 'desktop',
        harness: 'my-private-harness' as never,
        placement: 'local',
        firstForInstall: false,
      })?.properties
    ).toMatchObject({ harness: 'unknown', permission_mode: null });
  });

  it('bounds Direct counts, and never reports more delivered than sent', () => {
    expect(
      toAnalyticsPayload({
        name: 'agent_directed',
        surface: 'desktop',
        recipients: 2,
        delivered: 5,
      })?.properties
    ).toMatchObject({ recipients: 2, delivered: 2 });
    expect(
      toAnalyticsPayload({
        name: 'agent_directed',
        surface: 'desktop',
        recipients: -1,
        delivered: 1.5,
      })?.properties
    ).toMatchObject({ recipients: 0, delivered: 0 });
  });
});
