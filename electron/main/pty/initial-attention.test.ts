import { EventEmitter } from 'events';
import { describe, expect, it } from 'vitest';
import { AttentionMonitor } from './attention-monitor';
import { withInitialSessionAttention } from './initial-attention';
import type { PtySessionManager } from './session-manager';

describe('initial exact-Session attention custody', () => {
  it('seeds before a synchronous source observation and suppresses only the same read request', async () => {
    const manager = Object.assign(new EventEmitter(), {
      list: () => [
        {
          id: 'new-process',
          durableSessionId: 'durable',
          harness: 'codex',
          harnessSessionId: 'provider',
          exited: false,
        },
      ],
    });
    const monitor = new AttentionMonitor();
    monitor.attach(manager as unknown as PtySessionManager);
    const alerts: string[] = [];
    monitor.on('alert', (_id, signal) => alerts.push(signal.requestId!));
    manager.on('created', () =>
      monitor.noteHarnessBlocked('new-process', 'working', 'question-1')
    );
    await withInitialSessionAttention(
      manager,
      monitor,
      {
        durableSessionId: 'durable',
        resumeSessionId: 'provider',
        restoredAttention: {
          kind: 'blocked',
          request: 'working',
          requestId: 'question-1',
          unread: false,
          since: 10,
        },
      },
      async () => {
        manager.emit('created', manager.list()[0]);
      }
    );
    expect(monitor.get('new-process')?.unread).toBe(false);
    expect(alerts).toEqual([]);
    monitor.noteHarnessBlocked('new-process', 'working', 'question-2');
    expect(alerts).toEqual(['question-2']);
    expect(manager.listenerCount('created')).toBe(1);
  });

  it('does not seed another Session or another conversation and cleans failed operations', async () => {
    const manager = new EventEmitter();
    const restored: string[] = [];
    await expect(
      withInitialSessionAttention(
        manager,
        { restore: id => restored.push(id) },
        {
          durableSessionId: 'durable',
          resumeSessionId: 'provider',
          restoredAttention: { kind: 'blocked', since: 10 },
        },
        async () => {
          manager.emit('created', {
            id: 'other',
            durableSessionId: 'another',
            harnessSessionId: 'provider',
          });
          manager.emit('created', {
            id: 'other-conversation',
            durableSessionId: 'durable',
            harnessSessionId: 'new-provider',
          });
          throw new Error('create failed');
        }
      )
    ).rejects.toThrow('create failed');
    expect(restored).toEqual([]);
    expect(manager.listenerCount('created')).toBe(0);
  });
});
