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
  DemoWorkspaceTransport,
  demoWorkspaceProjectCatalog,
  INITIAL_AGENT_METRICS,
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
  attachLiveSessionBurn,
  extractLocalWorkspaceProjects,
  mergeLocalWorkspaceSessions,
} from './local-workspace-sessions';
import {
  getLiveConsumption,
  subscribeLiveConsumption,
} from '@/components/consumption/live-store';
import { useOptionalWorkspaceTenancy } from '@/lib/tenancy/tenancy-provider';
import { DEMO_WORKSPACE_ID } from '@/lib/tenancy/workspace-scope';
import type { RemoteAgentView } from '@/types/electron';

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
  /** the Demo TENANT drives the fleet (vs the web's default demo posture) —
   *  its corpus is authored, so configured sources never join it */
  demoTenantActive: boolean;
}

const FleetContext = createContext<FleetContextValue | null>(null);

/**
 * A projected remote coworker, shaped exactly like a local one (ENG-010 C2).
 *
 * The point of doing this here rather than downstream is that no surface
 * should need a remote branch: Team, Fleet, and the board read one
 * `ExawattAgent`. Placement, connection freshness, and source identity ride
 * on `presence`, which is quiet secondary metadata and deliberately separate
 * from `status` — the D40 work state — so neither can borrow the other's
 * colour.
 *
 * `status` is the work state the source reported, already mapped to D40 by
 * the main process, so a remote coworker with a run in flight reads as
 * working exactly like a local one. It is copied straight through: losing
 * observation must never edit it, because a coworker last seen working is
 * still working as far as anyone knows, and `presence.stalePresentation` is
 * what says how current that knowledge is.
 */
export function remoteAgentToExawattAgent(
  remote: RemoteAgentView
): ExawattAgent {
  return {
    id: remote.id,
    name: remote.displayName,
    status: remote.workState,
    goal: '',
    projectId: remote.projectId,
    project: remote.projectLabel,
    sessionKey: remote.primaryContextId ?? '',
    metrics: { ...INITIAL_AGENT_METRICS },
    lastActivityAt: remote.lastActiveAt,
    createdAt: remote.createdAt,
    presence: {
      placement: remote.placement,
      placementLabel: remote.placementLabel,
      connection: remote.connection.state,
      connectionLabel: remote.connection.label,
      stalePresentation: remote.connection.stalePresentation,
      source: {
        id: remote.source.id,
        displayName: remote.source.displayName,
        adapterId: remote.adapterId,
      },
    },
  };
}

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
  const [isDemo, setIsDemo] = useState(false);
  const [isLocal, setIsLocal] = useState(false);
  const [projects, setProjects] = useState<ProjectCatalogEntry[]>([]);
  const demoTransportRef = useRef<DemoWorkspaceTransport | null>(null);
  const localTransportRef = useRef<LocalSessionsTransport | null>(null);

  // Workspace tenancy (ENG-027 W2): the fleet source is a property of the
  // ACTIVE TENANT. Personal = live local truth; Demo = the Voltaic fixtures
  // behind the same transport boundary. `hydrated` fences boot so a relaunch
  // inside Demo never spins up (then tears down) the personal source.
  const tenancy = useOptionalWorkspaceTenancy();
  const tenancyHydrated = tenancy?.hydrated ?? true;
  const demoTenantActive =
    (tenancy?.hydrated ?? false) &&
    tenancy?.activeWorkspace.id === DEMO_WORKSPACE_ID;

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
    let offLiveBurn: (() => void) | undefined;

    function startDemoWorkspace() {
      if (!mounted) return;
      setIsDemo(true);
      setIsLocal(false);
      setConnectionStatus('connected');
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
              // Live measured burn joins by each Session's captured provider
              // identity (ENG-008 E5) — the burn lens reads the same
              // AgentMetrics fields the Demo transport fills. Absent stays
              // absent, exactly like an unreporting Demo Agent.
              return attachLiveSessionBurn(
                mergeLocalWorkspaceSessions(live, layout),
                live,
                layout,
                getLiveConsumption().burnByProviderId
              );
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
          // A completed scan changes per-Session burn; re-list so the board
          // recolors. Gated on the snapshot revision — the store also emits
          // on 60s now-re-pins, which change no burn figure.
          let lastBurnRevision = getLiveConsumption().revision;
          offLiveBurn = subscribeLiveConsumption(() => {
            const { revision } = getLiveConsumption();
            if (revision === lastBurnRevision) return;
            lastBurnRevision = revision;
            if (mounted) void localTransport.refresh();
          });
          return;
        }

        // A browser has no OS-owned Gateway credential boundary. It always
        // enters the honest Demo Workspace; local/LAN sources are a desktop
        // capability and never a token-returning Next route.
        console.log('[Exawatt] Demo mode active by default');
        startDemoWorkspace();
        return;
      } catch (err) {
        console.warn(
          '[Exawatt] Connection failed, activating demo mode:',
          err instanceof Error ? err.message : err
        );
        // On any error, fall back to the Demo Workspace source
        if (!mounted) return;
        startDemoWorkspace();
      }
    }

    void initializeFleet();

    return () => {
      mounted = false;
      offWorkspaceChanged?.();
      offDelegation?.();
      offLiveBurn?.();
      manager.disconnect();
      demoTransportRef.current?.stop();
      demoTransportRef.current = null;
      localTransportRef.current?.stop();
      localTransportRef.current = null;
    };
  }, [manager, tenancyHydrated, demoTenantActive]);

  // ENG-010 C2: configured Agent Sources contribute coworkers ALONGSIDE the
  // local fleet, never instead of it. The manager is keyed by source id, so
  // remote Agents upsert into the same state the local transport writes and
  // neither displaces the other.
  //
  // The Demo tenant is excluded on purpose: its fleet is an authored corpus,
  // not a set of connections, and joining live remote coworkers to it would
  // make the demo dishonest in both directions.
  useEffect(() => {
    if (!tenancyHydrated || demoTenantActive) return;
    const sources =
      typeof window !== 'undefined'
        ? window.electron?.connectedSources
        : undefined;
    if (!sources) return;

    let mounted = true;
    // Ids this effect put into the fleet, so it removes exactly its own.
    let placed: string[] = [];

    const sync = async () => {
      let remote: RemoteAgentView[];
      try {
        remote = await sources.agents();
      } catch {
        // A failed read is not evidence about the coworkers. Keep the
        // last-known roster; freshness is what tells the operator the truth.
        return;
      }
      if (!mounted) return;
      const next = remote.map(remoteAgentToExawattAgent);
      for (const agent of next) manager.upsertAgent(agent);
      const live = new Set(next.map(agent => agent.id));
      for (const id of placed) if (!live.has(id)) manager.removeAgent(id);
      placed = next.map(agent => agent.id);
    };

    void sync();
    // A tick names the source that moved and how fresh it is; the roster is
    // pulled here rather than pushed, so a reconnect ladder never costs a
    // topology payload per attempt.
    const off = sources.onChanged?.(() => {
      void sync();
    });

    return () => {
      mounted = false;
      off?.();
      for (const id of placed) manager.removeAgent(id);
      placed = [];
    };
  }, [manager, tenancyHydrated, demoTenantActive]);

  const value = useMemo(
    () => ({
      manager,
      isDemo,
      isLocal,
      projects,
      connectionStatus,
      demoTenantActive,
    }),
    [manager, isDemo, isLocal, projects, connectionStatus, demoTenantActive]
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
