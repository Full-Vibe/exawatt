import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProductUpdateStatus } from '@/types/electron';
import {
  COMMUNITY_DISTRIBUTION,
  COMMUNITY_IDENTITY,
} from '@exawatt/core/distribution';
import { UpdateReadyNotice } from './update-ready-notice';

let emitStatus: ((status: ProductUpdateStatus) => void) | undefined;
const UPDATE_DISTRIBUTION = {
  ...COMMUNITY_DISTRIBUTION,
  updates: { feedUrl: 'https://updates.example.test/macos' },
} as const;

afterEach(() => {
  delete window.electron;
  emitStatus = undefined;
});

function installApi(productUpdates = true) {
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
        distributionDigest: 'test-distribution',
        rendererCompositionDigest: null,
        version: '1.0.0',
        distribution: {
          contract: productUpdates
            ? UPDATE_DISTRIBUTION
            : COMMUNITY_DISTRIBUTION,
          digest: 'test-distribution',
          identity: COMMUNITY_IDENTITY,
          capabilities: {
            updates: productUpdates,
            updateIpcChannels: productUpdates
              ? [
                  'app:get-update-status',
                  'app:check-for-updates',
                  'app:restart-update',
                ]
              : [],
            protocolScheme: null,
          },
        },
      }),
      ...(productUpdates
        ? {
            updates: {
              getStatus: async () => ({
                phase: 'idle' as const,
                currentVersion: '1.0.0',
                availableVersion: null,
                percent: null,
                liveSessions: 0,
                error: null,
                enabled: true,
                disabledReason: null,
                logPath: null,
              }),
              check: async () => {
                throw new Error('unused');
              },
              restart: restartUpdate,
              onStatus: (handler: (status: ProductUpdateStatus) => void) => {
                emitStatus = handler;
                return () => undefined;
              },
            },
          }
        : {}),
      getDiagnosticsReport: async () => {
        throw new Error('unused');
      },
      saveDiagnosticsReport: async () => ({ ok: false, filePath: null }),
      setWorkspaceCheckpointOwner: async () => undefined,
      completeCheckpoint: async () => undefined,
      onCheckpointRequest: () => () => undefined,
      onShutdownStatus: () => () => undefined,
      onUpdateReady: () => () => undefined,
    },
  };
  return restartUpdate;
}

describe('UpdateReadyNotice', () => {
  it('degrades to no product-update UI when the capability is absent', () => {
    installApi(false);
    const { container } = render(<UpdateReadyNotice />);
    expect(container).toBeEmptyDOMElement();
    expect(emitStatus).toBeUndefined();
  });

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
        enabled: true,
        disabledReason: null,
        logPath: null,
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
        enabled: true,
        disabledReason: null,
        logPath: '/tmp/updater.jsonl',
      })
    );
    expect(
      screen.getByText(
        'Update failed, so Exawatt 1.0.0 stays installed. network unavailable'
      )
    ).toBeInTheDocument();
  });

  it('says so when a failure arrived without a reason', async () => {
    installApi();
    render(<UpdateReadyNotice />);
    await act(async () => undefined);
    act(() =>
      emitStatus?.({
        phase: 'error',
        currentVersion: '1.0.0',
        availableVersion: null,
        percent: null,
        liveSessions: 0,
        error: null,
        enabled: true,
        disabledReason: null,
        logPath: null,
      })
    );
    expect(
      screen.getByText(
        'Update failed, so Exawatt 1.0.0 stays installed. No reason was reported.'
      )
    ).toBeInTheDocument();
  });
});
