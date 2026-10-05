import { describe, expect, it } from 'vitest';
import { projectSessionAttention } from '@exawatt/core';
import type { PtyAttentionRecord } from '@exawatt/core/desktop-bridge';
import {
  nativeNotificationCopy,
  isCurrentAttentionAlert,
  shouldDeliverNativeNotification,
} from './notification-policy';

describe('native notification policy', () => {
  it('is opt-in and background-only', () => {
    const attention = { kind: 'turn-end' as const, since: 1 };
    expect(shouldDeliverNativeNotification(false, false, attention)).toBe(
      false
    );
    expect(shouldDeliverNativeNotification(true, true, attention)).toBe(false);
    expect(shouldDeliverNativeNotification(true, false, null)).toBe(false);
    expect(shouldDeliverNativeNotification(true, false, attention)).toBe(true);
  });

  it('drops inspected, resolved or replaced source facts without confusing siblings', () => {
    const alert: PtyAttentionRecord = {
      source: 'harness',
      kind: 'blocked',
      requestId: 'q1',
      request: 'working',
      since: 1,
      unread: true,
    };
    const snapshot = (...records: PtyAttentionRecord[]) =>
      projectSessionAttention(records);
    expect(isCurrentAttentionAlert(snapshot(alert), alert)).toBe(true);
    expect(
      isCurrentAttentionAlert(snapshot({ ...alert, unread: false }), alert)
    ).toBe(false);
    expect(isCurrentAttentionAlert(null, alert)).toBe(false);
    expect(
      isCurrentAttentionAlert(snapshot({ ...alert, source: 'roadmap' }), alert)
    ).toBe(false);
    expect(
      isCurrentAttentionAlert(snapshot({ ...alert, since: 2 }), alert)
    ).toBe(false);
    const result: PtyAttentionRecord = {
      source: 'harness',
      kind: 'turn-end',
      since: 3,
      unread: true,
    };
    expect(
      isCurrentAttentionAlert(
        snapshot({ ...alert, unread: false }, result),
        result
      )
    ).toBe(true);
    expect(
      isCurrentAttentionAlert(
        snapshot({ ...alert, unread: false }, result),
        alert
      )
    ).toBe(false);
    expect(
      shouldDeliverNativeNotification(
        true,
        false,
        snapshot({ ...alert, unread: false })
      )
    ).toBe(false);
  });

  it('names the exact harness and project', () => {
    const copy = nativeNotificationCopy({
      id: 'pty-1',
      harness: 'codex',
      title: 'Review auth',
      cwd: '/tmp/project',
      projectDir: '/tmp/project',
      projectName: 'project',
      cols: 80,
      rows: 24,
      startedAt: 1,
      exited: false,
      exitCode: null,
      lastDataAt: 1,
      harnessSessionId: 'session-1',
    });
    expect(copy).toEqual({
      title: 'Review auth',
      body: 'Codex needs your attention in project.',
    });
  });
});
