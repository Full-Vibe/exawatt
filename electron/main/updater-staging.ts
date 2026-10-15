/**
 * Squirrel.Mac staging for Restart to Update (BUG-286).
 *
 * With `autoInstallOnAppQuit` false (decision `0009`), electron-updater's
 * `MacUpdater` reports an update as downloaded before Squirrel.Mac has seen
 * it: Squirrel fetches the zip from MacUpdater's local proxy only when
 * `quitAndInstall()` runs. Every Squirrel refusal (a bundle identifier or code
 * signature the running app cannot accept, incident `0026`) therefore arrived
 * after the shutdown had already stopped every agent, and the window sat on
 * "Closing Exawatt…" for good.
 *
 * Staging asks Squirrel to take the update while nothing has stopped yet.
 * MacUpdater's own `update-downloaded` listener on the same native updater
 * marks it staged, so the later `quitAndInstall()` goes straight to the
 * native install. A refusal here costs the operator nothing but the notice.
 */

/** The surface of Electron's native `autoUpdater` this module uses. */
export interface NativeUpdater {
  checkForUpdates(): void;
  on(event: 'update-downloaded', listener: () => void): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
  removeListener(event: 'update-downloaded', listener: () => void): unknown;
  removeListener(event: 'error', listener: (error: Error) => void): unknown;
}

export type NativeUpdaterOutcome =
  | { ok: true }
  | { ok: false; reason: string; timedOut: boolean };

interface Timers {
  setTimeout: (callback: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
}

const realTimers: Timers = {
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: handle => clearTimeout(handle as NodeJS.Timeout),
};

/**
 * Squirrel downloads the zip from localhost, unzips it and verifies the
 * bundle. A 150 MB update takes seconds; three minutes is a hung helper.
 */
export const STAGE_DEADLINE_MS = 180_000;
/** After a staged install starts, the app should be gone within seconds. */
export const INSTALL_DEADLINE_MS = 30_000;

/**
 * Waits for the native updater's `error` or the deadline, and, when
 * `untilDownloaded`, its next `update-downloaded`, whichever comes first.
 * `start` kicks off the native work after the listeners are attached, so a
 * synchronous event is not missed.
 */
function awaitNativeUpdater(
  native: NativeUpdater,
  options: {
    start: () => void;
    untilDownloaded: boolean;
    deadlineMs: number;
    describe: string;
    timers?: Timers;
  }
): Promise<NativeUpdaterOutcome> {
  const timers = options.timers ?? realTimers;
  return new Promise(resolve => {
    let settled = false;
    const finish = (outcome: NativeUpdaterOutcome) => {
      if (settled) return;
      settled = true;
      timers.clearTimeout(timer);
      native.removeListener('update-downloaded', onDownloaded);
      native.removeListener('error', onError);
      resolve(outcome);
    };
    const onDownloaded = () => finish({ ok: true });
    const onError = (error: Error) =>
      finish({
        ok: false,
        reason: error?.message || String(error),
        timedOut: false,
      });
    const timer = timers.setTimeout(
      () =>
        finish({
          ok: false,
          reason: `${options.describe} did not finish within ${Math.round(options.deadlineMs / 1000)} seconds.`,
          timedOut: true,
        }),
      options.deadlineMs
    );
    if (options.untilDownloaded) native.on('update-downloaded', onDownloaded);
    native.on('error', onError);
    try {
      options.start();
    } catch (error) {
      onError(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

/** Asks Squirrel.Mac to fetch, unzip and verify the downloaded update. */
export function stageNativeUpdate(
  native: NativeUpdater,
  options: { deadlineMs?: number; timers?: Timers } = {}
): Promise<NativeUpdaterOutcome> {
  return awaitNativeUpdater(native, {
    start: () => native.checkForUpdates(),
    untilDownloaded: true,
    deadlineMs: options.deadlineMs ?? STAGE_DEADLINE_MS,
    describe: 'Preparing the update',
    timers: options.timers,
  });
}

/**
 * Starts the install and settles only if it fails: a native `error`, or the
 * app still running at the deadline. A successful install ends the process,
 * so the promise is simply never settled.
 */
export function watchNativeInstall(
  native: NativeUpdater,
  options: { install: () => void; deadlineMs?: number; timers?: Timers }
): Promise<NativeUpdaterOutcome> {
  return awaitNativeUpdater(native, {
    start: options.install,
    untilDownloaded: false,
    deadlineMs: options.deadlineMs ?? INSTALL_DEADLINE_MS,
    describe: 'Installing the update',
    timers: options.timers,
  });
}
