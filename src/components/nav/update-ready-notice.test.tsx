import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProductUpdateStatus } from '@/types/electron';
import { UpdateReadyNotice } from './update-ready-notice';

let emitStatus: ((status: ProductUpdateStatus) => void) | undefined;

afterEach(() => {
  delete window.electron;
  emitStatus = undefined;
});

function installApi() {
  const restartUpdate = vi.fn(async () => undefined);
  window.electron = {
    isElectron: true,
    platform: 'darwin',
    app: {
      getBuildInfo: async () => ({
        sha: 'abc',
        branch: 'master',
        builtAt: '',
        delivery: 'dogfood',
      }),
      getUpdateStatus: async () => ({
        phase: 'idle',
        currentVersion: '1.0.0',
        availableVersion: null,
        percent: null,
        liveSessions: 0,
        error: null,
      }),
      checkForUpdates: async () => {
        throw new Error('unused');
      },
      restartUpdate,
      setWorkspaceCheckpointOwner: async () => undefined,
      completeCheckpoint: async () => undefined,
      onCheckpointRequest: () => () => undefined,
      onShutdownStatus: () => () => undefined,
      onUpdateReady: () => () => undefined,
      onUpdateStatus: handler => {
        emitStatus = handler;
        return () => undefined;
      },
    },
  };
  return restartUpdate;
}

describe('UpdateReadyNotice', () => {
  it('shows restart impact and installs only on explicit action', async () => {
    const restart = installApi();
    render(<UpdateReadyNotice />);
    await act(async () => undefined);
    act(() =>
      emitStatus?.({
        phase: 'downloaded',
        currentVersion: '1.0.0',
        availableVersion: '1.1.0',
        percent: 100,
        liveSessions: 4,
        error: null,
      })
    );
    expect(screen.getByText(/ready to install/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Restart to Update/ }));
    expect(restart).toHaveBeenCalledOnce();
  });

  it('states that the current build remains installed after failure', async () => {
    installApi();
    render(<UpdateReadyNotice />);
    await act(async () => undefined);
    act(() =>
      emitStatus?.({
        phase: 'error',
        currentVersion: '1.0.0',
        availableVersion: '1.1.0',
        percent: null,
        liveSessions: 0,
        error: 'network unavailable',
      })
    );
    expect(
      screen.getByText('Update failed. Exawatt 1.0.0 remains installed.')
    ).toBeInTheDocument();
  });
});
