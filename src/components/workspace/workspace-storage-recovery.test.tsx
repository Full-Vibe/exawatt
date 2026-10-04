import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useWorkspaceState } from './use-workspace-state';
import { WorkspaceStorageRecovery } from './workspace-storage-recovery';
import {
  installBridgeDouble,
  removeBridgeDouble,
} from '@/test-support/desktop-bridge-double';

vi.mock('@/lib/projects/registry', () => ({
  listProjects: vi.fn(async () => []),
}));

function bridge() {
  const workspace = {
    load: vi.fn(async (): Promise<unknown> => {
      throw new Error('read failed');
    }),
    recovery: vi.fn(async () => ({ previousRunInterrupted: false })),
    storageRecovery: vi.fn(async () => ({
      required: true,
      recoveryFile: '/saved/workspace.corrupt',
    })),
    retryRecovery: vi.fn(async () => {}),
    save: vi.fn(async (_layout: unknown) => {}),
  };
  const offExit = vi.fn();
  const create = vi.fn();
  const changeModel = vi.fn();
  installBridgeDouble({
    workspace,
    pty: {
      create,
      changeModel,
      list: vi.fn(async () => []),
      closedSessions: vi.fn(async () => []),
      onExit: vi.fn(() => offExit),
      focus: vi.fn(async () => {}),
    },
  });
  return { workspace, offExit, create, changeModel };
}

afterEach(() => {
  removeBridgeDouble();
});

describe('workspace storage recovery', () => {
  it('blocks readiness and shutdown writes after failed hydration, then retries through the recovery boundary', async () => {
    const { workspace, offExit } = bridge();
    const { result } = renderHook(() => useWorkspaceState());
    await waitFor(() =>
      expect(result.current.workspaceLoadFailure?.required).toBe(true)
    );
    expect(result.current.ready).toBe(false);
    act(() => window.dispatchEvent(new Event('beforeunload')));
    expect(workspace.save).not.toHaveBeenCalled();
    workspace.retryRecovery.mockRejectedValueOnce(new Error('still damaged'));
    await act(async () => {
      await expect(result.current.retryWorkspaceLoad()).rejects.toThrow(
        'still damaged'
      );
    });
    expect(result.current.workspaceLoadFailure?.required).toBe(true);
    expect(result.current.ready).toBe(false);
    workspace.load.mockResolvedValue({
      v: 7,
      activeDir: '/restored',
      lastUsedDir: '/restored',
      projects: [
        {
          dir: '/restored',
          name: 'Restored',
          color: '#19E6FF',
          activeTabId: null,
          tabs: [],
        },
      ],
    });
    await act(async () => {
      await result.current.retryWorkspaceLoad();
    });
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.activeProject?.dir).toBe('/restored');
    expect(workspace.retryRecovery).toHaveBeenCalledTimes(2);
    expect(workspace.load).toHaveBeenCalledTimes(2);
    expect(offExit).toHaveBeenCalledTimes(1);
  });

  it('keeps a generic read failure visible when recovery diagnostics also fail', async () => {
    const { workspace } = bridge();
    workspace.storageRecovery.mockRejectedValue(new Error('IPC unavailable'));
    const { result } = renderHook(() => useWorkspaceState());
    await waitFor(() =>
      expect(result.current.workspaceLoadFailure).toEqual({ required: false })
    );
    expect(result.current.ready).toBe(false);
    workspace.load.mockResolvedValue(null);
    await act(async () => {
      await result.current.retryWorkspaceLoad();
    });
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(workspace.retryRecovery).not.toHaveBeenCalled();
  });

  it('does not treat an unsupported saved document as a fresh workspace', async () => {
    const { workspace } = bridge();
    workspace.load.mockResolvedValue({ v: 999, projects: [] });
    const { result } = renderHook(() => useWorkspaceState());
    await waitFor(() =>
      expect(result.current.workspaceLoadFailure).not.toBeNull()
    );
    expect(result.current.ready).toBe(false);
    act(() => window.dispatchEvent(new Event('beforeunload')));
    expect(workspace.save).not.toHaveBeenCalled();
  });

  it('hydrates an unsupported source without admitting runtime commands or losing its record', async () => {
    const { workspace, create, changeModel } = bridge();
    const saved = {
      kind: 'session',
      id: 'unsupported',
      durableSessionId: 'durable-unsupported',
      harness: 'future-source',
      title: 'Keep the original purpose',
      titleKind: 'operator',
      cwd: '/saved',
      harnessSessionId: 'exact-provider-id',
      lifecycle: 'stopped-clean',
      vendorThread: { opaque: 'kept' },
    };
    workspace.load.mockResolvedValue({
      v: 7,
      activeDir: '/saved',
      lastUsedDir: '/saved',
      projects: [
        { dir: '/saved', name: 'Saved', activeTabId: saved.id, tabs: [saved] },
      ],
    });
    const { result } = renderHook(() => useWorkspaceState());
    await waitFor(() => expect(result.current.ready).toBe(true));
    await act(async () => {
      expect(await result.current.resumeTab(saved.id)).toBe(false);
      await expect(
        result.current.changeSessionModel(saved.id, { model: 'replacement' })
      ).rejects.toThrow();
    });
    expect(create).not.toHaveBeenCalled();
    expect(changeModel).not.toHaveBeenCalled();
    expect(result.current.activeProject?.tabs[0]).toMatchObject({
      harness: saved.harness,
      lifecycle: saved.lifecycle,
      harnessSessionId: saved.harnessSessionId,
    });
    act(() => window.dispatchEvent(new Event('beforeunload')));
    await waitFor(() => expect(workspace.save).toHaveBeenCalled());
    expect(workspace.save.mock.calls.at(-1)?.[0]).toMatchObject({
      projects: [
        {
          tabs: [{ harness: saved.harness, vendorThread: saved.vendorThread }],
        },
      ],
    });
  });

  it('serializes recovery actions and surfaces a failed retry without dismissing preserved data', async () => {
    let reject!: (error: Error) => void;
    const onRetry = vi.fn(
      () =>
        new Promise<void>((_, fail) => {
          reject = fail;
        })
    );
    const onReveal = vi.fn(async () => {});
    render(
      <WorkspaceStorageRecovery
        failure={{ required: true, recoveryFile: '/saved/evidence' }}
        onRetry={onRetry}
        onReveal={onReveal}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(
      screen.getByRole('button', { name: 'Reveal saved data' })
    ).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    await act(async () => reject(new Error('invalid repaired file')));
    expect(screen.getAllByRole('alert')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Reveal saved data' }));
    await waitFor(() => expect(onReveal).toHaveBeenCalledTimes(1));
  });
});
