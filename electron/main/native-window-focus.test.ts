import { EventEmitter } from 'events';
import { describe, expect, it, vi } from 'vitest';
import { observeNativeWindowFocus } from './native-window-focus';
import { AttentionMonitor } from './pty/attention-monitor';
import type { PtySessionManager } from './pty/session-manager';

function monitorWithSession() {
  const monitor = new AttentionMonitor();
  const manager = Object.assign(new EventEmitter(), {
    list: () => [{ id: 'a', harness: 'codex', exited: false, startedAt: 0 }],
  });
  monitor.attach(manager as unknown as PtySessionManager);
  return monitor;
}

describe('native window focus subscription', () => {
  it('acknowledges an already foreground Session and protects later background requests', () => {
    const events = new EventEmitter();
    const monitor = monitorWithSession();
    const contextFocus = vi.fn();
    monitor.noteHarnessBlocked('a', 'working', 'q1');
    monitor.setFocus('a');
    // Native focus happened before the command surface finished bootstrapping.
    events.emit('browser-window-focus');
    const stop = observeNativeWindowFocus(
      events,
      () => true,
      focused => {
        monitor.setWindowFocused(focused);
        contextFocus(focused);
      }
    );
    expect(monitor.get('a')).toMatchObject({ kind: 'blocked', unread: false });
    events.emit('browser-window-blur');
    monitor.noteHarnessBlocked('a', 'working', 'q2');
    expect(monitor.get('a')?.unread).toBe(true);
    events.emit('browser-window-focus');
    expect(monitor.get('a')).toMatchObject({ kind: 'blocked', unread: false });
    expect(contextFocus.mock.calls).toEqual([[true], [false], [true]]);
    stop();
    expect(events.listenerCount('browser-window-focus')).toBe(0);
    expect(events.listenerCount('browser-window-blur')).toBe(0);
  });

  it('subscribes before reading the native snapshot and does not acknowledge a background launch', () => {
    const events = new EventEmitter();
    const monitor = monitorWithSession();
    monitor.noteHarnessBlocked('a', 'working', 'q1');
    monitor.setFocus('a');
    observeNativeWindowFocus(
      events,
      () => {
        expect(events.listenerCount('browser-window-focus')).toBe(1);
        expect(events.listenerCount('browser-window-blur')).toBe(1);
        return false;
      },
      focused => monitor.setWindowFocused(focused)
    );
    expect(monitor.get('a')?.unread).toBe(true);
  });
});
