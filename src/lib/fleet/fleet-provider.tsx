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
  MockFleetTransport,
  LocalSessionsTransport,
  type ExawattAgent,
  type AgentActivity,
  type FleetState,
  type FleetMetrics,
  type OCConnectionStatus,
  type ExawattCronJob,
  type ExawattCronRun,
  type ExawattCronJobCreate,
} from '@exawatt/core';
import { mergeLocalWorkspaceSessions } from './local-workspace-sessions';

// --- Context ---

interface FleetContextValue {
  manager: FleetManager;
  mockTransport: MockFleetTransport | null;
  isDemo: boolean;
  /** desktop local-sessions mode: the terminal workspace IS the fleet */
  isLocal: boolean;
  connectionStatus: OCConnectionStatus | 'initializing';
  ocAvailable: boolean;
  connectToRealOC: () => void;
}

interface ConnectionToast {
  id: number;
  message: string;
}

const FleetContext = createContext<FleetContextValue | null>(null);

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
  const [ocAvailable, setOcAvailable] = useState(false);
  const [isConnectingToOC, setIsConnectingToOC] = useState(false);
  const mockTransportRef = useRef<MockFleetTransport | null>(null);
  const localTransportRef = useRef<LocalSessionsTransport | null>(null);
  const ocClientRef = useRef<OCClient | null>(null);
  const prevConnectionStatusRef = useRef<OCConnectionStatus | 'initializing'>(
    'initializing'
  );
  const toastIdRef = useRef(0);
  const toastTimersRef = useRef<Array<ReturnType<typeof setTimeout>>>([]);

  const pushConnectionToast = useCallback((message: string) => {
    const id = ++toastIdRef.current;
    setConnectionToasts(prev => [...prev, { id, message }]);

    const timer = setTimeout(() => {
      setConnectionToasts(prev => prev.filter(toast => toast.id !== id));
    }, 3000);

    toastTimersRef.current.push(timer);
  }, []);

  // Stable FleetManager instance
  const manager = useMemo(() => new FleetManager(), []);

  useEffect(() => {
    let mounted = true;

    async function initializeFleet() {
      console.log('[Exawatt] initializeFleet: starting');
      try {
        // Desktop app: LIVE LOCAL TRUTH (ENG-002 W0.3). The Agent Terminal
        // Workspace's real PTY sessions ARE the fleet — no mock noise. The
        // web app keeps Demo Mode / OC below, unchanged.
        const pty =
          typeof window !== 'undefined' ? window.electron?.pty : undefined;
        if (pty) {
          console.log('[Exawatt] Local sessions mode (desktop) active');
          if (!mounted) return;
          setIsDemo(false);
          setIsLocal(true);
          setConnectionStatus('connected');
          prevConnectionStatusRef.current = 'connected';

          const localTransport = new LocalSessionsTransport({
            list: async () => {
              const [live, layout] = await Promise.all([
                pty.list(),
                window.electron?.workspace?.load() ?? Promise.resolve(null),
              ]);
              return mergeLocalWorkspaceSessions(live, layout);
            },
            onData: pty.onData,
            onExit: pty.onExit,
          });
          localTransportRef.current = localTransport;
          localTransport.initialize(manager);
          localTransport.start();
          return;
        }

        if (process.env.NEXT_PUBLIC_EXAWATT_AUTO_CONNECT_OC !== 'true') {
          console.log('[Exawatt] Demo mode active by default');
          if (!mounted) return;
          setIsDemo(true);
          setConnectionStatus('connected');
          prevConnectionStatusRef.current = 'connected';

          const mockTransport = new MockFleetTransport();
          mockTransportRef.current = mockTransport;
          mockTransport.initialize(manager);
          mockTransport.start();
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
          // Fall back to demo/mock mode
          if (!mounted) return;
          ocClientRef.current?.disconnect();
          setIsDemo(true);
          setConnectionStatus('connected');
          prevConnectionStatusRef.current = 'connected';

          const mockTransport = new MockFleetTransport();
          mockTransportRef.current = mockTransport;
          mockTransport.initialize(manager);
          mockTransport.start();
        }
      } catch (err) {
        console.warn(
          '[Exawatt] Connection failed, activating demo mode:',
          err instanceof Error ? err.message : err
        );
        // On any error, fall back to demo mode
        if (!mounted) return;
        ocClientRef.current?.disconnect();
        setIsDemo(true);
        setConnectionStatus('connected');
        prevConnectionStatusRef.current = 'connected';

        const mockTransport = new MockFleetTransport();
        mockTransportRef.current = mockTransport;
        mockTransport.initialize(manager);
        mockTransport.start();
      }
    }

    void initializeFleet();

    return () => {
      mounted = false;
      ocClientRef.current?.disconnect();
      for (const timer of toastTimersRef.current) clearTimeout(timer);
      toastTimersRef.current = [];
      manager.disconnect();
      mockTransportRef.current?.stop();
      localTransportRef.current?.stop();
    };
  }, [manager, pushConnectionToast]);

  const connectToRealOC = useCallback(() => {
    if (isConnectingToOC || !isDemo) return;
    setIsConnectingToOC(true);

    mockTransportRef.current?.stop();
    mockTransportRef.current = null;
    ocClientRef.current?.disconnect();
    manager.disconnect();

    let mounted = true;

    async function retryConnection() {
      try {
        const res = await fetch('/api/oc/token');
        if (!res.ok) throw new Error(`Token API returned ${res.status}`);

        const { token, host, port } = (await res.json()) as {
          token: string;
          host: string;
          port: number;
        };

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
          if (!mounted) return;
          setConnectionStatus(status);
          const prev = prevConnectionStatusRef.current;
          if (status === 'disconnected')
            pushConnectionToast('Connection lost. Reconnecting...');
          if (status === 'connected' && prev === 'disconnected')
            pushConnectionToast('Reconnected. State refreshed.');
          prevConnectionStatusRef.current = status;
        });

        await client.connect();

        if (mounted) {
          setIsDemo(false);
          setIsConnectingToOC(false);
        }
      } catch (err) {
        console.warn(
          '[Exawatt] OC reconnection failed, staying in demo mode:',
          err instanceof Error ? err.message : err
        );
        if (!mounted) return;

        ocClientRef.current?.disconnect();
        setIsDemo(true);
        setConnectionStatus('connected');
        prevConnectionStatusRef.current = 'connected';
        setIsConnectingToOC(false);
        pushConnectionToast('OpenClaw unavailable. Staying in Demo Mode.');

        const mockTransport = new MockFleetTransport();
        mockTransportRef.current = mockTransport;
        mockTransport.initialize(manager);
        mockTransport.start();
      }
    }

    void retryConnection();
    return () => {
      mounted = false;
    };
  }, [isDemo, isConnectingToOC, manager, pushConnectionToast]);

  const value = useMemo(
    () => ({
      manager,
      mockTransport: mockTransportRef.current,
      isDemo,
      isLocal,
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
} {
  const { manager } = useFleetContext();
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
  return { agents, metrics: fleetState.metrics, fleetState };
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
  const { manager, mockTransport, isDemo } = useFleetContext();
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
      if (isDemo && mockTransport) {
        await mockTransport.sendMessage(agentId, text);
        return;
      }

      const targetAgent = manager.getAgent(agentId);
      if (!targetAgent) return;
      const chatAdapter = manager.getChatAdapter();
      if (!chatAdapter) return;

      await chatAdapter.sendMessage(agentId, text, targetAgent.sessionKey);
    },
    [agentId, isDemo, manager, mockTransport]
  );

  const resolveBlocker = useCallback(
    async (response: string) => {
      if (isDemo && mockTransport) {
        mockTransport.resolveBlocker(agentId, response);
        return;
      }

      await sendMessage(response);
    },
    [agentId, isDemo, mockTransport, sendMessage]
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
    if (isDemo && mockTransport) {
      await mockTransport.abortAgent(agentId);
      return;
    }

    const targetAgent = manager.getAgent(agentId);
    const chatAdapter = manager.getChatAdapter();
    if (!chatAdapter) return;
    await chatAdapter.abort(targetAgent?.sessionKey);
  }, [agentId, isDemo, manager, mockTransport]);

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

export function useMockTransport(): MockFleetTransport | null {
  return useFleetContext().mockTransport;
}

export function useConnectToOC(): {
  connectToRealOC: () => void;
  ocAvailable: boolean;
  canConnect: boolean;
} {
  const { connectToRealOC, ocAvailable, isDemo } = useFleetContext();
  return { connectToRealOC, ocAvailable, canConnect: isDemo };
}

export function useCron() {
  const { manager, mockTransport, isDemo, isLocal, connectionStatus } =
    useFleetContext();
  const [jobs, setJobs] = useState<ExawattCronJob[]>([]);
  const [loading, setLoading] = useState(true);

  // local-sessions mode has no cron backend (heartbeats come with OC/ENG-003)
  const cronSource = isLocal
    ? null
    : isDemo
      ? mockTransport
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
