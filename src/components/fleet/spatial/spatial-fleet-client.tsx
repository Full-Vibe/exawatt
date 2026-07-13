'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Activity,
  Clock3,
  Crosshair,
  Keyboard,
  RadioTower,
  Search,
} from 'lucide-react';
import {
  useConnectToOC,
  useCron,
  useFleet,
  useFleetConnection,
} from '@/lib/fleet/fleet-provider';
import { DemoControls } from '@/components/fleet/demo-controls';
import { FleetMetricsBar } from '@/components/fleet/fleet-metrics-bar';
import { Button } from '@/components/ui/button';
import {
  filterFleetState,
  selectFleetCommandView,
  selectFleetSpatialScene,
  selectSpatialBoardLayout,
  selectSpatialProjectZones,
  type Altitude,
  type SpatialBoardLayout,
  type SpatialBoardProjection,
} from '@exawatt/ui-model';
import { agentGoalDisplay } from './spatial-agent-copy';
import { requestSessionJump } from '@/components/workspace/session-jump';
import { rememberSpatialReturn } from '@/components/nav/spatial-return';
import { useEffectiveShortcut, useShortcuts } from '@/components/shortcuts';
import { useCommandNavigation } from '@/components/nav/command-navigation-provider';
import { formatShortcutKeys, formatShortcutKeysAria } from '@/lib/shortcuts';
import {
  readSpatialFilters,
  SPATIAL_FILTERABLE_STATUSES,
  spatialViewportStorageKey,
  writeSpatialFilters,
} from './spatial-navigation-state';

// The Spatial Operations Board is route-scoped. ssr:false keeps Three.js out of
// the DOM fleet bundle and lets the Electron/web shells share the same model.
const OperationsBoardSurface = dynamic(
  () =>
    import('./operations-board/operations-board-surface').then(
      mod => mod.OperationsBoardSurface
    ),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full min-h-[360px] items-center justify-center bg-[#070b10] text-sm text-zinc-500">
        Preparing operations board…
      </div>
    ),
  }
);

export function SpatialFleetClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const rawAltitude = searchParams.get('altitude');
  const altitude: Altitude =
    rawAltitude === 'project' || rawAltitude === 'agent'
      ? rawAltitude
      : 'fleet';
  const focusedProjectId = searchParams.get('project');
  const selectedAgentId = searchParams.get('agent');
  const projection: SpatialBoardProjection =
    searchParams.get('projection') === 'fixed-angle'
      ? 'fixed-angle'
      : 'top-down';
  const { fleetState } = useFleet();
  const { isDemo } = useFleetConnection();
  const { connectToRealOC, canConnect } = useConnectToOC();
  const { jobs } = useCron();
  const { openHelpModal } = useShortcuts();
  const { navigateCommandSurface } = useCommandNavigation();
  const helpKeys = useEffectiveShortcut('help-modal-slash');
  const helpShortcut = helpKeys ? formatShortcutKeys(helpKeys) : null;

  // Semantic filters live in the URL so a Spatial address survives route and
  // session handoffs. Camera position remains renderer-session state.
  const { query, statuses: statusFilter } = useMemo(
    () => readSpatialFilters(searchParams),
    [searchParams]
  );
  const [sessionHandoffAgentId, setSessionHandoffAgentId] = useState<
    string | null
  >(null);
  const [sessionHandoffError, setSessionHandoffError] = useState<string | null>(
    null
  );
  const filtered = query.trim() !== '' || statusFilter.length > 0;
  const filteredState = useMemo(
    () => filterFleetState(fleetState, { query, statuses: statusFilter }),
    [fleetState, query, statusFilter]
  );

  // Metrics stay fleet-wide (unfiltered); zones/tiles reflect the filter.
  const commandView = useMemo(
    () =>
      selectFleetCommandView(fleetState, {
        heartbeatJobs: jobs,
        selectedAgentId,
        activityLimit: 8,
        blockerLimit: 4,
        now: Date.now(),
      }),
    [fleetState, jobs, selectedAgentId]
  );

  const scene = useMemo(
    () =>
      selectFleetSpatialScene(fleetState, {
        altitude,
        focusedProjectId,
        selectedAgentId,
        blockerLimit: 3,
        now: Date.now(), // Attention Scheduling age; recomputed as fleet ticks
      }),
    [fleetState, altitude, focusedProjectId, selectedAgentId]
  );

  // The layout computes from the full fleet, then applies filter visibility so
  // surviving Projects/Agents keep their addresses. Previous output preserves
  // existing slots when live Projects or Agents arrive.
  const previousBoardLayout = useRef<SpatialBoardLayout | null>(null);
  const visibleAgentIds = useMemo(
    () => new Set(Object.keys(filteredState.agents)),
    [filteredState.agents]
  );
  const boardLayout = useMemo(
    () =>
      selectSpatialBoardLayout(fleetState, {
        altitude,
        focusedProjectId,
        selectedAgentId,
        projection,
        visibleAgentIds,
        previousLayout: previousBoardLayout.current,
      }),
    [
      altitude,
      fleetState,
      focusedProjectId,
      projection,
      selectedAgentId,
      visibleAgentIds,
    ]
  );
  useEffect(() => {
    previousBoardLayout.current = boardLayout;
  }, [boardLayout]);

  // Legacy semantic selectors continue to supply Attention and DOM inspector
  // content during V2.0; renderer layout is owned by the board model above.
  const fieldZones = useMemo(
    () => selectSpatialProjectZones(fleetState, { now: Date.now() }),
    [fleetState]
  );

  const updateFilters = useCallback(
    (next: { query: string; statuses: typeof statusFilter }) => {
      const params = writeSpatialFilters(
        new URLSearchParams(searchParams.toString()),
        next
      );
      const value = params.toString();
      router.replace(`/fleet/spatial${value ? `?${value}` : ''}`, {
        scroll: false,
      });
    },
    [router, searchParams]
  );

  const toggleStatus = (status: (typeof statusFilter)[number]) =>
    updateFilters({
      query,
      statuses: statusFilter.includes(status)
        ? statusFilter.filter(item => item !== status)
        : [...statusFilter, status],
    });

  const viewportStorageKey = spatialViewportStorageKey({
    altitude: scene.altitude,
    projectId: scene.focusedProjectId,
    agentId: scene.selectedAgentId,
    projection,
  });

  useEffect(() => {
    const queryString = searchParams.toString();
    rememberSpatialReturn(
      `/fleet/spatial${queryString ? `?${queryString}` : ''}`
    );
  }, [searchParams]);

  // Drive zoom-resolution + selection through the URL (deep-linkable). The
  // selector resolves the effective altitude (ascends if a focus is stale).
  const navigate = useCallback(
    (next: {
      altitude?: Altitude;
      project?: string | null;
      agent?: string | null;
    }) => {
      const params = new URLSearchParams(searchParams.toString());
      if ('altitude' in next) {
        if (next.altitude && next.altitude !== 'fleet')
          params.set('altitude', next.altitude);
        else params.delete('altitude');
      }
      if ('project' in next) {
        if (next.project) params.set('project', next.project);
        else params.delete('project');
      }
      if ('agent' in next) {
        if (next.agent) params.set('agent', next.agent);
        else params.delete('agent');
      }
      const q = params.toString();
      router.replace(`/fleet/spatial${q ? `?${q}` : ''}`, { scroll: false });
    },
    [router, searchParams]
  );

  const ascend = useCallback(() => {
    if (scene.altitude === 'agent') {
      navigate({
        altitude: 'project',
        project: scene.focusedProjectId,
        agent: null,
      });
    } else if (scene.altitude === 'project') {
      navigate({ altitude: 'fleet', project: null, agent: null });
    }
  }, [scene.altitude, scene.focusedProjectId, navigate]);

  const drillToProject = useCallback(
    (clusterId: string) =>
      navigate({ altitude: 'project', project: clusterId, agent: null }),
    [navigate]
  );

  const overview = useCallback(
    () => navigate({ altitude: 'fleet', project: null, agent: null }),
    [navigate]
  );

  const changeProjection = useCallback(
    (next: SpatialBoardProjection) => {
      const params = new URLSearchParams(searchParams.toString());
      if (next === 'fixed-angle') params.set('projection', next);
      else params.delete('projection');
      const queryString = params.toString();
      router.replace(`/fleet/spatial${queryString ? `?${queryString}` : ''}`, {
        scroll: false,
      });
    },
    [router, searchParams]
  );

  // Clicking an agent drills to the agent (with its owning Project as the
  // focused context); clicking empty space ascends.
  const handleSelectAgent = useCallback(
    (agentId: string | null) => {
      if (agentId) {
        const owner =
          fieldZones.find(z => z.agentIds.includes(agentId))?.clusterId ?? null;
        navigate({ altitude: 'agent', project: owner, agent: agentId });
      } else {
        ascend();
      }
    },
    [fieldZones, navigate, ascend]
  );

  // Escape ascends one altitude — but not while typing (there it clears search).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable
      ) {
        return;
      }
      if (event.key === 'Escape') ascend();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ascend]);

  const focusedZoneLabel = scene.groups[0]?.label ?? null;
  const inspectedAgent =
    scene.altitude === 'agent'
      ? (commandView.agents.find(agent => agent.id === selectedAgentId) ?? null)
      : null;
  const visibleActivity = useMemo(() => {
    if (scene.altitude === 'agent' && selectedAgentId) {
      return commandView.activityFeed.filter(
        item => item.agentId === selectedAgentId
      );
    }
    if (scene.altitude === 'project' && scene.focusedProjectId) {
      const memberIds = new Set(
        fieldZones.find(zone => zone.clusterId === scene.focusedProjectId)
          ?.agentIds ?? []
      );
      return commandView.activityFeed.filter(item =>
        memberIds.has(item.agentId)
      );
    }
    return commandView.activityFeed;
  }, [
    commandView.activityFeed,
    fieldZones,
    scene.altitude,
    scene.focusedProjectId,
    selectedAgentId,
  ]);
  const inspectedGoal = inspectedAgent
    ? agentGoalDisplay(inspectedAgent.goal)
    : null;

  const openInspectedSession = useCallback(async () => {
    if (!inspectedAgent || sessionHandoffAgentId) return;
    setSessionHandoffError(null);
    const detailHref = `/fleet/${encodeURIComponent(inspectedAgent.id)}`;
    const pty = window.electron?.pty;
    if (!pty) {
      router.push(detailHref);
      return;
    }

    try {
      let sessionRef = inspectedAgent.sessionKey;
      if (inspectedAgent.sessionState !== 'stopped') {
        const sessions = await pty.list();
        const session = sessions.find(
          candidate => candidate.id === inspectedAgent.sessionKey
        );
        if (!session) {
          router.push(detailHref);
          return;
        }
        sessionRef = session.id;
      }

      rememberSpatialReturn(
        `${window.location.pathname}${window.location.search}`
      );
      setSessionHandoffAgentId(inspectedAgent.id);
      const reduced = window.matchMedia(
        '(prefers-reduced-motion: reduce)'
      ).matches;
      await new Promise(resolve =>
        window.setTimeout(resolve, reduced ? 40 : 240)
      );
      requestSessionJump(sessionRef);
      navigateCommandSurface('/workspace');
    } catch {
      setSessionHandoffAgentId(null);
      setSessionHandoffError(
        'The live terminal could not be opened. Your board position is unchanged.'
      );
    }
  }, [inspectedAgent, navigateCommandSurface, router, sessionHandoffAgentId]);
  const showSideRail = Boolean(inspectedAgent || visibleActivity.length > 0);

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);

  return (
    <div
      data-spatial-command
      data-spatial-altitude={scene.altitude}
      data-agent-count={commandView.agents.length}
      className="fleet-shell flex min-h-[calc(100svh-3rem)] flex-col overflow-x-hidden text-zinc-100 xl:h-[calc(100svh-3rem)] xl:overflow-hidden"
    >
      <FleetMetricsBar />

      <header className="relative z-20 flex shrink-0 flex-wrap items-center gap-3 border-b border-zinc-800/80 bg-zinc-950/90 px-4 py-3 backdrop-blur">
        <div className="flex min-w-0 items-center gap-2">
          <Crosshair className="h-4 w-4 text-teal-200" />
          <h1 className="truncate text-lg font-semibold tracking-tight text-zinc-50">
            Spatial Command
          </h1>
          <span className="rounded-full border border-zinc-800 bg-zinc-950/70 px-2 py-0.5 text-xs text-zinc-500">
            {isDemo ? 'Demo' : 'Live'}
          </span>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button asChild className="fleet-action-button h-8">
            <Link href="/fleet/cron">
              <Clock3 className="h-4 w-4" />
              Heartbeats
            </Link>
          </Button>
          {canConnect && (
            <Button
              onClick={connectToRealOC}
              className="fleet-action-button h-8 bg-teal-300 text-zinc-950 hover:bg-teal-200"
            >
              <RadioTower className="h-4 w-4" />
              Connect
            </Button>
          )}
          <Button
            type="button"
            className="fleet-action-button grid h-11 w-11 place-items-center p-0 xl:hidden"
            onClick={openHelpModal}
            aria-label="Keyboard shortcuts"
            aria-keyshortcuts={
              helpKeys ? formatShortcutKeysAria(helpKeys) : undefined
            }
            title={`Keyboard shortcuts${helpShortcut ? ` · ${helpShortcut}` : ''}`}
          >
            <Keyboard className="h-4 w-4" />
          </Button>
        </div>
      </header>

      <nav
        aria-label="Zoom altitude"
        className="relative z-20 flex shrink-0 items-center gap-1 border-b border-zinc-800/60 bg-zinc-950/70 px-4 py-1.5 text-xs"
      >
        <span className="sr-only" aria-live="polite">
          {scene.altitude === 'agent' && inspectedAgent
            ? `Agent view: ${inspectedAgent.name}`
            : scene.altitude === 'project' && focusedZoneLabel
              ? `Project view: ${focusedZoneLabel}`
              : 'Fleet view'}
        </span>
        <button
          onClick={() =>
            navigate({ altitude: 'fleet', project: null, agent: null })
          }
          className={`rounded px-2 py-1 transition ${
            scene.altitude === 'fleet'
              ? 'text-teal-200'
              : 'text-zinc-400 hover:text-zinc-100'
          }`}
        >
          Fleet
        </button>
        {scene.altitude !== 'fleet' && focusedZoneLabel && (
          <>
            <span className="text-zinc-600">›</span>
            <button
              onClick={() =>
                navigate({
                  altitude: 'project',
                  project: scene.focusedProjectId,
                  agent: null,
                })
              }
              className={`max-w-[40vw] truncate rounded px-2 py-1 transition ${
                scene.altitude === 'project'
                  ? 'text-teal-200'
                  : 'text-zinc-400 hover:text-zinc-100'
              }`}
            >
              {focusedZoneLabel}
            </button>
          </>
        )}
        {scene.altitude === 'agent' && inspectedAgent && (
          <>
            <span className="text-zinc-600">›</span>
            <span
              className="max-w-[40vw] truncate rounded px-2 py-1 text-teal-200"
              title={inspectedAgent.name}
            >
              {inspectedAgent.name}
            </span>
          </>
        )}
        {scene.altitude !== 'fleet' && (
          <span className="hidden text-[11px] text-zinc-600 sm:inline">
            Esc to zoom out
          </span>
        )}

        {scene.altitude !== 'agent' && (
          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            <div className="flex items-center gap-1 rounded border border-zinc-800 bg-zinc-950/80 px-2 py-1">
              <Search className="h-3 w-3 text-zinc-500" />
              <input
                value={query}
                onChange={event =>
                  updateFilters({
                    query: event.target.value,
                    statuses: statusFilter,
                  })
                }
                onKeyDown={event => {
                  if (event.key === 'Escape') {
                    event.stopPropagation();
                    updateFilters({ query: '', statuses: statusFilter });
                  }
                }}
                placeholder="Search agents…"
                aria-label="Search agents"
                className="w-24 rounded-sm bg-transparent text-[11px] text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus-visible:ring-1 focus-visible:ring-teal-400/70 sm:w-40"
              />
            </div>
            <div className="flex flex-wrap items-center gap-1">
              {SPATIAL_FILTERABLE_STATUSES.map(status => (
                <button
                  key={status}
                  onClick={() => toggleStatus(status)}
                  aria-pressed={statusFilter.includes(status)}
                  className={`rounded px-1.5 py-1 text-[10px] capitalize transition ${
                    statusFilter.includes(status)
                      ? 'bg-teal-600 text-white'
                      : 'text-zinc-400 hover:text-zinc-100'
                  }`}
                >
                  {status}
                </button>
              ))}
            </div>
            {filtered && (
              <button
                onClick={() => {
                  updateFilters({ query: '', statuses: [] });
                }}
                className="rounded px-1.5 py-1 text-[10px] text-zinc-500 hover:text-zinc-200"
                title="Clear search and filters"
              >
                clear
              </button>
            )}
          </div>
        )}
      </nav>

      <main
        className={`relative grid min-h-0 flex-1 xl:overflow-hidden ${
          showSideRail ? 'xl:grid-cols-[minmax(0,1fr)_340px]' : ''
        }`}
      >
        <section
          className="relative h-[52svh] min-h-[360px] overflow-hidden sm:min-h-[420px] xl:h-auto"
          aria-label="Fleet command surface"
        >
          <OperationsBoardSurface
            layout={boardLayout}
            projection={projection}
            hero={
              scene.attention.hero
                ? {
                    agentId: scene.attention.hero.agentId,
                    title: scene.attention.hero.title,
                    reason: scene.attention.hero.reason,
                  }
                : null
            }
            onDrillProject={drillToProject}
            onSelectAgent={handleSelectAgent}
            onOverview={overview}
            onProjectionChange={changeProjection}
            sessionTransitionAgentId={sessionHandoffAgentId}
            viewportStorageKey={viewportStorageKey}
          />
        </section>

        {showSideRail && (
          <aside className="relative z-10 flex flex-col gap-3 border-t border-zinc-800 bg-zinc-950/94 p-4 pb-24 xl:min-h-0 xl:border-l xl:border-t-0 xl:pb-4">
            {inspectedAgent ? (
              <section className="fleet-panel p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500">
                      Selected Agent
                    </p>
                    <h2 className="mt-1 break-words text-xl font-semibold leading-tight text-zinc-50">
                      {inspectedAgent.name}
                    </h2>
                  </div>
                  <span className="rounded-full border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs capitalize text-zinc-300">
                    {inspectedAgent.sessionState === 'stopped'
                      ? 'stopped'
                      : inspectedAgent.status}
                  </span>
                </div>

                <div className="mt-4 space-y-1.5">
                  <p className="text-sm leading-6 text-zinc-300">
                    {inspectedGoal?.summary}
                  </p>
                  {inspectedGoal?.context && (
                    <p
                      className="break-words font-mono text-xs leading-5 text-zinc-500"
                      title={inspectedGoal.contextTitle ?? undefined}
                    >
                      {inspectedGoal.context}
                    </p>
                  )}
                </div>

                <dl className="mt-4 grid grid-cols-2 divide-x divide-zinc-800 border-y border-zinc-800 py-3 text-sm">
                  <div className="px-3 first:pl-0">
                    <p className="text-xs text-zinc-500">Cost</p>
                    <p className="mt-1 font-mono text-zinc-100">
                      {formatCurrency(inspectedAgent.cost)}
                    </p>
                  </div>
                  <div className="px-3">
                    <p className="text-xs text-zinc-500">Turns</p>
                    <p className="mt-1 font-mono text-zinc-100">
                      {inspectedAgent.turnCount}
                    </p>
                  </div>
                </dl>

                {inspectedAgent.needsOperator && (
                  <div className="mt-4 rounded-md border border-red-300/20 bg-red-300/10 p-3 text-sm text-red-100">
                    <div className="flex items-center gap-2 font-semibold">
                      <AlertTriangle className="h-4 w-4" />
                      {inspectedAgent.blockerTitle ?? 'Needs operator'}
                    </div>
                    {inspectedAgent.blockerDescription && (
                      <p className="mt-2 line-clamp-3 text-red-100/75">
                        {inspectedAgent.blockerDescription}
                      </p>
                    )}
                  </div>
                )}

                {sessionHandoffError && (
                  <p
                    role="alert"
                    className="mt-4 border border-red-300/20 bg-red-300/10 p-3 text-sm leading-5 text-red-100"
                  >
                    {sessionHandoffError}
                  </p>
                )}

                <div className="mt-4 flex flex-wrap gap-2">
                  <Button
                    type="button"
                    data-open-agent-session={inspectedAgent.id}
                    className="fleet-action-button"
                    disabled={Boolean(sessionHandoffAgentId)}
                    onClick={() => void openInspectedSession()}
                  >
                    {sessionHandoffAgentId
                      ? 'Opening…'
                      : inspectedAgent.sessionState === 'stopped'
                        ? 'Open stopped session'
                        : 'Open session'}
                  </Button>
                  {inspectedAgent.needsOperator && (
                    <Button
                      asChild
                      className="fleet-action-button bg-red-200 text-zinc-950 hover:bg-red-100"
                    >
                      <Link
                        href={`/fleet/${encodeURIComponent(inspectedAgent.id)}`}
                      >
                        Clear
                      </Link>
                    </Button>
                  )}
                </div>
              </section>
            ) : null}

            {/* Activity feed — a live event stream, distinct from the hero/blocker
              attention shown on the surface itself (no duplicate blocker list). */}
            <section
              className={`fleet-panel overflow-hidden p-4 ${
                visibleActivity.length > 0 ? 'min-h-0 flex-1' : ''
              }`}
            >
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-zinc-100">
                <Activity className="h-4 w-4 text-teal-200" />
                Activity
              </div>
              <div className="space-y-2 overflow-y-auto pr-1">
                {visibleActivity.length === 0 ? (
                  <p className="text-sm leading-5 text-zinc-500">
                    {scene.altitude === 'fleet'
                      ? 'Waiting for events.'
                      : `No recent activity for this ${scene.altitude === 'agent' ? 'Agent' : 'Project'}.`}
                  </p>
                ) : (
                  visibleActivity.map(item => (
                    <div
                      key={item.id}
                      className="rounded-md border border-zinc-800/70 bg-zinc-950/50 p-2.5"
                    >
                      <p className="truncate text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-500">
                        {item.agentName}
                      </p>
                      <p className="mt-0.5 line-clamp-2 text-sm text-zinc-300">
                        {item.content}
                      </p>
                    </div>
                  ))
                )}
              </div>
            </section>
          </aside>
        )}
      </main>

      <DemoControls />
    </div>
  );
}
