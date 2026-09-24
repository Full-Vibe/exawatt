import { describe, expect, it } from 'vitest';
import {
  createDeepLinkRouter,
  registerDeepLinkProtocol,
  type DeepLinkApp,
  type DeepLinkDependencies,
  type DeepLinkWindow,
} from './deep-link';

const WORKSPACE = 'http://127.0.0.1:23456/workspace';

function fakeWindow(url = WORKSPACE) {
  const sent: Array<[string, ...unknown[]]> = [];
  const calls: string[] = [];
  const window: DeepLinkWindow & { url: string; minimized: boolean } = {
    url,
    minimized: false,
    isDestroyed: () => false,
    isMinimized: () => window.minimized,
    restore: () => {
      calls.push('restore');
      window.minimized = false;
    },
    focus: () => calls.push('focus'),
    webContents: {
      getURL: () => window.url,
      send: (channel, ...args) => sent.push([channel, ...args]),
    },
  };
  return { window, sent, calls };
}

function router(overrides: Partial<DeepLinkDependencies> = {}) {
  const events: Array<{ event: string; fields?: unknown }> = [];
  const exchanged: string[] = [];
  const state = {
    window: null as DeepLinkWindow | null,
    coordinatorReady: true,
    exchangeFails: false,
    outcomeCheckReady: true,
  };
  const deps: DeepLinkDependencies = {
    protocolScheme: 'exawatt',
    window: () => state.window,
    authCoordinator: () =>
      state.coordinatorReady
        ? {
            exchangeCode: async code => {
              exchanged.push(code);
              if (state.exchangeFails) throw new Error('invalid grant');
            },
          }
        : null,
    isLinkOutcome: () =>
      state.outcomeCheckReady
        ? (value: unknown) => value === 'linked' || value === 'already-linked'
        : null,
    safeAuthError: error => ({
      name: 'AuthError',
      message: error instanceof Error ? error.message : String(error),
    }),
    isWorkspaceTarget: target =>
      new URL(target).origin === new URL(WORKSPACE).origin,
    record: (event, fields) => events.push({ event, fields }),
    logError: () => {},
    ...overrides,
  };
  return {
    links: createDeepLinkRouter(deps),
    state,
    events,
    exchanged,
    names: () => events.map(entry => entry.event),
  };
}

const settled = () => new Promise(resolve => setImmediate(resolve));

describe('createDeepLinkRouter', () => {
  it('refuses a link on any other scheme, and every link when the build claims none', () => {
    const claimed = router();
    claimed.links.handle('https://exawatt.ai/auth/callback?code=abc');
    expect(claimed.names()).toEqual(['auth.callback.rejected_scheme']);

    const unclaimed = router({ protocolScheme: null });
    unclaimed.links.handle('exawatt://auth/callback?code=abc');
    expect(unclaimed.names()).toEqual(['auth.callback.rejected_scheme']);
  });

  it('records a link that does not parse', () => {
    const { links, names } = router();
    links.handle('exawatt://[');
    expect(names()).toEqual(['auth.callback.parse_failure']);
  });

  it('completes sign-in in a ready workspace window, bringing it forward', async () => {
    const { links, state, exchanged, names } = router();
    const { window, sent, calls } = fakeWindow();
    window.minimized = true;
    state.window = window;

    links.handle('exawatt://auth/callback?code=abc');
    await settled();

    expect(exchanged).toEqual(['abc']);
    expect(calls).toEqual(['restore', 'focus']);
    expect(sent).toEqual([['auth:complete']]);
    expect(names()).toEqual([
      'auth.callback.received',
      'auth.renderer_completion_sent',
    ]);
  });

  it('tells the renderer a failed exchange in its safe form', async () => {
    const { links, state } = router();
    const { window, sent: delivered } = fakeWindow();
    state.window = window;
    state.exchangeFails = true;

    links.handle('exawatt://auth/callback?code=abc');
    await settled();

    expect(delivered).toEqual([
      ['auth:error', { name: 'AuthError', message: 'invalid grant' }],
    ]);
  });

  it('holds a code that arrives before the workspace, and delivers it once the workspace loads', async () => {
    const { links, state, exchanged, names } = router();
    const { window, sent } = fakeWindow('data:text/html,launch');
    state.window = window;

    links.handle('exawatt://auth/callback?code=early');
    expect(names()).toEqual(['auth.callback.received', 'auth.callback.queued']);

    links.deliverPending('data:text/html,launch');
    await settled();
    expect(exchanged).toEqual([]);

    window.url = WORKSPACE;
    links.deliverPending(WORKSPACE);
    await settled();
    expect(exchanged).toEqual(['early']);
    expect(sent).toEqual([['auth:complete']]);

    links.deliverPending(WORKSPACE);
    await settled();
    expect(exchanged).toEqual(['early']);
  });

  it('holds a code while the auth runtime is still loading', () => {
    const { links, state, exchanged, names } = router();
    state.window = fakeWindow().window;
    state.coordinatorReady = false;

    links.handle('exawatt://auth/callback?code=abc');

    expect(exchanged).toEqual([]);
    expect(names()).toEqual(['auth.callback.received', 'auth.callback.queued']);
  });

  it('relays a recognized identity-link outcome and refuses an unrecognized one', () => {
    const { links, state, names } = router();
    const { window, sent } = fakeWindow();
    state.window = window;

    links.handle('exawatt://auth/callback?link=already-linked');
    links.handle('exawatt://auth/callback?link=<script>');

    expect(sent).toEqual([['auth:link-outcome', 'already-linked']]);
    expect(names()).toEqual([
      'auth.callback.received',
      'auth.callback.link_outcome_sent',
      'auth.callback.received',
      'auth.callback.link_outcome_rejected',
    ]);
  });

  it('holds an outcome until it can be vetted rather than relaying it unchecked', () => {
    const { links, state, names } = router();
    const { window, sent } = fakeWindow();
    state.window = window;
    state.outcomeCheckReady = false;

    links.handle('exawatt://auth/callback?link=linked');

    expect(sent).toEqual([]);
    expect(names()).toEqual(['auth.callback.received', 'auth.callback.queued']);
  });

  it('records a callback with nothing to act on, and ignores other routes', () => {
    const { links, state, names } = router();
    state.window = fakeWindow().window;

    links.handle('exawatt://auth/callback');
    links.handle('exawatt://settings/privacy');

    expect(names()).toEqual([
      'auth.callback.received',
      'auth.callback.missing_code',
      'auth.callback.ignored_route',
    ]);
  });
});

describe('registerDeepLinkProtocol', () => {
  function fakeApp() {
    const registered: unknown[][] = [];
    let openUrl:
      | ((event: { preventDefault(): void }, url: string) => void)
      | null = null;
    const app: DeepLinkApp = {
      setAsDefaultProtocolClient: (...args: unknown[]) => {
        registered.push(args);
        return true;
      },
      on: (_event, listener) => {
        openUrl = listener;
      },
    };
    return { app, registered, openUrl: () => openUrl };
  }

  const packaged = {
    defaultApp: false,
    execPath: '/Applications/Exawatt.app/Contents/MacOS/Exawatt',
    argv: ['/Applications/Exawatt.app/Contents/MacOS/Exawatt'],
  };

  it('claims nothing for a build without a scheme', () => {
    const { app, registered, openUrl } = fakeApp();
    registerDeepLinkProtocol(app, null, router().links, packaged);
    expect(registered).toEqual([]);
    expect(openUrl()).toBeNull();
  });

  it('claims the scheme for the packaged app and routes open-url', () => {
    const handled: string[] = [];
    const { app, registered, openUrl } = fakeApp();
    registerDeepLinkProtocol(
      app,
      'exawatt',
      { handle: url => handled.push(url), deliverPending: () => {} },
      packaged
    );
    let prevented = false;
    openUrl()!(
      {
        preventDefault: () => {
          prevented = true;
        },
      },
      'exawatt://auth/callback?code=abc'
    );

    expect(registered).toEqual([['exawatt']]);
    expect(prevented).toBe(true);
    expect(handled).toEqual(['exawatt://auth/callback?code=abc']);
  });

  it('registers the development launcher with its script so macOS can relaunch it', () => {
    const { app, registered } = fakeApp();
    registerDeepLinkProtocol(app, 'exawatt', router().links, {
      defaultApp: true,
      execPath: '/repo/node_modules/electron/dist/Electron',
      argv: [
        '/repo/node_modules/electron/dist/Electron',
        '/repo/dist-electron/main/main.js',
      ],
    });
    expect(registered).toEqual([
      [
        'exawatt',
        '/repo/node_modules/electron/dist/Electron',
        ['/repo/dist-electron/main/main.js'],
      ],
    ]);
  });
});
