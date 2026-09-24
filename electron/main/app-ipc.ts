import type {
  BrowserWindow,
  IpcMainEvent,
  NativeTheme,
  WebContents,
} from 'electron';
import fs from 'fs';
import path from 'path';
import {
  refreshNativeWindowBackgrounds,
  rendererAppearanceBootstrapSnapshot,
} from './appearance';
import type {
  ElectronAuthLinkConfig,
  ElectronAuthStartConfig,
} from './auth-coordinator';
import type { AuthDiagnosticRecorder } from './auth-diagnostics';
import type { DiagnosticRecorder } from './diagnostics-log';
import {
  buildDiagnosticsReport,
  type DiagnosticsReport,
  type DiagnosticsReportInput,
} from './diagnostics-report';
import type { TrustedChannels } from './ipc-table';
import type { ElectronAppearancePreferencesV1 } from './settings-store';

/**
 * Main's own channels, as tables keyed by channel name (`ipc-table.ts`):
 * sign-in, the native folder picker, and the app-level reads and reports.
 * Everything a handler reads that is not known until later (the auth runtime,
 * the Session manager, the log) is read at call time through an argument.
 */

interface SafeAuthError {
  name: string;
  message: string;
  status?: number;
  code?: string;
}

interface AuthCoordinatorPort {
  startGoogle(config: ElectronAuthStartConfig): Promise<void>;
  linkGithub(config: ElectronAuthLinkConfig): Promise<void>;
  installSession(
    config: Pick<ElectronAuthStartConfig, 'supabaseUrl' | 'supabaseAnonKey'>,
    tokens: { accessToken: string; refreshToken: string }
  ): Promise<void>;
}

export function authChannels(deps: {
  coordinator: () => AuthCoordinatorPort | null;
  record: AuthDiagnosticRecorder;
  safeAuthError: (error: unknown) => SafeAuthError;
  env: NodeJS.ProcessEnv;
}): TrustedChannels {
  const recordAuthDiagnostic = deps.record;
  return {
    'auth:start-google': async (_event, config: ElectronAuthStartConfig) => {
      const authCoordinator = deps.coordinator();
      if (!authCoordinator) throw new Error('Authentication is not ready.');
      try {
        await authCoordinator.startGoogle(config);
      } catch (error) {
        recordAuthDiagnostic('auth.start_ipc_failure', {
          error: deps.safeAuthError(error),
        });
        throw error;
      }
    },
    'auth:link-github': async (_event, config: ElectronAuthLinkConfig) => {
      const authCoordinator = deps.coordinator();
      if (!authCoordinator) throw new Error('Authentication is not ready.');
      try {
        await authCoordinator.linkGithub(config);
      } catch (error) {
        recordAuthDiagnostic('auth.link_github_ipc_failure', {
          error: deps.safeAuthError(error),
        });
        throw error;
      }
    },
    'auth:install-test-session': async (
      _event,
      config: Pick<ElectronAuthStartConfig, 'supabaseUrl' | 'supabaseAnonKey'>,
      tokens: { accessToken: string; refreshToken: string }
    ) => {
      if (deps.env.EXAWATT_TEST !== '1' || deps.env.EXAWATT_TEST_AUTH !== '1') {
        throw new Error('Test authentication is disabled.');
      }
      const authCoordinator = deps.coordinator();
      if (!authCoordinator) throw new Error('Authentication is not ready.');
      await authCoordinator.installSession(config, tokens);
    },
  };
}

/** Native "Open project directory" picker (ENG-015 S5 P4) — lets the operator
 *  browse to a project instead of typing a path. Returns the chosen absolute
 *  path, or null if cancelled. */
export function dialogChannels(deps: {
  openDirectoryPicker: (
    parent: BrowserWindow | null,
    requestedTitle?: string
  ) => Promise<string | null>;
  windowFor: (sender: WebContents) => BrowserWindow | null;
  env: NodeJS.ProcessEnv;
  pathExists?: (candidate: string) => boolean;
}): TrustedChannels {
  const pathExists = deps.pathExists ?? fs.existsSync;
  return {
    'dialog:openDirectory': async (event, requestedTitle?: string) => {
      // test hook: skip the native modal (which automation can't drive) and
      // return a fixed directory, so ⌘N / Browse can be exercised end-to-end.
      // Double-gated (like the userData redirect) so a stray env var in a normal
      // launch can never silently replace the real folder picker.
      if (deps.env.EXAWATT_TEST && deps.env.EXAWATT_TEST_DIR) {
        return deps.env.EXAWATT_TEST_DIR;
      }
      return deps.openDirectoryPicker(
        deps.windowFor(event.sender),
        requestedTitle
      );
    },
    // does a path exist on THIS machine? — detects a synced Project whose
    // directory is absent here (ENG-015 S5 P5 "locate on this machine")
    'dialog:pathExists': (_event, p: string) => {
      try {
        return typeof p === 'string' && p.length > 0 && pathExists(p);
      } catch {
        return false;
      }
    },
  };
}

/**
 * ENG-025 F5: the anonymized diagnostics bundle, assembled from whatever main
 * currently knows. Deliberately tolerant: a report from a half-started or
 * broken app is exactly the report worth having, so every source degrades to
 * a null or a zero rather than throwing.
 */
export function createDiagnosticsReports(deps: {
  input: () => Omit<DiagnosticsReportInput, 'signedIn'>;
  downloadsPath: () => string;
  showItemInFolder: (filePath: string) => void;
}): {
  collect(signedIn: boolean): DiagnosticsReport;
  save(signedIn: boolean): Promise<{ ok: boolean; filePath: string | null }>;
} {
  function collectDiagnosticsReport(signedIn: boolean): DiagnosticsReport {
    return buildDiagnosticsReport({ ...deps.input(), signedIn });
  }

  /**
   * The signed-out path. ⌘⇧F is a no-op without an account and a broken
   * install is disproportionately signed out, so the report has to be
   * obtainable with no network and no session: write it next to the user's
   * other downloads and put a Finder window in front of them.
   */
  async function saveDiagnosticsReport(
    signedIn: boolean
  ): Promise<{ ok: boolean; filePath: string | null }> {
    try {
      const report = collectDiagnosticsReport(signedIn);
      const stamp = report.generatedAt.replace(/[:.]/g, '-');
      const filePath = path.join(
        deps.downloadsPath(),
        `exawatt-diagnostics-${stamp}.json`
      );
      await fs.promises.writeFile(
        filePath,
        `${JSON.stringify(report, null, 2)}\n`,
        { encoding: 'utf8', mode: 0o600 }
      );
      deps.showItemInFolder(filePath);
      return { ok: true, filePath };
    } catch {
      return { ok: false, filePath: null };
    }
  }

  return { collect: collectDiagnosticsReport, save: saveDiagnosticsReport };
}

interface CapturableWindow {
  isDestroyed(): boolean;
  capturePage(): Promise<{
    getSize(): { width: number; height: number };
    resize(options: { width: number; height: number; quality: 'better' }): {
      toJPEG(quality: number): Buffer;
    };
    toJPEG(quality: number): Buffer;
  }>;
}

export function appChannels(deps: {
  buildInfo: () => unknown;
  reports: ReturnType<typeof createDiagnosticsReports>;
  record: DiagnosticRecorder;
  windowFor: (sender: WebContents) => CapturableWindow | null;
}): TrustedChannels {
  return {
    'app:get-build-info': () => deps.buildInfo(),
    // ENG-025 F5. `signedIn` is renderer-supplied because the Supabase session
    // lives there; it is a self-report in a self-reported bundle, not a claim
    // main can make on its own.
    'app:get-diagnostics-report': (_event, signedIn?: boolean) =>
      deps.reports.collect(Boolean(signedIn)),
    // A route's error boundary caught a render exception the app otherwise
    // recovers from silently — no crash dialog, no process death, nothing in
    // `render-process-gone` for `app_crashed` to observe. Without this the only
    // record was ever the operator's own screenshot; this makes the actual
    // message and stack readable from `logs/main.jsonl` next time instead of
    // requiring live reproduction. `redactDiagnosticValue` (inside
    // `mainDiagnostics`) still clips and scrubs every field before it lands.
    'app:report-render-error': (_event, payload?: unknown) => {
      const report =
        payload && typeof payload === 'object'
          ? (payload as Record<string, unknown>)
          : {};
      deps.record('renderer.error-boundary', {
        message: typeof report.message === 'string' ? report.message : null,
        stack: typeof report.stack === 'string' ? report.stack : null,
        digest: typeof report.digest === 'string' ? report.digest : null,
        pathname: typeof report.pathname === 'string' ? report.pathname : null,
      });
    },
    'app:save-diagnostics-report': async (_event, signedIn?: boolean) =>
      deps.reports.save(Boolean(signedIn)),
    'feedback:capture-screenshot': async event => {
      const win = deps.windowFor(event.sender);
      if (!win || win.isDestroyed()) throw new Error('Window unavailable');
      const image = await win.capturePage();
      const size = image.getSize();
      const bounded =
        size.width > 1600
          ? image.resize({
              width: 1600,
              height: Math.max(
                1,
                Math.round((size.height * 1600) / size.width)
              ),
              quality: 'better',
            })
          : image;
      return `data:image/jpeg;base64,${bounded.toJPEG(78).toString('base64')}`;
    },
  };
}

interface AppearanceWindow {
  isDestroyed(): boolean;
  setBackgroundColor(color: string): void;
  webContents: { send(channel: string, ...args: unknown[]): void };
}

/**
 * The OS appearance, read three ways: a synchronous first-paint snapshot the
 * preload takes before any renderer pixel is chosen, two trusted reads, and a
 * broadcast whenever the OS changes it.
 */
export function createAppearanceIpc(deps: {
  nativeTheme: Pick<
    NativeTheme,
    | 'shouldUseDarkColors'
    | 'shouldUseHighContrastColors'
    | 'shouldUseInvertedColorScheme'
  > & { on(event: 'updated', listener: () => void): unknown };
  getAccentColor: (() => string) | undefined;
  appearancePreference: () => ElectronAppearancePreferencesV1 | undefined;
  safeTheme: boolean;
  allWindows: () => AppearanceWindow[];
  assertTrustedSender: (event: IpcMainEvent) => void;
}): {
  channels: TrustedChannels;
  /** The synchronous first-paint read and the OS-change broadcast. */
  register(
    onSync: (channel: string, listener: (event: IpcMainEvent) => void) => void
  ): void;
} {
  const { nativeTheme } = deps;
  // Optional ENG-032 action overlay input: '#RRGGBB' or null off-macOS.
  // The selected theme remains the default and Project identity stays separate.
  const systemAccentColor = () => {
    try {
      const accent = deps.getAccentColor?.();
      return accent ? `#${accent.slice(0, 6)}` : null;
    } catch {
      return null;
    }
  };
  const appearanceSnapshot = () => ({
    dark: nativeTheme.shouldUseDarkColors,
    highContrast: nativeTheme.shouldUseHighContrastColors,
    invertedColors: nativeTheme.shouldUseInvertedColorScheme,
    systemAccent: systemAccentColor(),
    safeTheme: deps.safeTheme,
  });

  return {
    channels: {
      'app:accent-color': systemAccentColor,
      'app:appearance': appearanceSnapshot,
    },
    register(onSync) {
      // Preload executes before the document's inline first-paint script. A
      // tiny synchronous read is intentional here: it lets Electron's durable
      // settings, including one-launch safe mode, win before any renderer
      // pixels are chosen.
      onSync('app:appearance-bootstrap', event => {
        // Unlike handleTrusted (ipcMain.handle), Electron does not catch a
        // throw from a plain ipcMain.on listener — it becomes an uncaught
        // main-process exception and surfaces as the native crash dialog. A
        // rejected sender here (e.g. querying event.senderFrame
        // mid-navigation) must fail closed into the renderer's existing
        // first-paint recovery theme instead.
        try {
          deps.assertTrustedSender(event);
        } catch {
          event.returnValue = undefined;
          return;
        }
        event.returnValue = rendererAppearanceBootstrapSnapshot(
          deps.appearancePreference(),
          deps.safeTheme,
          nativeTheme.shouldUseDarkColors
        );
      });
      nativeTheme.on('updated', () => {
        refreshNativeWindowBackgrounds(
          deps.appearancePreference(),
          nativeTheme,
          deps.allWindows(),
          { safeTheme: deps.safeTheme }
        );
        const snapshot = appearanceSnapshot();
        for (const win of deps.allWindows()) {
          if (!win.isDestroyed()) {
            win.webContents.send('app:appearance-changed', snapshot);
          }
        }
      });
    },
  };
}
