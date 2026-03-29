'use client';

import {
  createContext,
  useContext,
  useEffect,
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
} from '@exawatt/core';

// --- Context ---

interface FleetContextValue {
  manager: FleetManager;
  mockTransport: MockFleetTransport | null;
  isDemo: boolean;
  connectionStatus: OCConnectionStatus | 'initializing';
}

const FleetContext = createContext<FleetContextValue | null>(null);

// --- Provider ---

export function FleetProvider({ children }: { children: ReactNode }) {
  const [connectionStatus, setConnectionStatus] = useState<
    OCConnectionStatus | 'initializing'
  >('initializing');
  const [isDemo, setIsDemo] = useState(false);
  const mockTransportRef = useRef<MockFleetTransport | null>(null);

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
            if (mounted) setConnectionStatus(status);
          });

          await client.connect();
          setIsDemo(false);
        } else {
          // Fall back to demo/mock mode
          if (!mounted) return;
          setIsDemo(true);
          setConnectionStatus('connected');

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

        const mockTransport = new MockFleetTransport();
        mockTransportRef.current = mockTransport;
        mockTransport.initialize(manager);
        mockTransport.start();
      }
    }

    void initializeFleet();

    return () => {
      mounted = false;
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
    <FleetContext.Provider value={value}>{children}</FleetContext.Provider>
  );
}

// --- Hooks ---

function useFleetContext(): FleetContextValue {
  const ctx = useContext(FleetContext);
  if (!ctx)
    throw new Error('useFleetContext must be used inside FleetProvider');
  return ctx;
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
} {
  const { manager } = useFleetContext();
  const [agent, setAgent] = useState<ExawattAgent | undefined>(() =>
    manager.getAgent(agentId)
  );

  useEffect(() => {
    const onAgentUpdated = (updated: ExawattAgent) => {
      if (updated.id === agentId) setAgent(updated);
    };
    const onAgentCreated = (created: ExawattAgent) => {
      if (created.id === agentId) setAgent(created);
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

  const sendMessage = async (text: string) => {
    // Placeholder — will be wired to real chat in T17
    console.log('sendMessage not yet wired:', text);
  };

  return {
    agent,
    activities: agent?.activities ?? [],
    sendMessage,
  };
}

export function useMockTransport(): MockFleetTransport | null {
  return useFleetContext().mockTransport;
}
