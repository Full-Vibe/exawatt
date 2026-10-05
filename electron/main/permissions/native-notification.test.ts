import { projectSessionAttention, withAttentionRead } from '@exawatt/core';
import type {
  PtyAttention,
  PtyAttentionRecord,
} from '@exawatt/core/desktop-bridge';
import {
  isCurrentAttentionAlert,
  shouldDeliverNativeNotification,
} from '../notification-policy';
import { describe, expect, it, vi } from 'vitest';
import {
  createNativeNotifier,
  type NotificationHandle,
} from './native-notification';

function harness(allowed: boolean | Promise<boolean> = true, supported = true) {
  const require = vi.fn(() => Promise.resolve(allowed));
  const handles: Array<NotificationHandle & { fire: (event: string) => void }> =
    [];
  const create = vi.fn(() => {
    const listeners = new Map<string, () => void>();
    const handle = {
      on: (event: string, listener: () => void) => {
        listeners.set(event, listener);
      },
      show: vi.fn(),
      close: vi.fn(),
      fire: (event: string) => listeners.get(event)?.(),
    };
    handles.push(handle);
    return handle;
  });
  const post = createNativeNotifier({
    permissions: { require },
    supported: () => supported,
    create,
  });
  return { post, require, create, handles };
}

const REQUEST = {
  reason: 'An agent needed you.',
  options: { title: 'Claude Code', body: 'needs you', silent: true },
};

describe('the one notification path', () => {
  it('asks the registry for notifications, with the caller’s reason, before it builds anything', async () => {
    const { post, require, create } = harness();
    const order: string[] = [];
    require.mockImplementation(async () => {
      order.push('require');
      return true;
    });
    create.mockImplementation(() => {
      order.push('create');
      return { on: vi.fn(), show: vi.fn(), close: vi.fn() };
    });
    await post(REQUEST);
    expect(require).toHaveBeenCalledWith('notifications', REQUEST.reason);
    expect(order).toEqual(['require', 'create']);
  });

  it('shows the notification when the grant is given', async () => {
    const { post, handles } = harness(true);
    const shown = await post(REQUEST);
    expect(shown).toBe(handles[0]);
    expect(handles[0]!.show).toHaveBeenCalledTimes(1);
  });

  it('builds and shows nothing when the registry says no', async () => {
    const { post, create } = harness(false);
    expect(await post(REQUEST)).toBeNull();
    expect(create).not.toHaveBeenCalled();
  });

  it('does not even ask the registry on a platform that cannot show one', async () => {
    const { post, require } = harness(true, false);
    expect(await post(REQUEST)).toBeNull();
    expect(require).not.toHaveBeenCalled();
  });

  it('drops a notice that went stale while the user was being asked', async () => {
    const { post, create } = harness(true);
    expect(await post({ ...REQUEST, isCurrent: () => false })).toBeNull();
    expect(create).not.toHaveBeenCalled();
  });

  it.each(['read', 'resolved', 'focused', 'disabled'] as const)(
    'drops a source notice when %s changes during the native status read',
    async change => {
      let grant!: (allowed: boolean) => void;
      const pendingGrant = new Promise<boolean>(resolve => {
        grant = resolve;
      });
      const { post, create } = harness(pendingGrant);
      const fact: PtyAttentionRecord = {
        source: 'harness',
        kind: 'blocked',
        request: 'working',
        requestId: 'question',
        since: 1,
        unread: true,
      };
      let snapshot: PtyAttention | null = projectSessionAttention([fact]);
      let focused = false;
      let enabled = true;
      const pending = post({
        ...REQUEST,
        isCurrent: () =>
          isCurrentAttentionAlert(snapshot, fact) &&
          shouldDeliverNativeNotification(enabled, focused, snapshot),
      });
      if (change === 'read') snapshot = withAttentionRead(snapshot!, false);
      if (change === 'resolved') snapshot = null;
      if (change === 'focused') focused = true;
      if (change === 'disabled') enabled = false;
      grant(true);
      expect(await pending).toBeNull();
      expect(create).not.toHaveBeenCalled();
    }
  );

  it('forwards a click and a close to the caller', async () => {
    const { post, handles } = harness(true);
    const onClick = vi.fn();
    const onClose = vi.fn();
    await post({ ...REQUEST, onClick, onClose });
    handles[0]!.fire('click');
    handles[0]!.fire('close');
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
