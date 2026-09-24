import { COMMUNITY_DISTRIBUTION } from '@exawatt/core';
import type { DistributionContractV2 } from '@exawatt/core/distribution';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Bootstrap against fakes at every boundary it crosses: the lazily loaded
 * runtime modules are injected, and the statically imported registrars and
 * services are replaced so the test can see the ORDER things happen in and
 * which services were built with what.
 */
const world = vi.hoisted(() => ({
  log: [] as string[],
  planAccountOptions: [] as Array<Record<string, unknown>>,
  scannerThrows: false,
}));

vi.mock('electron', () => ({}));
vi.mock('./analytics-ipc', () => ({
  registerAnalyticsIPC: () => world.log.push('ipc:analytics'),
}));
vi.mock('./system-shortcuts', () => ({
  registerSystemShortcutIPC: () => world.log.push('ipc:system-shortcuts'),
}));
vi.mock('./operator-stats-ipc', () => ({
  registerOperatorStatsIPC: () => world.log.push('ipc:operator-stats'),
}));
vi.mock('./consumption-ipc', () => ({
  registerConsumptionIPC: () => world.log.push('ipc:consumption'),
}));
vi.mock('./consumption/scanner-service', () => ({
  ConsumptionScannerService: class {
    constructor() {
      if (world.scannerThrows) throw new Error('scanner is not a constructor');
    }
    dispose = async () => void world.log.push('dispose:scanner');
  },
}));
vi.mock('./consumption/claude-plan-account', async importOriginal => ({
  ...(await importOriginal<
    typeof import('./consumption/claude-plan-account')
  >()),
  ClaudePlanAccountService: class {
    constructor(options: Record<string, unknown>) {
      world.planAccountOptions.push(options);
    }
    dispose = () => void world.log.push('dispose:plan-account');
  },
}));
vi.mock('./consumption/provider-plan-composite', () => ({
  ProviderPlanCompositeSource: class {},
}));
vi.mock('./consumption/retention-policy', () => ({
  sampleRetentionPolicy: () => () => 0,
}));
vi.mock('./settings-store', () => ({
  loadSettings: () => ({}),
  isClaudePlanWindowsEnabled: () => true,
}));
vi.mock('./installed-build', () => ({
  watchInstalledBuild: () => {
    world.log.push('watch:installed-build');
    return { stop: () => {} };
  },
}));

const { CommandRuntime, bootstrapCommandSurface, reportCommandSurfaceFailure } =
  await import('./command-surface');

type Dependencies = Parameters<typeof bootstrapCommandSurface>[0];

const OFFICIAL: DistributionContractV2 = {
  ...COMMUNITY_DISTRIBUTION,
  ownAccount: { claudePlanUsage: 'stable-signed' },
  updates: { feedUrl: 'https://updates.example.test/feed.json' },
} as DistributionContractV2;

function fakeModules() {
  const log = world.log;
  return {
    agentSourcesIpc: {
      registerAgentSourcesIPC: () => log.push('ipc:agent-sources'),
    },
    ptyIpc: {
      disposePty: async () => {},
      registerPtyIPC: (_contract: unknown, interrupted: boolean) =>
        log.push(`ipc:pty(interrupted=${interrupted})`),
    },
    roadmapIpc: { registerRoadmapIPC: () => log.push('ipc:roadmap') },
    projectIpc: { registerProjectIPC: () => log.push('ipc:projects') },
    roadmapWatcher: { disposeRoadmapWatchers: () => {} },
    sessionManager: {
      ptySessions: {
        setProductName: (name: string) => log.push(`sessions:named:${name}`),
        configurePersistence: async () => void log.push('sessions:restored'),
        list: () => [{ exited: false }, { exited: true }],
        listProviderIdentities: () => [],
      },
    },
    updater: {
      installProductUpdate: () => log.push('updater:install'),
      checkForUpdatesFromMenu: async () => {},
      currentUpdateStatus: () => ({ phase: 'idle' }),
      registerProductUpdater: (feed: string) =>
        log.push(`updater:register:${feed}`),
      startProductUpdater: (signed: boolean) =>
        log.push(`updater:start(signed=${signed})`),
    },
    shutdown: {
      ShutdownCoordinator: class {
        constructor() {
          log.push('shutdown:coordinator');
        }
        request = async () => true;
      },
      shutdownCopy: () => ({ title: '', detail: '' }),
    },
    runState: {
      RunStateStore: class {
        begin = async () => ({ previousRunInterrupted: true });
        markClean = async () => {};
      },
    },
    auth: {
      ElectronAuthCoordinator: class {
        constructor() {
          log.push('auth:coordinator');
        }
      },
      safeElectronAuthError: () => ({ name: 'AuthError', message: 'safe' }),
      isElectronAuthLinkOutcome: () => true,
    },
    authDiagnostics: {
      createPersistentAuthDiagnostics: () => (event: string) =>
        log.push(`auth:${event}`),
      instrumentAuthFetch: (transport: typeof fetch) => transport,
    },
    connectedSourcesIpc: {
      registerConnectedSourcesIPC: () => log.push('ipc:connected-sources'),
    },
  };
}

function dependencies(
  overrides: Partial<Dependencies> & {
    contract?: DistributionContractV2;
    packaged?: boolean;
  } = {}
) {
  const runtime = new CommandRuntime();
  const { contract, packaged, ...rest } = overrides;
  const deps: Dependencies = {
    runtime,
    isDev: false,
    isTest: false,
    env: {},
    build: {
      buildInfo: { sha: 'abc', branch: 'master', delivery: 'signed' },
      distribution: { contract: contract ?? COMMUNITY_DISTRIBUTION },
      identity: { productName: 'Exawatt' },
    },
    rendererReady: async () => 'http://127.0.0.1:23456',
    pruneRendererCache: () => world.log.push('renderer:prune'),
    setTrustedRendererOrigin: url => world.log.push(`trust:${url}`),
    startupScreen: {
      update: stage => world.log.push(`stage:${stage.progress}`),
    },
    electron: {
      app: {
        getVersion: () => '0.1.13',
        isPackaged: packaged ?? true,
        getPath: () => '/tmp/exawatt-command-surface-test',
      },
      net: { fetch: async () => new Response('') },
      session: {
        defaultSession: {
          cookies: {
            get: async () => [],
            set: async () => {},
            remove: async () => {},
          },
        },
      },
      shell: { openExternal: async () => {} },
      BrowserWindow: { getAllWindows: () => [] },
    },
    registerMainChannels: () => world.log.push('ipc:main'),
    shutdownSequence: {
      coordinatorDependencies: () => ({}) as never,
      promptWindowManagementRestart: async () => {},
    },
    rebuildMenu: () => world.log.push('menu:rebuild'),
    mainDiagnostics: () => {},
    setEnginePhase: phase => world.log.push(`engine:${phase}`),
    enterWorkspace: async () => void world.log.push('window:workspace'),
    loadRuntime: async () => fakeModules() as never,
    ...rest,
  };
  return { deps, runtime };
}

beforeEach(() => {
  world.log.length = 0;
  world.planAccountOptions.length = 0;
  world.scannerThrows = false;
});

describe('bootstrapCommandSurface', () => {
  it('registers every IPC module in one order, then enters the workspace', async () => {
    const { deps } = dependencies();

    await bootstrapCommandSurface(deps);

    const ipc = world.log.filter(entry => entry.startsWith('ipc:'));
    expect(ipc).toEqual([
      'ipc:agent-sources',
      'ipc:connected-sources',
      'ipc:pty(interrupted=true)',
      'ipc:roadmap',
      'ipc:projects',
      'ipc:main',
      'ipc:system-shortcuts',
      'ipc:operator-stats',
      'ipc:consumption',
      'ipc:analytics',
    ]);
    const after = (first: string, second: string) =>
      expect(world.log.indexOf(first)).toBeLessThan(world.log.indexOf(second));
    after('trust:http://127.0.0.1:23456', 'ipc:agent-sources');
    after('sessions:restored', 'ipc:agent-sources');
    after('ipc:analytics', 'shutdown:coordinator');
    after('shutdown:coordinator', 'menu:rebuild');
    after('menu:rebuild', 'engine:ready');
    after('engine:ready', 'window:workspace');
    after('window:workspace', 'watch:installed-build');
    after('watch:installed-build', 'renderer:prune');
  });

  it('moves the launch screen forward only, and ends one step short of the workspace', async () => {
    const { deps } = dependencies();
    await bootstrapCommandSurface(deps);

    const stages = world.log
      .filter(entry => entry.startsWith('stage:'))
      .map(entry => Number(entry.slice('stage:'.length)));
    expect(stages.slice(-2)).toEqual([0.78, 0.94]);
    expect(new Set(stages)).toEqual(new Set([0.36, 0.62, 0.78, 0.94]));
  });

  it('fills the runtime the rest of main reads', async () => {
    const { deps, runtime } = dependencies();
    expect(runtime.liveSessionCount()).toBe(0);
    expect(runtime.startupComplete).toBe(false);

    await bootstrapCommandSurface(deps);

    expect(runtime.liveSessionCount()).toBe(1);
    expect(runtime.startupComplete).toBe(true);
    expect(runtime.authCoordinator).not.toBeNull();
    expect(runtime.shutdownCoordinator).not.toBeNull();
    expect(runtime.isLinkOutcome?.('linked')).toBe(true);
    expect(runtime.safeAuthError(new Error('raw'))).toEqual({
      name: 'AuthError',
      message: 'safe',
    });

    runtime.disposeServices();
    expect(world.log).toContain('dispose:scanner');
    expect(world.log).toContain('dispose:plan-account');
  });

  it('wires the updater only for a distribution that declares a feed', async () => {
    const community = dependencies();
    await bootstrapCommandSurface(community.deps);
    expect(world.log.some(entry => entry.startsWith('updater:'))).toBe(false);
    expect(() => community.runtime.installProductUpdate()).toThrow(
      'Product updates are not ready.'
    );
    expect(community.runtime.currentUpdateStatus()).toBeNull();

    world.log.length = 0;
    const official = dependencies({ contract: OFFICIAL });
    await bootstrapCommandSurface(official.deps);
    expect(world.log).toContain(
      'updater:register:https://updates.example.test/feed.json'
    );
    expect(world.log).toContain('updater:start(signed=true)');
    expect(official.runtime.currentUpdateStatus()).toEqual({ phase: 'idle' });
  });

  it('asks the plan-account gate the contract question (BUG-060)', async () => {
    await bootstrapCommandSurface(dependencies({ contract: OFFICIAL }).deps);
    await bootstrapCommandSurface(dependencies().deps);
    await bootstrapCommandSurface(
      dependencies({ contract: OFFICIAL, packaged: false }).deps
    );

    expect(
      world.planAccountOptions.map(options => options.remoteReadAllowed)
    ).toEqual([true, false, false]);
  });

  it('keeps every earlier row registered when a service constructor throws', async () => {
    world.scannerThrows = true;
    const { deps, runtime } = dependencies();

    await expect(bootstrapCommandSurface(deps)).rejects.toThrow(
      'scanner is not a constructor'
    );

    expect(world.log).toContain('ipc:main');
    expect(world.log).toContain('ipc:system-shortcuts');
    expect(world.log).not.toContain('ipc:operator-stats');
    expect(world.log).not.toContain('window:workspace');
    expect(runtime.shutdownCoordinator).toBeNull();
  });

  it('leaves the renderer cache alone in development', async () => {
    await bootstrapCommandSurface(dependencies({ isDev: true }).deps);
    expect(world.log).not.toContain('renderer:prune');
  });
});

describe('reportCommandSurfaceFailure', () => {
  it('pauses the engine and marks the current stage failed', () => {
    const updates: unknown[] = [];
    let phase = '';
    reportCommandSurfaceFailure(new Error('boom'), {
      productName: 'Exawatt',
      setEnginePhase: next => {
        phase = next;
      },
      startupScreen: {
        stage: () => ({ progress: 0.62, label: '', detail: '' }),
        update: stage => updates.push(stage),
      },
      logError: () => {},
    });

    expect(phase).toBe('paused');
    expect(updates).toEqual([
      {
        progress: 0.62,
        label: 'Command engine paused',
        detail: 'Exawatt could not start its local command services',
        failed: true,
      },
    ]);
  });
});
