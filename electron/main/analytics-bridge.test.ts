import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MAIN_ANALYTICS_QUEUE_CAP,
  __resetMainAnalyticsForTests,
  appCrashFromChildProcessGone,
  appCrashFromMainException,
  appCrashFromRenderProcessGone,
  drainMainAnalyticsEvents,
  queueMainAnalyticsEvent,
  recordHostedCallHttpFailure,
  recordHostedCallTransportFailure,
  setMainAnalyticsNotifier,
  transportFailureFor,
  type MainProcessAnalyticsEvent,
} from './analytics-bridge';

afterEach(() => {
  __resetMainAnalyticsForTests();
});

describe('main-process analytics bridge (ENG-030 OS1.5b)', () => {
  it('queues typed events, notifies, and drains atomically', () => {
    const notify = vi.fn();
    setMainAnalyticsNotifier(notify);
    recordHostedCallHttpFailure('context_labels', 503);
    queueMainAnalyticsEvent({
      name: 'app_crashed',
      scope: 'main',
      reason: 'crashed',
      appVersion: '0.1.9',
    });
    expect(notify).toHaveBeenCalledTimes(2);
    expect(drainMainAnalyticsEvents()).toEqual([
      {
        name: 'hosted_call_failed',
        service: 'context_labels',
        failure: null,
        statusCode: 503,
      },
      {
        name: 'app_crashed',
        scope: 'main',
        reason: 'crashed',
        appVersion: '0.1.9',
      },
    ]);
    expect(drainMainAnalyticsEvents()).toEqual([]);
  });

  it('rejects malformed payloads at the queue boundary', () => {
    const invalid = [
      null,
      'app_crashed',
      { name: 'app_launched' }, // renderer-only event; main may not queue it
      { name: 'app_crashed', scope: 'kernel', reason: 'crashed', appVersion: null },
      { name: 'app_crashed', scope: 'main', reason: 'segfault', appVersion: null },
      { name: 'hosted_call_failed', service: 'update_feed', failure: null, statusCode: null },
      { name: 'hosted_call_failed', service: 'context_labels', failure: 'server_error', statusCode: null },
      { name: 'hosted_call_failed', service: 'context_labels', failure: null, statusCode: '503' },
    ];
    for (const candidate of invalid) {
      queueMainAnalyticsEvent(candidate as unknown as MainProcessAnalyticsEvent);
    }
    expect(drainMainAnalyticsEvents()).toEqual([]);
  });

  it('strips undeclared fields instead of forwarding them across IPC', () => {
    queueMainAnalyticsEvent({
      name: 'hosted_call_failed',
      service: 'goal_visuals',
      failure: null,
      statusCode: 500,
      smuggled: '/Users/operator/secret-project',
    } as unknown as MainProcessAnalyticsEvent);
    expect(drainMainAnalyticsEvents()).toEqual([
      {
        name: 'hosted_call_failed',
        service: 'goal_visuals',
        failure: null,
        statusCode: 500,
      },
    ]);
  });

  it('caps the queue and drops the oldest events', () => {
    for (let index = 0; index < MAIN_ANALYTICS_QUEUE_CAP + 5; index += 1) {
      recordHostedCallHttpFailure('context_labels', 500 + (index % 100));
    }
    const drained = drainMainAnalyticsEvents();
    expect(drained).toHaveLength(MAIN_ANALYTICS_QUEUE_CAP);
    // The five oldest (500–504) fell off; the newest survived.
    expect(drained[0]).toMatchObject({ statusCode: 505 });
    expect(drained.at(-1)).toMatchObject({
      statusCode: 500 + ((MAIN_ANALYTICS_QUEUE_CAP + 4) % 100),
    });
  });

  it('survives a throwing notifier — analytics never break main', () => {
    setMainAnalyticsNotifier(() => {
      throw new Error('window went away');
    });
    expect(() => recordHostedCallHttpFailure('context_labels', 500)).not.toThrow();
    expect(drainMainAnalyticsEvents()).toHaveLength(1);
  });

  it('classifies transport failures: timeout by name, network otherwise', () => {
    expect(
      transportFailureFor(Object.assign(new Error('x'), { name: 'TimeoutError' }))
    ).toBe('timeout');
    expect(
      transportFailureFor(Object.assign(new Error('x'), { name: 'AbortError' }))
    ).toBe('timeout');
    expect(transportFailureFor(new TypeError('fetch failed'))).toBe('network');
    expect(transportFailureFor('offline')).toBe('network');

    recordHostedCallTransportFailure(
      'conversation_summary',
      Object.assign(new Error('x'), { name: 'TimeoutError' })
    );
    expect(drainMainAnalyticsEvents()).toEqual([
      {
        name: 'hosted_call_failed',
        service: 'conversation_summary',
        failure: 'timeout',
        statusCode: null,
      },
    ]);
  });

  it('maps process-gone details onto the closed crash vocabulary', () => {
    expect(appCrashFromRenderProcessGone('clean-exit', '0.1.9')).toBeNull();
    expect(appCrashFromRenderProcessGone('oom', '0.1.9')).toEqual({
      name: 'app_crashed',
      scope: 'renderer',
      reason: 'out_of_memory',
      appVersion: '0.1.9',
    });
    expect(appCrashFromRenderProcessGone('launch-failed', null)).toMatchObject({
      reason: 'launch_failed',
    });
    expect(appCrashFromRenderProcessGone('abnormal-exit', null)).toMatchObject({
      reason: 'unknown',
    });
    expect(appCrashFromChildProcessGone('GPU', 'crashed', '0.1.9')).toEqual({
      name: 'app_crashed',
      scope: 'gpu',
      reason: 'crashed',
      appVersion: '0.1.9',
    });
    expect(appCrashFromChildProcessGone('Utility', 'killed', null)).toMatchObject(
      { scope: 'utility', reason: 'killed' }
    );
    expect(appCrashFromChildProcessGone('GPU', 'clean-exit', null)).toBeNull();
    expect(appCrashFromMainException('0.1.9')).toEqual({
      name: 'app_crashed',
      scope: 'main',
      reason: 'crashed',
      appVersion: '0.1.9',
    });
  });
});
