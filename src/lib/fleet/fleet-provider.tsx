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
  type ExawattAgent,
  type AgentActivity,
  type FleetState,
  type FleetMetrics,
  type OCConnectionStatus,
  type ExawattCronJob,
  type ExawattCronRun,
  type ExawattCronJobCreate,
} from '@exawatt/core';

// --- Context ---

interface FleetContextValue {
  manager: FleetManager;
  mockTransport: MockFleetTransport | null;
  isDemo: boolean;
  connectionStatus: OCConnectionStatus | 'initializing';
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
  const mockTransportRef = useRef<MockFleetTransport | null>(null);
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
      try {
        // Try to get OC token from server-side API
        const res = await fetch('/api/oc/token');

        if (res.ok && mounted) {
          const { token, host, port } = (await res.json()) as {
            token: string;
            host: string;
            port: number;
          };

          // Connect to real OC Gateway
          const client = new OCClient({
            url: `ws://${host}:${port}`,
            token,
            clientId: 'exawatt-web',
            clientVersion: '0.0.1',
            clientPlatform: 'browser',
          });

          const methods = new OCMethods(client);
          manager.connect(client, methods);

          client.on('connection:status', status => {
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

          await client.connect();
          setIsDemo(false);
        } else {
          // Fall back to demo/mock mode
          if (!mounted) return;
          setIsDemo(true);
          setConnectionStatus('connected');
          prevConnectionStatusRef.current = 'connected';

          const mockTransport = new MockFleetTransport();
          mockTransportRef.current = mockTransport;
          mockTransport.initialize(manager);
          mockTransport.start();
        }
      } catch {
        // On any error, fall back to demo mode
        if (!mounted) return;
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
      for (const timer of toastTimersRef.current) clearTimeout(timer);
      toastTimersRef.current = [];
      manager.disconnect();
      mockTransportRef.current?.stop();
    };
  }, [manager]);

  const value = useMemo(
    () => ({
      manager,
      mockTransport: mockTransportRef.current,
      isDemo,
      connectionStatus,
    }),
    [manager, isDemo, connectionStatus]
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
  loadHistory: () => Promise<void>;
  abortChat: () => Promise<void>;
  isLoadingHistory: boolean;
} {
  const { manager } = useFleetContext();
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

    manager.on('agent:updated', onAgentUpdated);
    manager.on('agent:created', onAgentCreated);

    // Get initial state
    setAgent(manager.getAgent(agentId));

    return () => {
      manager.off('agent:updated', onAgentUpdated);
      manager.off('agent:created', onAgentCreated);
    };
  }, [manager, agentId]);

  const sendMessage = useCallback(
    async (text: string) => {
      const targetAgent = manager.getAgent(agentId);
      if (!targetAgent) return;
      const chatAdapter = manager.getChatAdapter();
      if (!chatAdapter) return;

      await chatAdapter.sendMessage(agentId, text, targetAgent.sessionKey);
    },
    [manager, agentId]
  );

  const loadHistory = useCallback(async () => {
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
  }, [manager, agentId]);

  const abortChat = useCallback(async () => {
    const targetAgent = manager.getAgent(agentId);
    const chatAdapter = manager.getChatAdapter();
    if (!chatAdapter) return;
    await chatAdapter.abort(targetAgent?.sessionKey);
  }, [manager, agentId]);

  return {
    agent,
    activities: agent?.activities ?? [],
    sendMessage,
    loadHistory,
    abortChat,
    isLoadingHistory,
  };
}

export function useMockTransport(): MockFleetTransport | null {
  return useFleetContext().mockTransport;
}

export function useCron() {
  const { manager, mockTransport, isDemo } = useFleetContext();
  const [jobs, setJobs] = useState<ExawattCronJob[]>([]);
  const [loading, setLoading] = useState(true);

  const cronSource = isDemo ? mockTransport : manager;

  useEffect(() => {
    if (!cronSource) return;

    let mounted = true;

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
  }, [cronSource]);

  const addJob = async (job: ExawattCronJobCreate) => {
    if (!cronSource) return;
    const newJob = await cronSource.addCronJob(job);
    setJobs(prev => [...prev, newJob]);
    return newJob;
  };

  const runJob = async (jobId: string) => {
    if (!cronSource) return;
    await cronSource.runCronJob(jobId);
    const updatedJobs = await cronSource.listCronJobs();
    setJobs(updatedJobs);
  };

  const updateJob = async (
    jobId: string,
    patch: Partial<ExawattCronJobCreate>
  ) => {
    if (!cronSource) return;
    const updatedJob = await cronSource.updateCronJob(jobId, patch);
    setJobs(prev => prev.map(j => (j.id === jobId ? updatedJob : j)));
    return updatedJob;
  };

  const removeJob = async (jobId: string) => {
    if (!cronSource) return;
    await cronSource.removeCronJob(jobId);
    setJobs(prev => prev.filter(j => j.id !== jobId));
  };

  const getJobRuns = async (jobId: string): Promise<ExawattCronRun[]> => {
    if (!cronSource) return [];
    const result = await cronSource.getCronRuns(jobId);
    return result.runs;
  };

  return { jobs, loading, addJob, runJob, updateJob, removeJob, getJobRuns };
}
