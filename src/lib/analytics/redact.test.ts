import { describe, expect, it } from 'vitest';
import type { CaptureResult } from 'posthog-js';
import { ANALYTICS_EXCEPTION_PROPERTIES } from './events';
import {
  ANALYTICS_PROPERTY_DENYLIST,
  redactFrameLocation,
  scrubAnalyticsCapture,
} from './redact';

function capture(
  event: string,
  properties: Record<string, unknown>
): CaptureResult {
  return { uuid: 'uuid-1', event, properties } as CaptureResult;
}

describe('capture scrubbing', () => {
  it('drops any event that is not on the allowlist', () => {
    expect(scrubAnalyticsCapture(capture('$autocapture', {}))).toBeNull();
    expect(scrubAnalyticsCapture(capture('$pageview', {}))).toBeNull();
    expect(scrubAnalyticsCapture(capture('$identify', {}))).toBeNull();
    expect(scrubAnalyticsCapture(capture('session_started', {}))).toBeNull();
    expect(scrubAnalyticsCapture(null)).toBeNull();
  });

  it('keeps an allowlisted event and its declared properties', () => {
    const result = scrubAnalyticsCapture(
      capture('app_launched', {
        allowlist_version: 1,
        surface: 'desktop',
        platform: 'darwin',
        delivery: 'signed',
        app_version: '0.1.8',
        signed_in: false,
        distinct_id: 'installation-uuid',
        token: 'phc_test',
        $lib: 'web',
      })
    );
    expect(result?.properties).toEqual({
      allowlist_version: 1,
      surface: 'desktop',
      platform: 'darwin',
      delivery: 'signed',
      app_version: '0.1.8',
      signed_in: false,
      distinct_id: 'installation-uuid',
      token: 'phc_test',
      $lib: 'web',
    });
  });

  it('strips the loopback URL properties that carry Session identifiers', () => {
    const result = scrubAnalyticsCapture(
      capture('app_launched', {
        surface: 'desktop',
        $current_url: 'http://127.0.0.1:54321/workspace/session/abc-123',
        $pathname: '/workspace/session/abc-123',
        $referrer: 'http://127.0.0.1:54321/projects/exawatt',
        $title: 'exawatt — refactor the auth coordinator',
      })
    );
    expect(result?.properties).toEqual({ surface: 'desktop' });
    expect(JSON.stringify(result)).not.toContain('abc-123');
  });

  it('drops undeclared non-SDK properties even on an allowlisted event', () => {
    const result = scrubAnalyticsCapture(
      capture('hosted_call_failed', {
        service: 'context_labels',
        project_name: 'exawatt',
        prompt: 'summarize this terminal buffer',
      })
    );
    expect(result?.properties).toEqual({ service: 'context_labels' });
  });

  it('never lets person properties build an account profile', () => {
    const result = scrubAnalyticsCapture({
      ...capture('sign_in_attempted', { method: 'google' }),
      $set: { email: 'developer@example.com' },
      $set_once: { user_id: 'account-uuid' },
    });
    expect(result?.$set).toBeUndefined();
    expect(result?.$set_once).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain('developer@example.com');
  });

  it('keeps the crash signal but removes the exception message', () => {
    const result = scrubAnalyticsCapture(
      capture('$exception', {
        $exception_message: 'summarize failed for /Users/example/Code/exawatt',
        $exception_list: [
          {
            type: 'TypeError',
            value: 'Cannot read prompt "refactor the auth coordinator"',
            mechanism: { handled: false },
            stacktrace: {
              type: 'raw',
              frames: [
                {
                  function: 'drainLabel',
                  filename:
                    'http://127.0.0.1:54321/_next/static/chunks/app-page.js',
                  lineno: 12,
                  colno: 34,
                  in_app: true,
                },
              ],
            },
          },
        ],
      })
    );

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('refactor the auth coordinator');
    expect(serialized).not.toContain('/Users/example');
    expect(serialized).not.toContain('127.0.0.1');
    expect(result?.properties.$exception_message).toBeUndefined();

    const exception = (result?.properties.$exception_list as unknown[])[0] as {
      type: string;
      value: string;
      stacktrace: { frames: { function: string; filename: string }[] };
    };
    expect(exception.type).toBe('TypeError');
    expect(exception.value).toBe('<redacted>');
    expect(exception.stacktrace.frames[0]).toMatchObject({
      function: 'drainLabel',
      filename: '/_next/static/chunks/app-page.js',
      lineno: 12,
    });
  });

  it('keeps the declared crash payload properties', () => {
    const result = scrubAnalyticsCapture(
      capture('$exception', {
        $exception_list: [{ type: 'RangeError', value: 'oops' }],
        $exception_level: 'fatal',
        // Ordinary SDK metadata rides along on a crash like any other event.
        $lib: 'web',
        $os: 'Mac OS X',
        distinct_id: 'installation-uuid',
        token: 'phc_test',
      })
    );
    expect(Object.keys(result!.properties).sort()).toEqual([
      '$exception_level',
      '$exception_list',
      '$lib',
      '$os',
      'distinct_id',
      'token',
    ]);
    expect(result?.properties.$exception_level).toBe('fatal');
  });

  it('drops a crash payload property nobody declared', () => {
    // Defence in depth: no installed posthog-js version emits these on this
    // path, but a future one adding a content-bearing `$exception_*` property
    // must not ship by default.
    const result = scrubAnalyticsCapture(
      capture('$exception', {
        $exception_list: [],
        // Free-text breadcrumbs, gated behind a config this client never sets.
        $exception_steps: [
          { message: 'ran claude -p on /Users/example/Code/exawatt' },
        ],
        // Invented by a hypothetical future SDK release.
        $exception_source_context: 'const prompt = "refactor the coordinator"',
        // The Sentry integration's raw, unredacted exception object.
        $sentry_exception_message: 'summarize failed for /Users/example',
        // A caller's own extra property.
        project_name: 'exawatt',
      })
    );

    expect(Object.keys(result!.properties)).toEqual(['$exception_list']);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('/Users/example');
    expect(serialized).not.toContain('refactor the coordinator');
    expect(serialized).not.toContain('exawatt');
  });

  it('coerces an exception level that is not a severity', () => {
    const level = (value: unknown) =>
      scrubAnalyticsCapture(capture('$exception', { $exception_level: value }))
        ?.properties.$exception_level;

    expect(level('warning')).toBe('warning');
    expect(level('/Users/example/Code/exawatt')).toBe('error');
    expect(level(undefined)).toBe('error');
  });

  it('rebuilds the mechanism instead of forwarding it', () => {
    const result = scrubAnalyticsCapture(
      capture('$exception', {
        $exception_list: [
          {
            type: 'TypeError',
            value: 'nope',
            mechanism: {
              type: 'onunhandledrejection',
              handled: false,
              synthetic: true,
              // `Mechanism.source` is a free-form string in the SDK's types.
              source: '/Users/example/Code/exawatt/session.ts',
            },
          },
        ],
      })
    );

    const exception = (result?.properties.$exception_list as unknown[])[0];
    expect(exception).toMatchObject({
      mechanism: {
        type: 'onunhandledrejection',
        handled: false,
        synthetic: true,
      },
    });
    expect(JSON.stringify(result)).not.toContain('/Users/example');
  });

  it('never lets a crash payload ride an ordinary event', () => {
    const result = scrubAnalyticsCapture(
      capture('app_crashed', {
        scope: 'renderer',
        $exception_list: [{ type: 'Error', value: 'the prompt text' }],
        $exception_steps: ['a breadcrumb'],
      })
    );
    expect(result?.properties).toEqual({ scope: 'renderer' });
  });

  it('reduces frame locations to a path that identifies no machine', () => {
    expect(
      redactFrameLocation('https://www.exawatt.ai/_next/static/chunks/main.js')
    ).toBe('/_next/static/chunks/main.js');
    expect(
      redactFrameLocation('file:///Users/example/Code/exawatt/preload.js')
    ).toBe('<file>');
    expect(redactFrameLocation('/Users/example/Code/exawatt/preload.js')).toBe(
      '<local>'
    );
    expect(redactFrameLocation(undefined)).toBeNull();
  });

  it('publishes the denylist it enforces', () => {
    expect(ANALYTICS_PROPERTY_DENYLIST).toContain('$current_url');
    expect(ANALYTICS_PROPERTY_DENYLIST).toContain('$title');
    expect(ANALYTICS_PROPERTY_DENYLIST).toContain('$exception_message');
    expect(ANALYTICS_PROPERTY_DENYLIST).toContain('$exception_steps');
  });

  it('enforces exactly the crash payload allowlist it publishes', () => {
    // Every declared property offered at once, so the assertion fails if the
    // allowlist grows without `redact.ts` learning how to redact the addition.
    const offered = Object.fromEntries(
      ANALYTICS_EXCEPTION_PROPERTIES.map((key) => [key, []])
    );
    const result = scrubAnalyticsCapture(capture('$exception', offered));
    expect(Object.keys(result!.properties).sort()).toEqual(
      [...ANALYTICS_EXCEPTION_PROPERTIES].sort()
    );
  });
});
