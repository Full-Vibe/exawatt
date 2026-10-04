// @vitest-environment jsdom
import { act, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SessionAttentionCommands } from '@exawatt/core';
import {
  installBridgeDouble,
  removeBridgeDouble,
} from '@/test-support/desktop-bridge-double';
import {
  FleetProvider,
  useFleet,
  useSessionAttentionSource,
} from './fleet-provider';
const scope = vi.hoisted(() => ({ id: 'personal' }));
vi.mock('@/lib/tenancy/tenancy-provider', () => ({
  useOptionalWorkspaceTenancy: () => ({
    hydrated: true,
    activeWorkspace: { id: scope.id },
  }),
}));
afterEach(() => {
  removeBridgeDouble();
  scope.id = 'personal';
});

describe('attention source ownership', () => {
  it('keeps command identity across read updates and invalidates commands across source switches', async () => {
    const focus = vi.fn(async () => {});
    const unread = vi.fn(async () => {});
    installBridgeDouble({
      pty: {
        list: async () => [],
        focus,
        markUnread: unread,
        onData: () => () => {},
        onExit: () => () => {},
      },
    });
    let commands: SessionAttentionCommands | null = null;
    let requestId = '';
    let requestUnread: boolean | undefined;
    function Probe() {
      commands = useSessionAttentionSource();
      const { agents } = useFleet();
      const request = agents.find(agent => agent.attention?.kind === 'blocked');
      requestId = request?.id ?? '';
      requestUnread = request?.attention?.unread;
      return null;
    }
    const tree = () => (
      <FleetProvider>
        <Probe />
      </FleetProvider>
    );
    const { rerender } = render(tree());
    await waitFor(() => expect(commands).not.toBeNull());
    const local = commands!;
    await local.focus('local-session');
    expect(focus).toHaveBeenCalledWith('local-session');
    scope.id = 'demo';
    rerender(tree());
    await waitFor(() => expect(requestId).not.toBe(''));
    const demo = commands!;
    await local.focus('stale-local-session');
    expect(focus).toHaveBeenCalledTimes(1);
    act(() => {
      void demo.focus(requestId);
    });
    await waitFor(() => expect(requestUnread).toBe(false));
    expect(commands).toBe(demo);
    act(() => {
      void demo.markUnread(requestId);
    });
    await waitFor(() => expect(requestUnread).toBe(true));
    expect(commands).toBe(demo);
    expect(unread).not.toHaveBeenCalled();
    scope.id = 'personal';
    rerender(tree());
    await waitFor(() => expect(commands).not.toBe(demo));
    await demo.focus('local-session');
    await demo.markUnread('local-session');
    expect(focus).toHaveBeenCalledTimes(1);
    expect(unread).not.toHaveBeenCalled();
  });
});
