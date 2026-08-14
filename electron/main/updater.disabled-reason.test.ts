import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { getVersion: () => '0.1.9', getPath: () => '/tmp' },
  BrowserWindow: { getAllWindows: () => [] },
  dialog: { showMessageBox: vi.fn() },
}));
vi.mock('electron-updater', () => ({ autoUpdater: { on: vi.fn() } }));

const { updaterDisabledReason } = await import('./updater');

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
