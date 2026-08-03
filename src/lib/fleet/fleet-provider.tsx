'use client';

import {
  createContext,
  useContext,
  useEffect,
  useCallback,
  useMemo,
  useState,
  useRef,
  type ReactNode,
} from 'react';
import {
  FleetManager,
  OCClient,
  OCMethods,
  DemoWorkspaceTransport,
  demoWorkspaceProjectCatalog,
  LocalSessionsTransport,
  type ExawattAgent,
  type AgentActivity,
  type FleetState,
  type FleetMetrics,
  type OCConnectionStatus,
  type ExawattCronJob,
  type ExawattCronRun,
  type ExawattCronJobCreate,
  type ProjectCatalogEntry,
} from '@exawatt/core';
import {
  extractLocalWorkspaceProjects,
  mergeLocalWorkspaceSessions,
} from './local-workspace-sessions';
import { useOptionalWorkspaceTenancy } from '@/lib/tenancy/tenancy-provider';
import { DEMO_WORKSPACE_ID } from '@/lib/tenancy/workspace-scope';

// --- Context ---

interface FleetContextValue {
  manager: FleetManager;
  /** the honest Demo Workspace source is driving the fleet (ENG-027 W2) —
   *  either the Demo tenant, or the web's default demo posture */
  isDemo: boolean;
  /** desktop local-sessions mode: the terminal workspace IS the fleet */
  isLocal: boolean;
  /** Projects exist independently of whether they currently contain Agents. */
  projects: ProjectCatalogEntry[];
  connectionStatus: OCConnectionStatus | 'initializing';
  ocAvailable: boolean;
  connectToRealOC: () => void;
}

interface ConnectionToast {
  id: number;
  message: string;
}

const FleetContext = createContext<FleetContextValue | null>(null);

function sameProjectCatalog(
  current: ProjectCatalogEntry[],
  next: ProjectCatalogEntry[]
): boolean {
  return (
    current.length === next.length &&
    current.every(
      (project, index) =>
        project.id === next[index]?.id &&
        project.label === next[index]?.label &&
        project.color === next[index]?.color
    )
  );
}

// --- Provider ---

export function FleetProvider({ children }: { children: ReactNode }) {
  const [connectionStatus, setConnectionStatus] = useState<
    OCConnectionStatus | 'initializing'
  >('initializing');
  const [connectionToasts, setConnectionToasts] = useState<ConnectionToast[]>(
    []
  );
  const [isDemo, setIsDemo] = useState(false);
  const [isLocal, setIsLocal] = useState(false);
  const [projects, setProjects] = useState<ProjectCatalogEntry[]>([]);
  const [ocAvailable, setOcAvailable] = useState(false);
  const [isConnectingToOC, setIsConnectingToOC] = useState(false);
  const demoTransportRef = useRef<DemoWorkspaceTransport | null>(null);
  const localTransportRef = useRef<LocalSessionsTransport | null>(null);
  const ocClientRef = useRef<OCClient | null>(null);
  const prevConnectionStatusRef = useRef<OCConnectionStatus | 'initializing'>(
    'initializing'
  );
  const toastIdRef = useRef(0);
  const toastTimersRef = useRef<Array<ReturnType<typeof setTimeout>>>([]);
  /** Cancels an in-flight `connectToRealOC` retry. Invoked by the source
   *  effect's cleanup, so a tenant switch or unmount can never let a late
   *  resolve wire the OC client into a stale manager. */
  const cancelOcRetryRef = useRef<(() => void) | null>(null);

  // Workspace tenancy (ENG-027 W2): the fleet source is a property of the
  // ACTIVE TENANT. Personal = live local truth; Demo = the Voltaic fixtures
  // behind the same transport boundary. `hydrated` fences boot so a relaunch
  // inside Demo never spins up (then tears down) the personal source.
  const tenancy = useOptionalWorkspaceTenancy();
  const tenancyHydrated = tenancy?.hydrated ?? true;
  const demoTenantActive =
    (tenancy?.hydrated ?? false) &&
    tenancy?.activeWorkspace.id === DEMO_WORKSPACE_ID;

  const pushConnectionToast = useCallback((message: string) => {
    const id = ++toastIdRef.current;
    setConnectionToasts(prev => [...prev, { id, message }]);

    const timer = setTimeout(() => {
      setConnectionToasts(prev => prev.filter(toast => toast.id !== id));
    }, 3000);

    toastTimersRef.current.push(timer);
  }, []);

  // One FleetManager per source regime: recreating it on tenant change is
  // what guarantees zero state bleed between the Demo and Personal fleets.
  const manager = useMemo(() => {
    void demoTenantActive; // deliberate key: a tenant switch means a new manager
    return new FleetManager();
  }, [demoTenantActive]);

  useEffect(() => {
    let mounted = true;
    let offWorkspaceChanged: (() => void) | undefined;
    let offDelegation: (() => void) | undefined;

    function startDemoWorkspace() {
      if (!mounted) return;
      setIsDemo(true);
      setIsLocal(false);
      setConnectionStatus('connected');
      prevConnectionStatusRef.current = 'connected';
      setProjects(current => {
        const next = demoWorkspaceProjectCatalog();
        return sameProjectCatalog(current, next) ? current : next;
      });
      const demoTransport = new DemoWorkspaceTransport({
        tier: 'scale',
        nowMs: Date.now(),
      });
      demoTransportRef.current = demoTransport;
      demoTransport.initialize(manager);
      demoTransport.start();
    }

    async function initializeFleet() {
      console.log('[Exawatt] initializeFleet: starting');
      // Boot fence: pick no source until the persisted tenant has resolved.
      if (!tenancyHydrated) return;
      try {
        // The Demo tenant (ENG-027 W2): the authored Voltaic fleet through
        // the same transport boundary — never a PTY, never a simulation.
        if (demoTenantActive) {
          console.log('[Exawatt] Demo Workspace source active');
          startDemoWorkspace();
          return;
        }

        // Desktop app: LIVE LOCAL TRUTH (ENG-002 W0.3). The Agent Terminal
        // Workspace's real PTY sessions ARE the fleet. The web app keeps the
        // demo posture / OC below, unchanged.
        const pty =
          typeof window !== 'undefined' ? window.electron?.pty : undefined;
        if (pty) {
          console.log('[Exawatt] Local sessions mode (desktop) active');
          if (!mounted) return;
          setIsDemo(false);
          setIsLocal(true);
          setConnectionStatus('connected');
          prevConnectionStatusRef.current = 'connected';

          const workspace = window.electron?.workspace;
          const localTransport = new LocalSessionsTransport({
            list: async () => {
              const [live, layout] = await Promise.all([
                pty.list(),
                workspace?.load() ?? Promise.resolve(null),
              ]);
              if (mounted) {
                const next = extractLocalWorkspaceProjects(layout);
                setProjects(current =>
                  sameProjectCatalog(current, next) ? current : next
                );
              }
              return mergeLocalWorkspaceSessions(live, layout);
            },
            onData: pty.onData,
            onExit: pty.onExit,
          });
          localTransportRef.current = localTransport;
          localTransport.initialize(manager);
          localTransport.start();
          // Delegation truth is push (ENG-023): a child starting or finishing
          // re-lists promptly, so the board's satellites track the harness
          // instead of trailing the next poll tick. Coalesced through one
          // short trailing timer — a parent fanning out N children in one
          // turn must cost one list round trip, not N.
          let delegationRefresh: ReturnType<typeof setTimeout> | undefined;
          offDelegation = pty.onDelegation?.(() => {
            if (!mounted) return;
            clearTimeout(delegationRefresh);
            delegationRefresh = setTimeout(() => {
              if (mounted) void localTransport.refresh();
            }, 150);
          });
          const offDelegationListener = offDelegation;
          offDelegation = () => {
            clearTimeout(delegationRefresh);
            offDelegationListener?.();
          };
          offWorkspaceChanged = workspace?.onChanged?.(layout => {
            if (!mounted) return;
            const next = extractLocalWorkspaceProjects(layout);
            setProjects(current =>
              sameProjectCatalog(current, next) ? current : next
            );
            void localTransport.refresh();
          });
          return;
        }

        if (process.env.NEXT_PUBLIC_EXAWATT_AUTO_CONNECT_OC !== 'true') {
          // Web default: the honest Demo Workspace fleet. The simulated
          // MockFleetTransport is eval-only since ENG-027 W2 — the simulated
          // and honest demo sources never coexist on a product surface.
          console.log('[Exawatt] Demo mode active by default');
          startDemoWorkspace();
          return;
        }

        // Try to get OC token from server-side API
        const res = await fetch('/api/oc/token');
        console.log('[Exawatt] /api/oc/token response:', res.status);

        if (res.ok && mounted) {
          setOcAvailable(true);
          const { token, host, port } = (await res.json()) as {
            token: string;
            host: string;
            port: number;
          };

          console.log(
            `[Exawatt] Connecting to OC gateway: ws://${host}:${port}?token=***`
          );

          // Connect to real OC Gateway
          const client = new OCClient({
            url: `ws://${host}:${port}?token=${encodeURIComponent(token)}`,
            token,
            clientId: 'webchat',
            clientVersion: '0.0.1',
            clientPlatform:
              typeof navigator !== 'undefined' ? navigator.platform : 'web',
            clientMode: 'webchat',
          });
          ocClientRef.current = client;

          const methods = new OCMethods(client);
          manager.connect(client, methods);

          client.on('connection:status', status => {
            console.log(`[Exawatt] OCClient status: ${status}`);
            if (!mounted) return;

            const prevStatus = prevConnectionStatusRef.current;
            setConnectionStatus(status);

            if (status === 'disconnected') {
              pushConnectionToast('Connection lost. Reconnecting...');
            }

            if (status === 'connected' && prevStatus === 'disconnected') {
              pushConnectionToast('Reconnected. State refreshed.');
            }

            prevConnectionStatusRef.current = status;
          });

          client.on('connection:error', (err: Error) => {
            console.warn('[Exawatt] OCClient error:', err.message);
          });

          console.log('[Exawatt] Awaiting connect() (waiting for hello-ok)...');
          await client.connect();
          console.log('[Exawatt] connect() resolved — real OC mode active');
          setIsDemo(false);
        } else {
          console.log(
            `[Exawatt] Token API returned ${res.status} — activating demo mode`
          );
          // Fall back to the Demo Workspace source
          if (!mounted) return;
          ocClientRef.current?.disconnect();
          startDemoWorkspace();
        }
      } catch (err) {
        console.warn(
          '[Exawatt] Connection failed, activating demo mode:',
          err instanceof Error ? err.message : err
        );
        // On any error, fall back to the Demo Workspace source
        if (!mounted) return;
        ocClientRef.current?.disconnect();
        startDemoWorkspace();
      }
    }

    void initializeFleet();

    return () => {
      mounted = false;
      cancelOcRetryRef.current?.();
      cancelOcRetryRef.current = null;
      offWorkspaceChanged?.();
      offDelegation?.();
      ocClientRef.current?.disconnect();
      for (const timer of toastTimersRef.current) clearTimeout(timer);
      toastTimersRef.current = [];
      manager.disconnect();
      demoTransportRef.current?.stop();
      demoTransportRef.current = null;
      localTransportRef.current?.stop();
      localTransportRef.current = null;
    };
  }, [manager, pushConnectionToast, tenancyHydrated, demoTenantActive]);

  const connectToRealOC = useCallback(() => {
    // Never from the Demo tenant: its fleet is the authored corpus, not a
    // connection state.
    if (isConnectingToOC || !isDemo || demoTenantActive) return;
    setIsConnectingToOC(true);

    demoTransportRef.current?.stop();
    demoTransportRef.current = null;
    ocClientRef.current?.disconnect();
    manager.disconnect();

    // Cancellable retry: the cancel handle lives in a ref so the source
    // effect's cleanup (tenant switch, unmount) actually severs an in-flight
    // attempt — a late resolve or reject must never touch a stale manager.
    let cancelled = false;
    cancelOcRetryRef.current?.();
    cancelOcRetryRef.current = () => {
      cancelled = true;
      setIsConnectingToOC(false);
    };

    async function retryConnection() {
      try {
        const res = await fetch('/api/oc/token');
        if (!res.ok) throw new Error(`Token API returned ${res.status}`);

        const { token, host, port } = (await res.json()) as {
          token: string;
          host: string;
          port: number;
        };
        if (cancelled) return;

        const client = new OCClient({
          url: `ws://${host}:${port}?token=${encodeURIComponent(token)}`,
          token,
          clientId: 'webchat',
          clientVersion: '0.0.1',
          clientPlatform:
            typeof navigator !== 'undefined' ? navigator.platform : 'web',
          clientMode: 'webchat',
          requestTimeoutMs: 15000,
        });
        ocClientRef.current = client;

        const methods = new OCMethods(client);
        manager.connect(client, methods);

        client.on('connection:status', status => {
          if (cancelled) return;
          setConnectionStatus(status);
          const prev = prevConnectionStatusRef.current;
          if (status === 'disconnected')
            pushConnectionToast('Connection lost. Reconnecting...');
          if (status === 'connected' && prev === 'disconnected')
            pushConnectionToast('Reconnected. State refreshed.');
          prevConnectionStatusRef.current = status;
        });

        await client.connect();

        if (cancelled) {
          client.disconnect();
          return;
        }
        setIsDemo(false);
        setIsConnectingToOC(false);
        cancelOcRetryRef.current = null;
      } catch (err) {
        console.warn(
          '[Exawatt] OC reconnection failed, staying in demo mode:',
          err instanceof Error ? err.message : err
        );
        if (cancelled) return;

        ocClientRef.current?.disconnect();
        setIsDemo(true);
        setConnectionStatus('connected');
        prevConnectionStatusRef.current = 'connected';
        setIsConnectingToOC(false);
        cancelOcRetryRef.current = null;
        pushConnectionToast('OpenClaw unavailable. Staying in Demo Mode.');

        const demoTransport = new DemoWorkspaceTransport({
          tier: 'scale',
          nowMs: Date.now(),
        });
        demoTransportRef.current = demoTransport;
        demoTransport.initialize(manager);
        demoTransport.start();
      }
    }

    void retryConnection();
  }, [isDemo, isConnectingToOC, demoTenantActive, manager, pushConnectionToast]);

  const value = useMemo(
    () => ({
      manager,
      isDemo,
      isLocal,
      projects,
      connectionStatus: isConnectingToOC
        ? ('connecting' as const)
        : connectionStatus,
      ocAvailable,
      connectToRealOC,
    }),
    [
      manager,
      isDemo,
      isLocal,
      projects,
      connectionStatus,
      ocAvailable,
      connectToRealOC,
      isConnectingToOC,
    ]
  );

  return (
    <FleetContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed right-4 top-4 z-50 flex flex-col gap-2">
        {connectionToasts.map(toast => (
          <div
            key={toast.id}
            className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 shadow-lg"
          >
            {toast.message}
          </div>
        ))}
      </div>
    </FleetContext.Provider>
  );
}

// --- Hooks ---

function useFleetContext(): FleetContextValue {
  const ctx = useContext(FleetContext);
  if (!ctx)
    throw new Error('useFleetContext must be used inside FleetProvider');
  return ctx;
}

function mergeActivities(
  base: AgentActivity[],
  incoming: AgentActivity[]
): AgentActivity[] {
  const byId = new Map<string, AgentActivity>();
  for (const activity of base) byId.set(activity.id, activity);
  for (const activity of incoming) byId.set(activity.id, activity);
  return Array.from(byId.values()).sort((a, b) => a.timestamp - b.timestamp);
}

export function useFleetConnection(): {
  status: OCConnectionStatus | 'initializing';
  isDemo: boolean;
} {
  const { connectionStatus, isDemo } = useFleetContext();
  return { status: connectionStatus, isDemo };
}

export function useFleet(): {
  agents: ExawattAgent[];
  metrics: FleetMetrics;
  fleetState: FleetState;
  projects: ProjectCatalogEntry[];
} {
  const { manager, projects } = useFleetContext();
  const [fleetState, setFleetState] = useState<FleetState>({
    agents: {},
    metrics: {
      activeCount: 0,
      blockedCount: 0,
      idleCount: 0,
      totalCost: 0,
      totalTokens: 0,
      totalCostRate: 0,
      costByProject: {},
    },
    lastUpdated: Date.now(),
  });

  useEffect(() => {
    const onFleetUpdated = (state: FleetState) => setFleetState({ ...state });
    manager.on('fleet:updated', onFleetUpdated);

    // Get initial state
    setFleetState(manager.getFleetState());

    return () => {
      manager.off('fleet:updated', onFleetUpdated);
    };
  }, [manager]);

  const agents = Object.values(fleetState.agents);
  return { agents, metrics: fleetState.metrics, fleetState, projects };
}

export function useAgent(agentId: string): {
  agent: ExawattAgent | undefined;
  activities: AgentActivity[];
  sendMessage: (text: string) => Promise<void>;
  resolveBlocker: (response: string) => Promise<void>;
  loadHistory: () => Promise<void>;
  abortChat: () => Promise<void>;
  isLoadingHistory: boolean;
} {
  const { manager, isDemo } = useFleetContext();
  const [agent, setAgent] = useState<ExawattAgent | undefined>(() =>
    manager.getAgent(agentId)
  );
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);

  useEffect(() => {
    const onAgentUpdated = (updated: ExawattAgent) => {
      if (updated.id !== agentId) return;
      setAgent(current => ({
        ...updated,
        activities: mergeActivities(
          current?.activities ?? [],
          updated.activities ?? []
        ),
      }));
    };
    const onAgentCreated = (created: ExawattAgent) => {
      if (created.id === agentId) setAgent({ ...created });
    };
    const onFleetUpdated = (state: FleetState) => {
      const updated = state.agents[agentId];
      if (updated) {
        setAgent(current => ({
          ...updated,
          activities: mergeActivities(
            current?.activities ?? [],
            updated.activities ?? []
          ),
        }));
      }
    };

    manager.on('agent:updated', onAgentUpdated);
    manager.on('agent:created', onAgentCreated);
    manager.on('fleet:updated', onFleetUpdated);

    // Get initial state
    setAgent(manager.getAgent(agentId));

    return () => {
      manager.off('agent:updated', onAgentUpdated);
      manager.off('agent:created', onAgentCreated);
      manager.off('fleet:updated', onFleetUpdated);
    };
  }, [manager, agentId]);

  const sendMessage = useCallback(
    async (text: string) => {
      // Demo Sessions accept nothing: no simulated replies (ENG-027).
      if (isDemo) return;

      const targetAgent = manager.getAgent(agentId);
      if (!targetAgent) return;
      const chatAdapter = manager.getChatAdapter();
      if (!chatAdapter) return;

      await chatAdapter.sendMessage(agentId, text, targetAgent.sessionKey);
    },
    [agentId, isDemo, manager]
  );

  const resolveBlocker = useCallback(
    async (response: string) => {
      await sendMessage(response);
    },
    [sendMessage]
  );

  const loadHistory = useCallback(async () => {
    if (isDemo) return;

    const targetAgent = manager.getAgent(agentId);
    if (!targetAgent) return;
    const chatAdapter = manager.getChatAdapter();
    if (!chatAdapter) return;

    setIsLoadingHistory(true);
    try {
      const history = await chatAdapter.getHistory(
        agentId,
        targetAgent.sessionKey
      );
      setAgent(current =>
        current
          ? {
              ...current,
              activities: mergeActivities(history, current.activities ?? []),
            }
          : current
      );
    } finally {
      setIsLoadingHistory(false);
    }
  }, [agentId, isDemo, manager]);

  const abortChat = useCallback(async () => {
    if (isDemo) return;

    const targetAgent = manager.getAgent(agentId);
    const chatAdapter = manager.getChatAdapter();
    if (!chatAdapter) return;
    await chatAdapter.abort(targetAgent?.sessionKey);
  }, [agentId, isDemo, manager]);

  return {
    agent,
    activities: agent?.activities ?? [],
    sendMessage,
    resolveBlocker,
    loadHistory,
    abortChat,
    isLoadingHistory,
  };
}

export function useConnectToOC(): {
  connectToRealOC: () => void;
  ocAvailable: boolean;
  canConnect: boolean;
} {
  const { connectToRealOC, ocAvailable, isDemo } = useFleetContext();
  // Connect is a WEB demo-posture affordance; the Demo tenant's fleet is a
  // corpus, not a connection, so `connectToRealOC` refuses it there.
  return { connectToRealOC, ocAvailable, canConnect: isDemo && ocAvailable };
}

export function useCron() {
  const { manager, isDemo, isLocal, connectionStatus } = useFleetContext();
  const [jobs, setJobs] = useState<ExawattCronJob[]>([]);
  const [loading, setLoading] = useState(true);

  // local-sessions mode has no cron backend (heartbeats come with OC/ENG-003);
  // the Demo Workspace has none either — absent, never simulated.
  const cronSource =
    isLocal || isDemo
      ? null
      : connectionStatus === 'connected'
        ? manager
        : null;

  useEffect(() => {
    if (!cronSource) {
      setLoading(connectionStatus === 'initializing');
      return;
    }

    let mounted = true;
    setLoading(true);

    const fetchJobs = async () => {
      try {
        const fetchedJobs = await cronSource.listCronJobs();
        if (mounted) {
          setJobs(fetchedJobs);
          setLoading(false);
        }
      } catch (error) {
        console.error('Failed to fetch cron jobs:', error);
        if (mounted) setLoading(false);
      }
    };

    void fetchJobs();

    return () => {
      mounted = false;
    };
  }, [cronSource, connectionStatus]);

  const addJob = useCallback(
    async (job: ExawattCronJobCreate) => {
      if (!cronSource) return;
      const newJob = await cronSource.addCronJob(job);
      setJobs(prev => [...prev, newJob]);
      return newJob;
    },
    [cronSource]
  );

  const runJob = useCallback(
    async (jobId: string) => {
      if (!cronSource) return;
      await cronSource.runCronJob(jobId);
      const updatedJobs = await cronSource.listCronJobs();
      setJobs(updatedJobs);
    },
    [cronSource]
  );

  const updateJob = useCallback(
    async (jobId: string, patch: Partial<ExawattCronJobCreate>) => {
      if (!cronSource) return;
      const updatedJob = await cronSource.updateCronJob(jobId, patch);
      setJobs(prev => prev.map(j => (j.id === jobId ? updatedJob : j)));
      return updatedJob;
    },
    [cronSource]
  );

  const removeJob = useCallback(
    async (jobId: string) => {
      if (!cronSource) return;
      await cronSource.removeCronJob(jobId);
      setJobs(prev => prev.filter(j => j.id !== jobId));
    },
    [cronSource]
  );

  const getJobRuns = useCallback(
    async (jobId: string): Promise<ExawattCronRun[]> => {
      if (!cronSource) return [];
      const result = await cronSource.getCronRuns(jobId);
      return result.runs;
    },
    [cronSource]
  );

  return { jobs, loading, addJob, runJob, updateJob, removeJob, getJobRuns };
}
