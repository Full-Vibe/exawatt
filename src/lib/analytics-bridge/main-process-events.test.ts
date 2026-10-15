import { describe, expect, it, vi } from 'vitest';
import type { AnalyticsEvent } from '@/lib/analytics';
import {
  drainMainProcessAnalyticsEvents,
  normalizeMainProcessAnalyticsEvent,
} from './main-process-events';

describe('normalizeMainProcessAnalyticsEvent', () => {
  it('rebuilds a crash event with the renderer surface', () => {
    expect(
      normalizeMainProcessAnalyticsEvent({
        name: 'app_crashed',
        scope: 'gpu',
        reason: 'out_of_memory',
        appVersion: '0.1.9',
      })
    ).toEqual({
      name: 'app_crashed',
      surface: 'web', // jsdom/node is not Electron; desktop resolves there
      scope: 'gpu',
      reason: 'out_of_memory',
      appVersion: '0.1.9',
    });
  });

  it('maps an HTTP status with the one canonical status mapping', () => {
    const cases: Array<[number, string]> = [
      [401, 'unauthorized'],
      [429, 'rate_limited'],
      [402, 'quota_exhausted'],
      [504, 'timeout'],
      [503, 'server_error'],
      [422, 'invalid_response'],
    ];
    for (const [statusCode, failure] of cases) {
      expect(
        normalizeMainProcessAnalyticsEvent({
          name: 'hosted_call_failed',
          service: 'context_labels',
          failure: null,
          statusCode,
        })
      ).toMatchObject({ failure, statusCode });
    }
  });

  it('trusts a transport failure class only when no status exists', () => {
    expect(
      normalizeMainProcessAnalyticsEvent({
        name: 'hosted_call_failed',
        service: 'conversation_summary',
        failure: 'timeout',
        statusCode: null,
      })
    ).toMatchObject({ failure: 'timeout', statusCode: null });
    // A status always wins over an asserted class.
    expect(
      normalizeMainProcessAnalyticsEvent({
        name: 'hosted_call_failed',
        service: 'conversation_summary',
        failure: 'timeout',
        statusCode: 500,
      })
    ).toMatchObject({ failure: 'server_error', statusCode: 500 });
    // A made-up class degrades to unknown rather than shipping free text.
    expect(
      normalizeMainProcessAnalyticsEvent({
        name: 'hosted_call_failed',
        service: 'goal_visuals',
        failure: 'dns-poisoned-by /Users/operator/project',
        statusCode: null,
      })
    ).toMatchObject({ failure: 'unknown' });
  });

  it('rejects malformed payloads outright', () => {
    for (const raw of [
      null,
      42,
      'app_crashed',
      { name: 'app_launched' }, // never main's to send
      { name: 'sign_in_attempted', method: 'google' },
      { name: 'app_crashed', scope: 'kernel', reason: 'crashed' },
      { name: 'hosted_call_failed', service: 'a-service-we-never-declared' },
    ]) {
      expect(normalizeMainProcessAnalyticsEvent(raw)).toBeNull();
    }
  });

  it('coerces an unknown crash reason instead of dropping the crash', () => {
    expect(
      normalizeMainProcessAnalyticsEvent({
        name: 'app_crashed',
        scope: 'main',
        reason: 'a-reason-from-a-future-electron',
        appVersion: null,
      })
    ).toMatchObject({ reason: 'unknown' });
  });
});

describe('drainMainProcessAnalyticsEvents', () => {
  it('captures each valid event and skips the invalid ones', async () => {
    const capture = vi.fn();
    const bridge = {
      drainMainProcessEvents: vi.fn(async () => [
        {
          name: 'hosted_call_failed',
          service: 'context_labels',
          failure: null,
          statusCode: 503,
        },
        { name: 'not-an-event' },
        {
          name: 'app_crashed',
          scope: 'main',
          reason: 'crashed',
          appVersion: '0.1.9',
        },
      ]),
    };
    await drainMainProcessAnalyticsEvents(bridge, capture);
    expect(capture).toHaveBeenCalledTimes(2);
    expect(capture.mock.calls.map(([event]) => (event as AnalyticsEvent).name))
      .toEqual(['hosted_call_failed', 'app_crashed']);
  });

  it('always drains, even when analytics are off — drain-and-drop', async () => {
    // The default capture path is the real `captureAnalyticsEvent`, which
    // no-ops whenever analytics are disabled or opted out (this test build
    // never enables them). The queue must still be emptied so main's bounded
    // buffer does not sit full for nothing — and nothing may throw.
    const bridge = {
      drainMainProcessEvents: vi.fn(async () => [
        {
          name: 'app_crashed',
          scope: 'renderer',
          reason: 'crashed',
          appVersion: null,
        },
      ]),
    };
    await expect(
      drainMainProcessAnalyticsEvents(bridge)
    ).resolves.toBeUndefined();
    expect(bridge.drainMainProcessEvents).toHaveBeenCalledOnce();
  });

  it('swallows a failing bridge — analytics never break the renderer', async () => {
    const capture = vi.fn();
    await expect(
      drainMainProcessAnalyticsEvents(
        {
          drainMainProcessEvents: vi.fn(async () => {
            throw new Error('window tore down');
          }),
        },
        capture
      )
    ).resolves.toBeUndefined();
    expect(capture).not.toHaveBeenCalled();
  });
});

describe('ENG-047 activity from main', () => {
  it('rebuilds Agent launches and finishes as local Agents', () => {
    expect(
      normalizeMainProcessAnalyticsEvent({
        name: 'agent_launched',
        harness: 'claude',
        permissionMode: 'unrestricted',
        firstForInstall: true,
      })
    ).toMatchObject({
      name: 'agent_launched',
      harness: 'claude',
      placement: 'local',
      permissionMode: 'unrestricted',
      firstForInstall: true,
    });
    expect(
      normalizeMainProcessAnalyticsEvent({ name: 'agent_finished', harness: 'codex' })
    ).toMatchObject({ name: 'agent_finished', harness: 'codex', placement: 'local' });
    expect(
      normalizeMainProcessAnalyticsEvent({ name: 'agent_launched', harness: 'shell' })
    ).toBeNull();
  });

  it('routes the web alias to the alias sender, never to an event', async () => {
    const capture = vi.fn();
    const alias = vi.fn();
    await drainMainProcessAnalyticsEvents(
      {
        drainMainProcessEvents: async () => [
          { name: 'web_alias', webId: '7c9e6679-7425-40de-944b-e07fc1f90ae7' },
        ],
      },
      capture,
      alias
    );
    expect(alias).toHaveBeenCalledWith('7c9e6679-7425-40de-944b-e07fc1f90ae7');
    expect(capture).not.toHaveBeenCalled();
  });
});

