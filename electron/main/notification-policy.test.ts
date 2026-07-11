import { describe, expect, it } from 'vitest';
import {
  nativeNotificationCopy,
  shouldDeliverNativeNotification,
} from './notification-policy';

describe('native notification policy', () => {
  it('is opt-in and background-only', () => {
    const attention = { kind: 'turn-end' as const, since: 1 };
    expect(shouldDeliverNativeNotification(false, false, attention)).toBe(false);
    expect(shouldDeliverNativeNotification(true, true, attention)).toBe(false);
    expect(shouldDeliverNativeNotification(true, false, null)).toBe(false);
    expect(shouldDeliverNativeNotification(true, false, attention)).toBe(true);
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
