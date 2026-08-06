import { describe, expect, it } from 'vitest';
import type { CaptureResult } from 'posthog-js';
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
      $set: { email: 'jake@example.com' },
      $set_once: { user_id: 'account-uuid' },
    });
    expect(result?.$set).toBeUndefined();
    expect(result?.$set_once).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain('jake@example.com');
  });

  it('keeps the crash signal but removes the exception message', () => {
    const result = scrubAnalyticsCapture(
      capture('$exception', {
        $exception_message: 'summarize failed for /Users/jake/Code/exawatt',
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
    expect(serialized).not.toContain('/Users/jake');
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

  it('reduces frame locations to a path that identifies no machine', () => {
    expect(
      redactFrameLocation('https://www.exawatt.ai/_next/static/chunks/main.js')
    ).toBe('/_next/static/chunks/main.js');
    expect(redactFrameLocation('file:///Users/jake/Code/exawatt/preload.js')).toBe(
      '<file>'
    );
    expect(redactFrameLocation('/Users/jake/Code/exawatt/preload.js')).toBe(
      '<local>'
    );
    expect(redactFrameLocation(undefined)).toBeNull();
  });

  it('publishes the denylist it enforces', () => {
    expect(ANALYTICS_PROPERTY_DENYLIST).toContain('$current_url');
    expect(ANALYTICS_PROPERTY_DENYLIST).toContain('$title');
    expect(ANALYTICS_PROPERTY_DENYLIST).toContain('$exception_message');
  });
});
