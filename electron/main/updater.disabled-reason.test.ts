import { describe, expect, it, vi } from 'vitest';

const { autoUpdater, handleTrusted, showMessageBox } = vi.hoisted(() => ({
  autoUpdater: {
    on: vi.fn(),
    setFeedURL: vi.fn(),
  },
  handleTrusted: vi.fn(),
  showMessageBox: vi.fn(),
}));

vi.mock('electron', () => ({
  app: { name: 'Orbit', getVersion: () => '0.1.9', getPath: () => '/tmp' },
  BrowserWindow: { getAllWindows: () => [] },
  dialog: { showMessageBox },
}));
vi.mock('electron-updater', () => ({ autoUpdater }));
vi.mock('./ipc-security', () => ({ handleTrusted }));
vi.mock('./diagnostics-log', () => ({ createDiagnosticsLog: () => vi.fn() }));

const {
  checkForUpdatesFromMenu,
  registerProductUpdater,
  updaterDisabledReason,
} = await import('./updater');

const LIVE = {
  signedDelivery: true,
  packaged: true,
  testRun: false,
  hasFeedConfig: true,
};

describe('updaterDisabledReason', () => {
  it('reports no reason when the channel is live', () => {
    expect(updaterDisabledReason(LIVE)).toBeNull();
  });

  // BUG-015: six signed, notarized, launchable releases shipped with no
  // app-update.yml. electron-updater read it, got ENOENT, and the operator saw
  // "Update failed" on every launch for a week with nothing to act on.
  it('names a missing feed config on an otherwise shippable build', () => {
    expect(updaterDisabledReason({ ...LIVE, hasFeedConfig: false })).toBe(
      'no-feed-config'
    );
  });

  it('reports unsigned delivery before anything else', () => {
    expect(
      updaterDisabledReason({
        signedDelivery: false,
        packaged: false,
        testRun: true,
        hasFeedConfig: false,
      })
    ).toBe('unsigned-delivery');
  });

  it('reports an unpacked run before a test run', () => {
    expect(
      updaterDisabledReason({ ...LIVE, packaged: false, testRun: true })
    ).toBe('not-packaged');
  });

  it('reports a test run before a missing feed', () => {
    expect(
      updaterDisabledReason({ ...LIVE, testRun: true, hasFeedConfig: false })
    ).toBe('test-run');
  });
});

describe('registerProductUpdater', () => {
  it('binds electron-updater and IPC to the declared distribution feed', () => {
    registerProductUpdater(
      'https://updates.example.test/macos',
      () => 0,
      async () => true
    );

    expect(autoUpdater.setFeedURL).toHaveBeenCalledWith(
      'https://updates.example.test/macos'
    );
    expect(autoUpdater.on).toHaveBeenCalledTimes(6);
    expect(handleTrusted.mock.calls.map(([channel]) => channel)).toEqual([
      'app:get-update-status',
      'app:check-for-updates',
      'app:restart-update',
    ]);
  });

  it('uses the resolved application name in native update copy', async () => {
    showMessageBox.mockClear();

    await checkForUpdatesFromMenu();

    expect(showMessageBox).toHaveBeenCalledWith(
      expect.objectContaining({
        detail: expect.stringContaining('This copy of Orbit 0.1.9'),
      })
    );
  });
});
