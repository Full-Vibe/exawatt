import path from 'path';
import type { AuthDiagnosticRecorder } from './auth-diagnostics';

/**
 * `exawatt://` deep links: protocol registration, and routing a link to the
 * window that can act on it. Any local process can invoke the scheme, so a
 * link is recognized before anything reaches the renderer, and a link that
 * arrives before the workspace can take it is held until the workspace loads.
 *
 * The auth runtime loads after the window exists, so every auth dependency is
 * read at call time rather than captured.
 */

export interface DeepLinkWindow {
  isDestroyed(): boolean;
  isMinimized(): boolean;
  restore(): void;
  focus(): void;
  webContents: {
    getURL(): string;
    send(channel: string, ...args: unknown[]): void;
  };
}

interface SafeAuthError {
  name: string;
  message: string;
  status?: number;
  code?: string;
}

export interface DeepLinkDependencies {
  /** Null for a distribution that claims no URL scheme. */
  protocolScheme: string | null;
  window: () => DeepLinkWindow | null;
  /** Null until the auth runtime loads. */
  authCoordinator: () => { exchangeCode(code: string): Promise<void> } | null;
  /** Null until the auth runtime loads, which makes an early link queue
   *  rather than arrive unvetted. */
  isLinkOutcome: () => ((value: unknown) => boolean) | null;
  safeAuthError: (error: unknown) => SafeAuthError;
  isWorkspaceTarget: (url: string) => boolean;
  record: AuthDiagnosticRecorder;
  logError?: (message: string, detail: unknown) => void;
}

export interface DeepLinkRouter {
  handle(url: string): void;
  /** Delivers a held link once the window has loaded `currentUrl`. */
  deliverPending(currentUrl: string): void;
}

export function createDeepLinkRouter(
  deps: DeepLinkDependencies
): DeepLinkRouter {
  const { protocolScheme } = deps;
  const logError =
    deps.logError ?? ((message, detail) => console.error(message, detail));
  let pendingDeepLinkUrl: string | null = null;

  function handleDeepLink(url: string): void {
    const recordAuthDiagnostic = deps.record;
    if (!protocolScheme || !url.startsWith(`${protocolScheme}://`)) {
      recordAuthDiagnostic('auth.callback.rejected_scheme');
      return;
    }

    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch (error) {
      recordAuthDiagnostic('auth.callback.parse_failure', {
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    // exawatt://auth/callback?code=...  or  ?link=<outcome>
    if (parsed.hostname === 'auth' && parsed.pathname === '/callback') {
      const code = parsed.searchParams.get('code');
      const linkOutcome = parsed.searchParams.get('link');
      const mainWindow = deps.window();
      const authCoordinator = deps.authCoordinator();
      recordAuthDiagnostic('auth.callback.received', {
        host: parsed.hostname,
        path: parsed.pathname,
        queryNames: [...new Set(parsed.searchParams.keys())].sort(),
        hasCode: Boolean(code),
        codeLength: code?.length ?? 0,
        windowReady: Boolean(mainWindow && !mainWindow.isDestroyed()),
        coordinatorReady: Boolean(authCoordinator),
      });

      if (code) {
        if (
          mainWindow &&
          !mainWindow.isDestroyed() &&
          authCoordinator &&
          deps.isWorkspaceTarget(mainWindow.webContents.getURL())
        ) {
          if (mainWindow.isMinimized()) mainWindow.restore();
          mainWindow.focus();
          void completeElectronAuth(code);
        } else {
          // Window not ready — queue for delivery after load
          pendingDeepLinkUrl = url;
          recordAuthDiagnostic('auth.callback.queued');
        }
      } else if (linkOutcome) {
        // An identity link that Supabase answered without a code — including
        // "already linked", which is the state the operator wanted. The surface
        // that started it owns the verdict, so main only relays the token.
        const isElectronAuthLinkOutcome = deps.isLinkOutcome();
        if (
          mainWindow &&
          !mainWindow.isDestroyed() &&
          isElectronAuthLinkOutcome &&
          deps.isWorkspaceTarget(mainWindow.webContents.getURL())
        ) {
          if (!isElectronAuthLinkOutcome(linkOutcome)) {
            recordAuthDiagnostic('auth.callback.link_outcome_rejected');
            return;
          }
          if (mainWindow.isMinimized()) mainWindow.restore();
          mainWindow.focus();
          mainWindow.webContents.send('auth:link-outcome', linkOutcome);
          recordAuthDiagnostic('auth.callback.link_outcome_sent', {
            outcome: linkOutcome,
          });
        } else {
          pendingDeepLinkUrl = url;
          recordAuthDiagnostic('auth.callback.queued');
        }
      } else {
        recordAuthDiagnostic('auth.callback.missing_code');
      }
    } else {
      recordAuthDiagnostic('auth.callback.ignored_route', {
        host: parsed.hostname,
        path: parsed.pathname,
      });
    }
  }

  async function completeElectronAuth(code: string): Promise<void> {
    const recordAuthDiagnostic = deps.record;
    const win = deps.window();
    if (!win || win.isDestroyed()) return;

    try {
      const authCoordinator = deps.authCoordinator();
      if (!authCoordinator) throw new Error('Authentication is not ready.');
      await authCoordinator.exchangeCode(code);
      if (!win.isDestroyed()) {
        win.webContents.send('auth:complete');
        recordAuthDiagnostic('auth.renderer_completion_sent');
      } else {
        recordAuthDiagnostic('auth.renderer_completion_skipped_destroyed');
      }
    } catch (error) {
      const safeError = deps.safeAuthError(error);
      recordAuthDiagnostic('auth.completion_failure', { error: safeError });
      logError('[auth] Electron OAuth code exchange failed', safeError);
      if (!win.isDestroyed()) win.webContents.send('auth:error', safeError);
    }
  }

  return {
    handle: handleDeepLink,
    deliverPending(currentUrl) {
      if (pendingDeepLinkUrl && deps.isWorkspaceTarget(currentUrl)) {
        handleDeepLink(pendingDeepLinkUrl);
        pendingDeepLinkUrl = null;
      }
    },
  };
}

export interface DeepLinkApp {
  setAsDefaultProtocolClient(
    protocol: string,
    path?: string,
    args?: string[]
  ): boolean;
  on(
    event: 'open-url',
    listener: (event: { preventDefault(): void }, url: string) => void
  ): unknown;
}

/**
 * Claims the scheme and routes `open-url` to the router. Registered before
 * `app.whenReady()` so a link that launches the app is not lost. A community
 * build claims no scheme and registers nothing.
 */
export function registerDeepLinkProtocol(
  app: DeepLinkApp,
  protocolScheme: string | null,
  router: DeepLinkRouter,
  launch: { defaultApp: boolean; execPath: string; argv: readonly string[] }
): void {
  if (!protocolScheme) return;
  // In dev (process.defaultApp), pass execPath + script so macOS can re-launch correctly.
  if (launch.defaultApp) {
    if (launch.argv.length >= 2) {
      app.setAsDefaultProtocolClient(protocolScheme, launch.execPath, [
        path.resolve(launch.argv[1]),
      ]);
    }
  } else {
    app.setAsDefaultProtocolClient(protocolScheme);
  }

  // macOS: deep links on a running app arrive via open-url.
  app.on('open-url', (event, url) => {
    event.preventDefault();
    router.handle(url);
  });
}
