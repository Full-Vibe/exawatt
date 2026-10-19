/**
 * Squirrel.Mac staging for Restart to Update (BUG-286).
 *
 * With `autoInstallOnAppQuit` false (decision `0009`), electron-updater's
 * `MacUpdater` reports an update as downloaded before Squirrel.Mac has seen
 * it: Squirrel fetches the zip from MacUpdater's local proxy only when
 * `quitAndInstall()` runs. Every Squirrel refusal (a bundle identifier or code
 * signature the running app cannot accept, incident `0026`) therefore arrived
 * after the shutdown had already stopped every agent.
 *
 * Staging asks Squirrel to take the update while nothing has stopped yet.
 * MacUpdater's own `update-downloaded` listener on the same native updater
 * marks it staged, so the later `quitAndInstall()` goes straight to the
 * native install. A refusal here costs the operator nothing but the notice.
 *
 * Neither function bounds its own wait. The lifecycle owner
 * (`shutdown-coordinator.ts`) owns every deadline in the restart, names the
 * wait on screen, and lets the operator cancel staging.
 */

/** The surface of Electron's native `autoUpdater` this module uses. */
export interface NativeUpdater {
  checkForUpdates(): void;
  on(event: 'update-downloaded', listener: () => void): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
  removeListener(event: 'update-downloaded', listener: () => void): unknown;
  removeListener(event: 'error', listener: (error: Error) => void): unknown;
}

function reasonOf(error: unknown): string {
  return (
    (error instanceof Error ? error.message : String(error)) ||
    'No reason was reported.'
  );
}

/**
 * Asks Squirrel.Mac to fetch, unzip and verify the downloaded update.
 * Resolves null once it has, or with Squirrel's reason for refusing.
 */
export function stageNativeUpdate(
  native: NativeUpdater
): Promise<string | null> {
  return new Promise(resolve => {
    const finish = (reason: string | null) => {
      native.removeListener('update-downloaded', onDownloaded);
      native.removeListener('error', onError);
      resolve(reason);
    };
    const onDownloaded = () => finish(null);
    const onError = (error: Error) => finish(reasonOf(error));
    native.on('update-downloaded', onDownloaded);
    native.on('error', onError);
    try {
      native.checkForUpdates();
    } catch (error) {
      finish(reasonOf(error));
    }
  });
}

/**
 * Starts the install and resolves only if it fails, with the reason. A
 * successful install ends the process, so the promise is simply never
 * settled; the lifecycle owner's deadline covers an installer that neither
 * fails nor ends the app.
 */
export function watchNativeInstall(
  native: NativeUpdater,
  install: () => void
): Promise<string> {
  return new Promise(resolve => {
    const onError = (error: Error) => {
      native.removeListener('error', onError);
      resolve(reasonOf(error));
    };
    native.on('error', onError);
    try {
      install();
    } catch (error) {
      onError(error instanceof Error ? error : new Error(String(error)));
    }
  });
}
