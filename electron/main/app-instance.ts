/**
 * One running Exawatt per profile (BUG-305).
 *
 * Electron's single-instance lock lives in the `userData` directory, so it is
 * the profile's lock, not the product's: the installed app, a development
 * worktree over the community profile and every eval over its own scratch
 * profile each hold their own and run side by side. Two copies over ONE
 * profile cannot: they would share its workspace, Sessions and history, which
 * is how an August build left on disk refused a resume the current build had
 * started.
 *
 * The first process to ask holds the lock. A later launch over the same
 * profile notifies that one, which brings its window forward, and exits at
 * once, before it touches the profile, claims the URL scheme or starts a
 * server; `main.ts` therefore asks before anything else in main is evaluated.
 * It has no link to forward: macOS delivers an `exawatt://` link to the
 * running app with Exawatt's bundle id, through its own deep-link entry, even
 * when it also launches a copy from another path. And it could not wait for
 * one: Electron 43 never makes a process that lost the lock `ready`.
 */

interface InstanceApp {
  requestSingleInstanceLock(): boolean;
  exit(exitCode?: number): void;
}

/**
 * Asks for this profile's lock. `true`: this process is the instance and main
 * continues. Otherwise the running instance has been told, and this process
 * says so on stderr and exits.
 */
export function claimAppInstance(
  app: InstanceApp,
  options: {
    /** For whoever launched this copy from a terminal. */
    report: (line: string) => void;
    productName: string;
    userData: string;
  }
): boolean {
  if (app.requestSingleInstanceLock()) return true;
  options.report(
    `${options.productName} is already running with ${options.userData}; ` +
      'this launch was handed to it.'
  );
  app.exit(0);
  return false;
}

/** How the running instance answered: it opened a window, focused its
 *  window, showed it without taking focus, or (a hidden automated launch, or
 *  a quit in progress) changed nothing on screen. */
export type BringForwardResult =
  | 'opened'
  | 'focused'
  | 'shown'
  | 'hidden'
  | 'quitting';

interface SecondInstanceApp {
  on(event: 'second-instance', listener: () => void): unknown;
}

/** The running instance's side: every later launch over this profile is the
 *  operator asking for Exawatt, so it brings the window forward. */
export function routeSecondLaunches(
  app: SecondInstanceApp,
  deps: {
    bringForward: () => BringForwardResult;
    record: (event: string, fields: Record<string, unknown>) => void;
  }
): void {
  app.on('second-instance', () => {
    deps.record('instance.second-launch', { presented: deps.bringForward() });
  });
}
