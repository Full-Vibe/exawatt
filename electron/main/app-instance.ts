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
 * profile hands itself to that one and leaves: it brings the running window
 * forward, forwards any `exawatt://` link macOS delivered to it, and exits
 * without touching the profile, claiming the URL scheme or starting a server.
 * `main.ts` therefore asks before anything else in main is evaluated.
 */

export interface InstanceApp {
  requestSingleInstanceLock(additionalData?: Record<string, unknown>): boolean;
  setActivationPolicy(policy: 'regular' | 'accessory' | 'prohibited'): void;
  on(
    event: 'open-url',
    listener: (event: { preventDefault(): void }, url: string) => void
  ): unknown;
  whenReady(): Promise<unknown>;
  exit(exitCode?: number): void;
}

/** What a second launch carries to the running one. */
interface SecondLaunch {
  links: string[];
}

const MAX_LINKS = 8;
const MAX_LINK_LENGTH = 4096;

/**
 * Asks for this profile's lock. `true`: this process is the instance and main
 * continues. `false`: another process holds it, this one has handed itself
 * over and exits once macOS has delivered whatever link launched it.
 */
export function claimAppInstance(
  app: InstanceApp,
  options: {
    platform: NodeJS.Platform;
    /** Said on stderr, for whoever launched this copy from a terminal. */
    report: (line: string) => void;
    productName: string;
    userData: string;
  }
): boolean {
  if (app.requestSingleInstanceLock()) return true;
  // A copy that is leaving never takes the Dock or the keyboard.
  if (options.platform === 'darwin') app.setActivationPolicy('accessory');
  // macOS delivers the link that launched this copy between
  // will-finish-launching and ready, after the lock request above, so links
  // follow in a second message once they have all arrived.
  const links: string[] = [];
  app.on('open-url', (event, url) => {
    event.preventDefault();
    links.push(url);
  });
  void app.whenReady().then(() => {
    if (links.length > 0) {
      const handOff: SecondLaunch = { links: links.slice(0, MAX_LINKS) };
      app.requestSingleInstanceLock({ ...handOff });
    }
    options.report(
      `${options.productName} is already running with ${options.userData}; ` +
        'this launch was handed to it.'
    );
    app.exit(0);
  });
  return false;
}

/** The links a second launch forwarded. Any local process can reach the
 *  lock's socket, so the payload is read as untrusted and bounded here; the
 *  deep-link router still vets every link it is given. */
export function secondLaunchLinks(additionalData: unknown): string[] {
  const links = (additionalData as Partial<SecondLaunch> | null)?.links;
  if (!Array.isArray(links)) return [];
  return links
    .filter(
      (link): link is string =>
        typeof link === 'string' && link.length <= MAX_LINK_LENGTH
    )
    .slice(0, MAX_LINKS);
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
  on(
    event: 'second-instance',
    listener: (
      event: unknown,
      argv: string[],
      workingDirectory: string,
      additionalData: unknown
    ) => void
  ): unknown;
}

/** The running instance's side: every later launch over this profile brings
 *  the window forward and has its links opened through the deep-link entry. */
export function routeSecondLaunches(
  app: SecondInstanceApp,
  deps: {
    bringForward: () => BringForwardResult;
    openLink: (url: string) => void;
    record: (event: string, fields: Record<string, unknown>) => void;
  }
): void {
  app.on('second-instance', (_event, _argv, _workingDirectory, data) => {
    const links = secondLaunchLinks(data);
    const presented = deps.bringForward();
    deps.record('instance.second-launch', { links: links.length, presented });
    for (const link of links) deps.openLink(link);
  });
}
