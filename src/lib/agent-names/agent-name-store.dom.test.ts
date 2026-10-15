import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentNameRecord } from '@exawatt/core';

import {
  installBridgeDouble,
  removeBridgeDouble,
} from '@/test-support/desktop-bridge-double';

function record(
  durableSessionId: string,
  name: string,
  projectKey = '/p'
): AgentNameRecord {
  return {
    durableSessionId,
    projectKey,
    harness: 'claude',
    name,
    origin: 'assigned',
    updatedAt: 1,
  };
}

async function freshStore() {
  vi.resetModules();
  return import('./agent-name-store');
}

afterEach(() => removeBridgeDouble());

describe('the renderer mirror of Agent names', () => {
  it('reads main’s names and follows its pushes', async () => {
    let push: (records: AgentNameRecord[]) => void = () => {};
    installBridgeDouble({
      pty: {
        agentNames: async () => [record('a', 'claude-1')],
        onAgentNamesChanged: handler => {
          push = handler;
          return () => {};
        },
      },
    });
    const store = await freshStore();
    const { result } = renderHook(() => store.useAgentNames());
    await waitFor(() =>
      expect(store.agentNameOf(result.current, 'a')).toBe('claude-1')
    );
    act(() => push([record('a', 'lead')]));
    expect(store.agentNameOf(result.current, 'a')).toBe('lead');
    expect(store.agentNameOf(result.current, 'missing')).toBeNull();
  });

  it('merges what main deals and what a rename answers', async () => {
    const ensure = vi.fn(async () => [record('b', 'claude-2')]);
    installBridgeDouble({
      pty: {
        agentNames: async () => [record('a', 'claude-1')],
        onAgentNamesChanged: () => () => {},
        ensureAgentNames: ensure,
        renameAgent: async (durableSessionId, name) =>
          name === 'claude-2'
            ? { ok: false, code: 'taken', reason: 'taken' }
            : {
                ok: true,
                record: {
                  ...record(durableSessionId, name),
                  origin: 'operator',
                },
              },
      },
    });
    const store = await freshStore();
    const { result } = renderHook(() => store.useAgentNames());
    await waitFor(() => expect(result.current.size).toBe(1));
    await act(() =>
      store.ensureAgentNames([
        { durableSessionId: 'b', projectKey: '/p', harness: 'claude' },
      ])
    );
    expect(ensure).toHaveBeenCalledTimes(1);
    expect(store.agentNameOf(result.current, 'b')).toBe('claude-2');

    expect(await store.renameAgent('a', 'claude-2')).toMatchObject({
      ok: false,
    });
    expect(store.agentNameOf(result.current, 'a')).toBe('claude-1');
    await act(async () => {
      await store.renameAgent('a', 'lead');
    });
    expect(store.agentNameOf(result.current, 'a')).toBe('lead');
  });

  it('answers a rename outside the desktop app with a reason', async () => {
    const store = await freshStore();
    expect(await store.renameAgent('a', 'lead')).toMatchObject({
      ok: false,
      code: 'unknown',
    });
  });
});
