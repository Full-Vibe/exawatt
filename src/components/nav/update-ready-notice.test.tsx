import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  COMMUNITY_DISTRIBUTION,
  COMMUNITY_IDENTITY,
  resolveDistributionIdentity,
} from '@exawatt/core/distribution';
import { UpdateReadyNotice } from './update-ready-notice';
import type {
  PreviousVersion,
  ProductUpdateStatus,
  ShutdownStatus,
  UpdateReadyNotice as InstalledBuild,
} from '@exawatt/core/desktop-bridge';
import { EXAWATT_HOSTED_ORIGIN } from '@/lib/analytics/config';
import { changelogEntryUrl } from '@/lib/changelog/versions.mjs';
import {
  installBridgeDouble,
  removeBridgeDouble,
} from '@/test-support/desktop-bridge-double';

let emitStatus: ((status: ProductUpdateStatus) => void) | undefined;
let emitShutdown: ((status: ShutdownStatus) => void) | undefined;
let emitInstalled: ((notice: InstalledBuild) => void) | undefined;
const UPDATE_DISTRIBUTION = {
  ...COMMUNITY_DISTRIBUTION,
  brand: {
    appId: 'dev.example.orbit',
    productName: 'Orbit',
    protocolScheme: 'orbit',
    iconPath: 'electron/resources/orbit.icns',
    updateChannel: 'stable',
  },
  updates: { feedUrl: 'https://updates.example.test/macos' },
} as const;
const UPDATE_IDENTITY = resolveDistributionIdentity(UPDATE_DISTRIBUTION);

/** Main's side: the one dismissal record and the latest installed build. */
const main: {
  dismissals: Record<string, string>;
  installed: InstalledBuild | null;
  cancelled: number;
  /** The run record's answer; absent from a bridge that predates it. */
  previous: PreviousVersion | null;
} = { dismissals: {}, installed: null, cancelled: 0, previous: null };

const idle: ShutdownStatus = {
  phase: 'idle',
  agents: 0,
  shells: 0,
  intent: null,
  waitingOn: null,
  cancellable: false,
};
const shutdownAt = (patch: Partial<ShutdownStatus>): ShutdownStatus => ({
  ...idle,
  intent: 'update',
  ...patch,
});

afterEach(() => {
  removeBridgeDouble();
  main.dismissals = {};
  main.installed = null;
  main.cancelled = 0;
  main.previous = null;
  emitStatus = undefined;
  emitShutdown = undefined;
  emitInstalled = undefined;
});

function installApi(productUpdates = true) {
  const restartUpdate = vi.fn(async () => undefined);
  installBridgeDouble({
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
          identity: productUpdates ? UPDATE_IDENTITY : COMMUNITY_IDENTITY,
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
      reportRenderError: async () => undefined,
      setWorkspaceCheckpointOwner: async () => undefined,
      completeCheckpoint: async () => undefined,
      onCheckpointRequest: () => () => undefined,
      onShutdownStatus: handler => {
        emitShutdown = handler;
        return () => undefined;
      },
      onUpdateReady: handler => {
        emitInstalled = notice => {
          main.installed = notice;
          handler(notice);
        };
        return () => undefined;
      },
      installedBuild: async () => main.installed,
      noticeDismissals: async () => ({ ...main.dismissals }),
      dismissNotice: async (id, version) => {
        main.dismissals = { ...main.dismissals, [id]: version };
        return { ...main.dismissals };
      },
      onNoticeDismissalsChanged: () => () => undefined,
      ...(main.previous
        ? { previousVersion: async () => main.previous as PreviousVersion }
        : {}),
      shutdownStatus: async () => idle,
      cancelShutdown: async () => {
        main.cancelled += 1;
        return true;
      },
    },
  });
  return restartUpdate;
}

describe('UpdateReadyNotice', () => {
  it('degrades to no product-update UI when the capability is absent', async () => {
    installApi(false);
    const { container } = render(<UpdateReadyNotice />);
    await act(async () => undefined);
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
        'Update failed, so Orbit 1.0.0 stays installed. network unavailable'
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
        'Update failed, so Orbit 1.0.0 stays installed. No reason was reported.'
      )
    ).toBeInTheDocument();
  });

  it('keeps an update available until dismissal and reveals later status', async () => {
    const restart = installApi();
    render(<UpdateReadyNotice />);
    await act(async () => undefined);
    const ready: ProductUpdateStatus = {
      phase: 'downloaded',
      currentVersion: '1.0.0',
      availableVersion: '1.1.0',
      percent: 100,
      liveSessions: 1,
      error: null,
      enabled: true,
      disabledReason: null,
      logPath: null,
    };
    act(() => emitStatus?.(ready));
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(restart).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole('button', { name: 'Dismiss update notice' })
    );
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    act(() => emitStatus?.({ ...ready, availableVersion: '1.2.0' }));
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(restart).not.toHaveBeenCalled();
  });

  it('announces active shutdown without offering interruption or restart', async () => {
    const restart = installApi();
    render(<UpdateReadyNotice />);
    await act(async () => undefined);
    act(() =>
      emitShutdown?.(
        shutdownAt({ phase: 'checkpointing', agents: 2, shells: 1 })
      )
    );
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(restart).not.toHaveBeenCalled();
    act(() => emitShutdown?.(idle));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  // BUG-286: the installer's refusal used to sit behind "Closing Orbit…"
  // forever, with the reason only in updater.jsonl.
  it('shows an install refusal that arrives while the restart is finalizing', async () => {
    installApi();
    render(<UpdateReadyNotice />);
    await act(async () => undefined);
    const failed: ProductUpdateStatus = {
      phase: 'error',
      currentVersion: '1.0.0',
      availableVersion: '1.1.0',
      percent: null,
      liveSessions: 0,
      error: 'Could not locate update bundle',
      enabled: true,
      disabledReason: null,
      logPath: null,
    };
    act(() => emitShutdown?.(shutdownAt({ phase: 'finalizing' })));
    act(() => emitStatus?.(failed));
    expect(
      screen.getByText(
        'Update failed, so Orbit 1.0.0 stays installed. Could not locate update bundle'
      )
    ).toBeInTheDocument();
  });

  it('keeps a quit on its own progress when an older failure is showing', async () => {
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
        error: 'network unavailable',
        enabled: true,
        disabledReason: null,
        logPath: null,
      })
    );
    act(() => emitShutdown?.(shutdownAt({ phase: 'finalizing' })));
    expect(screen.queryByText(/network unavailable/)).not.toBeInTheDocument();
  });

  // BUG-285: the operator dismissed "New local build installed" and saw it
  // again minutes later. The dogfood log shows a second build installed in
  // between (19:32 and 19:41 on 2026-10-05, feedback at 19:43) while he was
  // still running the first stale one: the notice is about the RUNNING
  // build, so another install changes nothing he has to do.
  it('keeps a dismissed local-build notice dismissed when another build installs under the same running one', async () => {
    installApi(false);
    render(<UpdateReadyNotice />);
    await act(async () => undefined);
    act(() =>
      emitInstalled?.({ currentSha: 'running', installedSha: 'first' })
    );
    expect(screen.getByText(/New local build installed/)).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', { name: 'Dismiss update notice' })
    );
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    act(() =>
      emitInstalled?.({ currentSha: 'running', installedSha: 'second' })
    );
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('stays dismissed when the window reloads or the app is returned to', async () => {
    installApi(false);
    const first = render(<UpdateReadyNotice />);
    await act(async () => undefined);
    act(() =>
      emitInstalled?.({ currentSha: 'running', installedSha: 'first' })
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Dismiss update notice' })
    );
    await act(async () => undefined);
    first.unmount();

    render(<UpdateReadyNotice />);
    await act(async () => undefined);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('shows a build installed before this window opened', async () => {
    installApi(false);
    main.installed = { currentSha: 'running', installedSha: 'first' };
    render(<UpdateReadyNotice />);
    await act(async () => undefined);
    expect(screen.getByText(/New local build installed/)).toBeInTheDocument();
  });

  it('announces again once the operator runs a build that is superseded in turn', async () => {
    installApi(false);
    main.dismissals = { 'local-build-installed': 'running' };
    render(<UpdateReadyNotice />);
    await act(async () => undefined);
    act(() => emitInstalled?.({ currentSha: 'next', installedSha: 'third' }));
    expect(screen.getByText(/New local build installed/)).toBeInTheDocument();
  });

  // BUG-286: a stalled phase says what it is waiting on, and offers Cancel
  // while cancelling still leaves every Session running.
  it('names what a stalled shutdown waits on and lets the operator cancel it', async () => {
    installApi();
    render(<UpdateReadyNotice />);
    await act(async () => undefined);
    act(() =>
      emitShutdown?.(
        shutdownAt({
          phase: 'preparing',
          waitingOn: 'update-staging',
          cancellable: true,
        })
      )
    );
    expect(
      screen.getByText('Waiting for macOS to accept the update.')
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(main.cancelled).toBe(1);

    act(() =>
      emitShutdown?.(
        shutdownAt({
          phase: 'finalizing',
          waitingOn: 'services-closing',
          cancellable: false,
        })
      )
    );
    expect(
      screen.getByText('Waiting for background services to close.')
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Cancel' })
    ).not.toBeInTheDocument();
  });

  // Review of 0.1.22: the mount-time reads committed whenever they arrived,
  // so one that answered after a push, or after the operator dismissed,
  // put the older answer back on screen.
  describe('a read that answers after newer state', () => {
    function deferred<T>() {
      let resolve!: (value: T) => void;
      const promise = new Promise<T>(settle => (resolve = settle));
      return { promise, resolve };
    }

    function installSlowReads() {
      const dismissals = deferred<Record<string, string>>();
      const shutdown = deferred<ShutdownStatus>();
      const installed = deferred<InstalledBuild | null>();
      const status = deferred<ProductUpdateStatus>();
      installApi();
      const app = window.electron!.app!;
      Object.assign(app, {
        noticeDismissals: () => dismissals.promise,
        shutdownStatus: () => shutdown.promise,
        installedBuild: () => installed.promise,
      });
      Object.assign(app.updates!, { getStatus: () => status.promise });
      return { dismissals, shutdown, installed, status };
    }

    it('keeps a dismissal the operator made before the read answered', async () => {
      const slow = installSlowReads();
      render(<UpdateReadyNotice />);
      act(() =>
        emitInstalled?.({ currentSha: 'running', installedSha: 'first' })
      );
      fireEvent.click(
        screen.getByRole('button', { name: 'Dismiss update notice' })
      );
      await act(async () => slow.dismissals.resolve({}));
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });

    it('keeps a pushed shutdown phase over an older idle read', async () => {
      const slow = installSlowReads();
      render(<UpdateReadyNotice />);
      act(() => emitShutdown?.(shutdownAt({ phase: 'stopping', agents: 1 })));
      await act(async () => slow.shutdown.resolve(idle));
      expect(screen.getByRole('status')).toBeInTheDocument();
    });

    it('keeps a pushed installed build over an older empty read', async () => {
      const slow = installSlowReads();
      render(<UpdateReadyNotice />);
      act(() =>
        emitInstalled?.({ currentSha: 'running', installedSha: 'first' })
      );
      await act(async () => slow.installed.resolve(null));
      expect(screen.getByText(/New local build installed/)).toBeInTheDocument();
    });

    it('keeps a pushed update status over an older idle read', async () => {
      const slow = installSlowReads();
      render(<UpdateReadyNotice />);
      const ready: ProductUpdateStatus = {
        phase: 'downloaded',
        currentVersion: '1.0.0',
        availableVersion: '1.1.0',
        percent: 100,
        liveSessions: 0,
        error: null,
        enabled: true,
        disabledReason: null,
        logPath: null,
      };
      act(() => emitStatus?.(ready));
      await act(async () =>
        slow.status.resolve({ ...ready, phase: 'idle', availableVersion: null })
      );
      expect(screen.getByText(/ready to install/)).toBeInTheDocument();
    });
  });
});

// ENG-031 W28: one quiet line after the app starts on a new version, leading
// to that version's changelog page, only while the site serves that page.
describe("What's new", () => {
  const RUNNING = '1.0.0';
  const feedSays = (
    availableVersion: string | null,
    patch: Partial<ProductUpdateStatus> = {}
  ): ProductUpdateStatus => ({
    phase: 'idle',
    currentVersion: RUNNING,
    availableVersion,
    percent: null,
    liveSessions: 0,
    error: null,
    enabled: true,
    disabledReason: null,
    logPath: null,
    ...patch,
  });
  const newsLink = () =>
    document.querySelector<HTMLAnchorElement>('[data-whats-new]');

  async function launch(
    previous: PreviousVersion,
    status: ProductUpdateStatus
  ) {
    main.previous = previous;
    installApi();
    const view = render(<UpdateReadyNotice />);
    await act(async () => undefined);
    act(() => emitStatus?.(status));
    return view;
  }

  it('leads to the changelog page of a newer published version, once', async () => {
    const first = await launch(
      { kind: 'recorded', version: '0.9.0' },
      feedSays(RUNNING)
    );
    const link = newsLink();
    expect(link?.href).toBe(changelogEntryUrl(EXAWATT_HOSTED_ORIGIN, RUNNING));
    expect(link?.target).toBe('_blank');

    // Opening it is reading it: main records the version as seen.
    fireEvent.click(link!);
    expect(main.dismissals).toEqual({ 'whats-new': RUNNING });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    await act(async () => undefined);
    first.unmount();

    // A reload, another window, or the next launch of the same build.
    render(<UpdateReadyNotice />);
    await act(async () => undefined);
    act(() => emitStatus?.(feedSays(RUNNING)));
    expect(newsLink()).toBeNull();
  });

  it('stays dismissed once closed, and comes back for the next version', async () => {
    const first = await launch(
      { kind: 'recorded', version: '0.9.0' },
      feedSays(RUNNING)
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Dismiss update notice' })
    );
    await act(async () => undefined);
    expect(main.dismissals).toEqual({ 'whats-new': RUNNING });
    first.unmount();

    render(<UpdateReadyNotice />);
    await act(async () => undefined);
    act(() => emitStatus?.(feedSays(RUNNING)));
    expect(newsLink()).toBeNull();

    act(() => emitStatus?.(feedSays('1.1.0', { currentVersion: '1.1.0' })));
    expect(newsLink()?.href).toBe(
      changelogEntryUrl(EXAWATT_HOSTED_ORIGIN, '1.1.0')
    );
  });

  it('treats a run recorded before versions were kept as an older version', async () => {
    await launch({ kind: 'unrecorded' }, feedSays(RUNNING));
    expect(newsLink()).not.toBeNull();
  });

  it('shows nothing on a first install, the same version, or a downgrade', async () => {
    for (const previous of [
      { kind: 'none' },
      { kind: 'recorded', version: RUNNING },
      { kind: 'recorded', version: '1.2.0' },
    ] as PreviousVersion[]) {
      const view = await launch(previous, feedSays(RUNNING));
      expect(view.container).toBeEmptyDOMElement();
      view.unmount();
      removeBridgeDouble();
    }
  });

  it('shows nothing until the update feed publishes the version', async () => {
    const after = { kind: 'recorded', version: '0.9.0' } as const;
    for (const status of [
      // a dogfood, community or dev build: no update channel, so no answer
      feedSays(null, { enabled: false, disabledReason: 'unsigned-delivery' }),
      // a build ahead of the release: its page is still a draft
      feedSays('0.9.5'),
      // the feed has not answered yet, or could not be read
      feedSays(null, { phase: 'checking' }),
      feedSays(null, { phase: 'error', error: 'offline' }),
    ]) {
      const view = await launch(after, status);
      expect(newsLink()).toBeNull();
      view.unmount();
      removeBridgeDouble();
    }
  });

  it('waits behind an update the operator can act on', async () => {
    await launch(
      { kind: 'recorded', version: '0.9.0' },
      feedSays('1.1.0', { phase: 'downloaded', percent: 100 })
    );
    expect(
      screen.getByRole('button', { name: /Restart to Update/ })
    ).toBeInTheDocument();
    expect(newsLink()).toBeNull();
  });
});
