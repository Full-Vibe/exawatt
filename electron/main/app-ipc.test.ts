import fs from 'fs';
import os from 'os';
import path from 'path';
import type {
  BrowserWindow,
  IpcMainEvent,
  IpcMainInvokeEvent,
  WebContents,
} from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TrustedChannels } from './ipc-table';

// `appearance` reads `settings-store`, which imports Electron's `app`. Nothing
// here needs the binary, so the package is stood down (BUG-057).
vi.mock('electron', () => ({}));

const {
  appChannels,
  authChannels,
  createAppearanceIpc,
  createDiagnosticsReports,
  dialogChannels,
  registerMainChannels,
} = await import('./app-ipc');
const { COMMUNITY_DISTRIBUTION } = await import('@exawatt/core');

const sender = { id: 3 } as unknown as WebContents;
const EVENT = { sender } as IpcMainInvokeEvent;

function call(table: TrustedChannels, channel: string, ...args: unknown[]) {
  return (table[channel] as (...a: unknown[]) => unknown)(EVENT, ...args);
}

let downloads: string;
beforeEach(() => {
  downloads = fs.mkdtempSync(path.join(os.tmpdir(), 'app-ipc-'));
});
afterEach(() => {
  fs.rmSync(downloads, { recursive: true, force: true });
});

describe('authChannels', () => {
  function auth(env: NodeJS.ProcessEnv = {}) {
    const events: Array<{ event: string; fields?: unknown }> = [];
    const installed: unknown[] = [];
    let coordinator: {
      startGoogle(): Promise<void>;
      linkGithub(): Promise<void>;
      installSession(...args: unknown[]): Promise<void>;
    } | null = null;
    const table = authChannels({
      coordinator: () => coordinator as never,
      record: (event, fields) => events.push({ event, fields }),
      safeAuthError: error => ({
        name: 'AuthError',
        message: error instanceof Error ? error.message : String(error),
      }),
      env,
    });
    return {
      table,
      events,
      installed,
      ready: () => {
        coordinator = {
          startGoogle: async () => {
            throw new Error('popup blocked');
          },
          linkGithub: async () => {},
          installSession: async (...args) => {
            installed.push(args);
          },
        };
      },
    };
  }

  it('refuses sign-in before the auth runtime has loaded', async () => {
    const { table } = auth();
    await expect(call(table, 'auth:start-google', {})).rejects.toThrow(
      'Authentication is not ready.'
    );
  });

  it('records a failed start in its safe form and still fails the call', async () => {
    const { table, events, ready } = auth();
    ready();
    await expect(call(table, 'auth:start-google', {})).rejects.toThrow(
      'popup blocked'
    );
    expect(events).toEqual([
      {
        event: 'auth.start_ipc_failure',
        fields: { error: { name: 'AuthError', message: 'popup blocked' } },
      },
    ]);
  });

  it('installs a test session only when both test gates are set', async () => {
    for (const env of [{}, { EXAWATT_TEST: '1' }, { EXAWATT_TEST_AUTH: '1' }]) {
      const { table, ready } = auth(env);
      ready();
      await expect(
        call(table, 'auth:install-test-session', {}, {})
      ).rejects.toThrow('Test authentication is disabled.');
    }
    const { table, ready, installed } = auth({
      EXAWATT_TEST: '1',
      EXAWATT_TEST_AUTH: '1',
    });
    ready();
    await call(table, 'auth:install-test-session', { a: 1 }, { b: 2 });
    expect(installed).toEqual([[{ a: 1 }, { b: 2 }]]);
  });
});

describe('dialogChannels', () => {
  const parent = { id: 'parent' } as unknown as BrowserWindow;

  function dialogs(env: NodeJS.ProcessEnv = {}) {
    const opened: unknown[][] = [];
    const table = dialogChannels({
      openDirectoryPicker: async (...args) => {
        opened.push(args);
        return '/Users/operator/project';
      },
      windowFor: given => (given === sender ? parent : null),
      env,
      pathExists: candidate => candidate === '/exists',
    });
    return { table, opened };
  }

  it('opens the native picker over the asking window', async () => {
    const { table, opened } = dialogs();
    expect(await call(table, 'dialog:openDirectory', 'Open Project')).toBe(
      '/Users/operator/project'
    );
    expect(opened).toEqual([[parent, 'Open Project']]);
  });

  it('answers the fixed test directory only when both test gates are set', async () => {
    const gated = dialogs({ EXAWATT_TEST: '1', EXAWATT_TEST_DIR: '/tmp/x' });
    expect(await call(gated.table, 'dialog:openDirectory')).toBe('/tmp/x');
    expect(gated.opened).toEqual([]);

    const stray = dialogs({ EXAWATT_TEST_DIR: '/tmp/x' });
    await call(stray.table, 'dialog:openDirectory');
    expect(stray.opened).toHaveLength(1);
  });

  it('answers whether a path exists here, and false for anything not a path', async () => {
    const { table } = dialogs();
    expect(await call(table, 'dialog:pathExists', '/exists')).toBe(true);
    expect(await call(table, 'dialog:pathExists', '/missing')).toBe(false);
    expect(await call(table, 'dialog:pathExists', '')).toBe(false);
    expect(await call(table, 'dialog:pathExists', 42)).toBe(false);
  });
});

describe('createDiagnosticsReports', () => {
  const input = () => ({
    build: { sha: 'abc', branch: 'master', delivery: 'dogfood' },
    appVersion: '0.1.13',
    packaged: true,
    installPath: '/Applications/Exawatt.app',
    logDirectory: path.join(downloads, 'no-logs'),
    updateStatus: null,
    liveSessions: 2,
    locale: 'en-US',
  });

  it('saves the report next to the downloads, owner-only, and shows it in Finder', async () => {
    const shown: string[] = [];
    const reports = createDiagnosticsReports({
      input,
      downloadsPath: () => downloads,
      showItemInFolder: file => shown.push(file),
    });

    const saved = await reports.save(false);

    expect(saved.ok).toBe(true);
    expect(shown).toEqual([saved.filePath]);
    expect(path.dirname(saved.filePath!)).toBe(downloads);
    expect(fs.statSync(saved.filePath!).mode & 0o777).toBe(0o600);
    const written = JSON.parse(fs.readFileSync(saved.filePath!, 'utf8'));
    expect(written.session).toEqual({ signedIn: false, liveSessions: 2 });
    expect(reports.collect(true).session.signedIn).toBe(true);
  });

  it('reports a save it could not make instead of throwing', async () => {
    const reports = createDiagnosticsReports({
      input,
      downloadsPath: () => path.join(downloads, 'missing', 'dir'),
      showItemInFolder: () => {},
    });
    expect(await reports.save(true)).toEqual({ ok: false, filePath: null });
  });
});

describe('appChannels', () => {
  function app(window: unknown) {
    const recorded: Array<{ event: string; fields?: unknown }> = [];
    const table = appChannels({
      buildInfo: () => ({ sha: 'abc' }),
      reports: {
        collect: signedIn => ({ signedIn }) as never,
        save: async signedIn => ({ ok: signedIn, filePath: null }),
      },
      record: (event, fields) => recorded.push({ event, fields }),
      windowFor: () => window as never,
    });
    return { table, recorded };
  }

  it('records a caught render error, keeping only string fields', async () => {
    const { table, recorded } = app(null);
    await call(table, 'app:report-render-error', {
      message: 'boom',
      stack: 42,
      pathname: '/fleet',
      extra: 'dropped',
    });
    await call(table, 'app:report-render-error', 'not an object');
    expect(recorded).toEqual([
      {
        event: 'renderer.error-boundary',
        fields: {
          message: 'boom',
          stack: null,
          digest: null,
          pathname: '/fleet',
        },
      },
      {
        event: 'renderer.error-boundary',
        fields: { message: null, stack: null, digest: null, pathname: null },
      },
    ]);
  });

  it('bounds a feedback screenshot to 1600 pixels wide', async () => {
    const resized: unknown[] = [];
    const image = {
      getSize: () => ({ width: 3200, height: 2000 }),
      resize: (options: unknown) => {
        resized.push(options);
        return { toJPEG: () => Buffer.from('small') };
      },
      toJPEG: () => Buffer.from('large'),
    };
    const { table } = app({
      isDestroyed: () => false,
      capturePage: async () => image,
    });

    expect(await call(table, 'feedback:capture-screenshot')).toBe(
      `data:image/jpeg;base64,${Buffer.from('small').toString('base64')}`
    );
    expect(resized).toEqual([{ width: 1600, height: 1000, quality: 'better' }]);
  });

  it('refuses a screenshot of a window that is gone', async () => {
    const { table } = app({ isDestroyed: () => true });
    await expect(call(table, 'feedback:capture-screenshot')).rejects.toThrow(
      'Window unavailable'
    );
  });

  it('coerces the renderer-reported sign-in state to a boolean', async () => {
    const { table } = app(null);
    expect(await call(table, 'app:get-diagnostics-report', 'yes')).toEqual({
      signedIn: true,
    });
    expect(await call(table, 'app:save-diagnostics-report')).toEqual({
      ok: false,
      filePath: null,
    });
  });
});

describe('createAppearanceIpc', () => {
  function appearance(trusted: boolean) {
    const listeners: Array<() => void> = [];
    const sent: unknown[][] = [];
    const theme = {
      shouldUseDarkColors: true,
      shouldUseHighContrastColors: false,
      shouldUseInvertedColorScheme: false,
      on: (_event: 'updated', listener: () => void) => listeners.push(listener),
    };
    const window = {
      isDestroyed: () => false,
      setBackgroundColor: () => {},
      webContents: { send: (...args: unknown[]) => sent.push(args) },
    };
    const ipc = createAppearanceIpc({
      nativeTheme: theme,
      getAccentColor: () => '0a84ffff',
      appearancePreference: () => undefined,
      safeTheme: false,
      allWindows: () => [window],
      assertTrustedSender: () => {
        if (!trusted) throw new Error('untrusted');
      },
    });
    const sync = new Map<string, (event: IpcMainEvent) => void>();
    ipc.register((channel, listener) => sync.set(channel, listener));
    return { ipc, sync, listeners, sent, theme };
  }

  it('answers the first-paint read for a trusted sender', () => {
    const { sync } = appearance(true);
    const event = {} as IpcMainEvent;
    sync.get('app:appearance-bootstrap')!(event);
    expect(event.returnValue).toMatchObject({ dark: true, safeTheme: false });
  });

  it('fails an untrusted first-paint read closed instead of throwing', () => {
    const { sync } = appearance(false);
    const event = { returnValue: 'stale' } as IpcMainEvent;
    expect(() => sync.get('app:appearance-bootstrap')!(event)).not.toThrow();
    expect(event.returnValue).toBeUndefined();
  });

  it('reports the accent as #RRGGBB and broadcasts every OS appearance change', () => {
    const { ipc, listeners, sent, theme } = appearance(true);
    expect(call(ipc.channels, 'app:accent-color')).toBe('#0a84ff');

    theme.shouldUseDarkColors = false;
    listeners.forEach(listener => listener());

    expect(sent).toEqual([
      [
        'app:appearance-changed',
        {
          dark: false,
          highContrast: false,
          invertedColors: false,
          systemAccent: '#0a84ff',
          safeTheme: false,
        },
      ],
    ]);
  });
});

describe('registerMainChannels', () => {
  function register(tables: TrustedChannels[] = []) {
    const trusted: string[] = [];
    const sync: string[] = [];
    registerMainChannels({
      electron: {
        app: {
          getVersion: () => '0.1.13',
          isPackaged: true,
          getAppPath: () => '/Applications/Exawatt.app',
          getPath: () => downloads,
          getLocale: () => 'en-US',
        },
        BrowserWindow: {
          fromWebContents: () => null,
          getAllWindows: () => [],
        },
        dialog: {
          showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
        },
        shell: { showItemInFolder: () => {} },
        nativeTheme: {
          shouldUseDarkColors: false,
          shouldUseHighContrastColors: false,
          shouldUseInvertedColorScheme: false,
          on: () => {},
        },
        systemPreferences: {},
        ipcMain: { on: channel => sync.push(channel) },
      } as never,
      handle: channel => trusted.push(channel),
      assertTrustedSender: () => {},
      build: {
        buildInfo: { sha: 'abc', branch: 'master', delivery: 'dogfood' },
        distribution: {
          contract: COMMUNITY_DISTRIBUTION,
          canonical: '{}',
          digest: 'digest',
        },
        identity: { productName: 'Exawatt Community' },
      },
      runtime: {
        authCoordinator: null,
        recordAuthDiagnostic: () => {},
        safeAuthError: () => ({ name: 'Error', message: 'x' }),
        currentUpdateStatus: () => null,
        liveSessionCount: () => 0,
      },
      env: {},
      safeTheme: false,
      appearancePreference: () => undefined,
      record: () => {},
      tables,
    });
    return { trusted, sync };
  }

  it("registers main's own tables and the tables other owners hand in, through the trusted door", () => {
    const { trusted, sync } = register([
      { 'menu:sync-availability': () => {} },
    ]);

    expect(trusted).toEqual(
      expect.arrayContaining([
        'auth:start-google',
        'dialog:openDirectory',
        'app:get-build-info',
        'app:appearance',
        'menu:sync-availability',
      ])
    );
    expect(new Set(trusted).size).toBe(trusted.length);
    expect(sync).toEqual(['app:appearance-bootstrap']);
  });

  it('refuses a handed-in table that claims one of main’s channels', () => {
    expect(() => register([{ 'app:get-build-info': () => {} }])).toThrow(
      'IPC channel app:get-build-info is registered twice'
    );
  });
});
