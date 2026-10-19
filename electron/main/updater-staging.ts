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
 * wait on screen, and lets the operator cancel staging; its `AbortSignal`
 * ends a caller's wait here.
 *
 * One Squirrel check is one operation (the 0.1.22 review: each abandoned
 * restart used to leave its own listener pair behind, so a late answer
 * flipped `staged` under a notice that said the update had failed). The
 * check holds one listener pair from `checkForUpdates()` until Squirrel
 * answers or the call throws, and removes it on each. A caller that stops
 * waiting leaves the check running, because Squirrel cannot be called off;
 * a retry joins it rather than asking twice. Squirrel's answer, however
 * late, lands in `staged` and is reported to `events` marked `late` when
 * no caller was still waiting, so the updater can make its status say so.
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
 * A wait the caller may abandon: `start` begins it and returns its cleanup,
 * which runs exactly once, whether the wait settles (even synchronously,
 * inside `start`) or `signal` aborts first, in which case it rejects with
 * the signal's reason.
 */
function abandonable<T>(
  signal: AbortSignal | undefined,
  start: (settle: (value: T) => void) => () => void
): Promise<T> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    let ended = false;
    let cleanup: (() => void) | null = null;
    const end = () => {
      ended = true;
      signal?.removeEventListener('abort', abandoned);
      cleanup?.();
    };
    const abandoned = () => {
      if (ended) return;
      end();
      reject(signal?.reason);
    };
    signal?.addEventListener('abort', abandoned, { once: true });
    const release = start(value => {
      if (ended) return;
      end();
      resolve(value);
    });
    if (ended) release();
    else cleanup = release;
  });
}

interface NativeStagingEvents {
  /** Squirrel took the update. `late` when no caller was still waiting. */
  accepted(answer: { late: boolean }): void;
  refused(reason: string, answer: { late: boolean }): void;
}

export interface NativeStaging {
  /**
   * Asks Squirrel.Mac to fetch, unzip and verify the downloaded update.
   * Resolves null once it has (at once when it already has), or with
   * Squirrel's reason for refusing; rejects with `signal`'s reason if the
   * caller stops waiting first.
   */
  stage(signal?: AbortSignal): Promise<string | null>;
  readonly staged: boolean;
  /** A new download is one Squirrel has not seen. */
  reset(): void;
}

export function createNativeStaging(
  native: NativeUpdater,
  events: NativeStagingEvents
): NativeStaging {
  let staged = false;
  /** Callers waiting on the check in flight; null when none is. */
  let waiting: Set<(reason: string | null) => void> | null = null;

  const answer = (reason: string | null) => {
    const callers = waiting ?? new Set();
    waiting = null;
    native.removeListener('update-downloaded', onDownloaded);
    native.removeListener('error', onError);
    const late = callers.size === 0;
    if (reason === null) {
      staged = true;
      events.accepted({ late });
    } else {
      events.refused(reason, { late });
    }
    for (const caller of callers) caller(reason);
  };
  const onDownloaded = () => answer(null);
  const onError = (error: Error) => answer(reasonOf(error));

  return {
    stage(signal) {
      if (staged) return Promise.resolve(null);
      return abandonable<string | null>(signal, settle => {
        const first = waiting === null;
        const callers = (waiting ??= new Set());
        callers.add(settle);
        if (first) {
          native.on('update-downloaded', onDownloaded);
          native.on('error', onError);
          try {
            native.checkForUpdates();
          } catch (error) {
            answer(reasonOf(error));
          }
        }
        return () => callers.delete(settle);
      });
    },
    get staged() {
      return staged;
    },
    reset() {
      staged = false;
    },
  };
}

/**
 * Starts the install and resolves only if it fails, with the reason. A
 * successful install ends the process, so the promise is simply never
 * settled; the lifecycle owner's deadline covers an installer that neither
 * fails nor ends the app, and its `signal` removes the listener.
 */
export function watchNativeInstall(
  native: NativeUpdater,
  install: () => void,
  signal?: AbortSignal
): Promise<string> {
  return abandonable<string>(signal, settle => {
    const onError = (error: Error) => settle(reasonOf(error));
    native.on('error', onError);
    try {
      install();
    } catch (error) {
      settle(reasonOf(error));
    }
    return () => native.removeListener('error', onError);
  });
}
