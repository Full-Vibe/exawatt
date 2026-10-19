import { EventEmitter } from 'events';
import type { ProductUpdaterBoundary } from './updater';

/**
 * The product updater's two boundaries for an automated launch
 * (`EXAWATT_TEST=1` with `EXAWATT_TEST_PRODUCT_UPDATE=<version>:<staging>`),
 * so an Electron eval can drive Restart to Update without a signed release.
 *
 * Built from the real surfaces and no more capable than them: electron-
 * updater reports only through its events, and Electron's native updater's
 * `checkForUpdates()` returns nothing and answers with `update-downloaded`
 * or `error`. Staging is one of:
 *
 * - `accept`  Squirrel takes the update; the install then ends the app the
 *             way `quitAndInstall` does, by quitting it
 * - `refuse`  Squirrel rejects the bundle, as it did for 0.1.10 (incident
 *             0026)
 * - `stall`   Squirrel never answers
 */

type Staging = 'accept' | 'refuse' | 'stall';

export function testProductUpdate(
  value: string | undefined
): { version: string; staging: Staging } | null {
  const match = /^(\d+\.\d+\.\d+):(accept|refuse|stall)$/.exec(value ?? '');
  return match ? { version: match[1], staging: match[2] as Staging } : null;
}

export function createTestUpdaterBoundary(
  scenario: { version: string; staging: Staging },
  quit: () => void
): ProductUpdaterBoundary {
  const native = new EventEmitter();
  const updater = Object.assign(new EventEmitter(), {
    logger: null,
    autoDownload: false,
    autoInstallOnAppQuit: false,
    allowPrerelease: false,
    setFeedURL: () => undefined,
    checkForUpdates: async () => null,
    quitAndInstall: () => quit(),
  });
  // The download finishes as soon as the updater is listening, as a cached
  // one does at launch.
  setImmediate(() =>
    updater.emit('update-downloaded', { version: scenario.version })
  );
  return {
    updater: updater as unknown as ProductUpdaterBoundary['updater'],
    native: Object.assign(native, {
      checkForUpdates: () => {
        if (scenario.staging === 'accept') {
          setImmediate(() => native.emit('update-downloaded'));
        } else if (scenario.staging === 'refuse') {
          setImmediate(() =>
            native.emit(
              'error',
              new Error('Could not locate update bundle for ai.exawatt.desktop')
            )
          );
        }
      },
    }) as unknown as ProductUpdaterBoundary['native'],
  };
}
