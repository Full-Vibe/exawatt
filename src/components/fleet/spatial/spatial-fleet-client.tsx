'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Activity,
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
import { FleetMetricsBar } from '@/components/fleet/fleet-metrics-bar';
import { Button } from '@/components/ui/button';
import {
  filterFleetState,
  selectFleetCommandView,
  selectFleetSpatialScene,
  selectSpatialBandAgentIds,
  selectSpatialBoardLayout,
  selectSpatialProjectZones,
  selectSpatialScopeActivity,
  type Altitude,
  type SpatialBoardLayout,
  type SpatialBoardLens,
  type SpatialBoardProjection,
  type SpatialBoardRect,
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
import {
  STATUS_LIGHT_META,
  StatusLight,
  statusLightStateForAgentStatus,
} from '@/components/status-light';
import { useAppearance } from '@/components/appearance/appearance-provider';
import {
  spatialFaultCallout,
  spatialNeedsOperatorCallout,
  spatialThemeFromResolvedAppearance,
} from './spatial-theme';

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
      <div className="flex h-full min-h-[360px] items-center justify-center bg-background text-sm text-muted-foreground">
        Preparing operations board…
      </div>
    ),
  }
);

export function SpatialFleetClient() {
  const { resolved: resolvedAppearance } = useAppearance();
  const spatialTheme = useMemo(
    () => spatialThemeFromResolvedAppearance(resolvedAppearance),
    [resolvedAppearance]
  );
  const needsOperatorCallout = useMemo(
    () => spatialNeedsOperatorCallout(spatialTheme),
    [spatialTheme]
  );
  const faultCallout = useMemo(
    () => spatialFaultCallout(spatialTheme),
    [spatialTheme]
  );
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
  // Consumption lens (ENG-008): status coloring is the default; the URL
  // carries the burn lens like it carries the projection, so a lensed board
  // address survives handoffs. Attention semantics never read it.
  const lens: SpatialBoardLens =
    searchParams.get('lens') === 'burn' ? 'burn' : 'status';
  const { fleetState, projects } = useFleet();
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
        projects,
      }),
    [fleetState, altitude, focusedProjectId, projects, selectedAgentId]
  );

  // The layout computes from the full fleet, then applies filter visibility so
  // surviving Projects/Agents keep their addresses. Previous output preserves
  // existing slots when live Projects or Agents arrive.
  const previousBoardLayout = useRef<SpatialBoardLayout | null>(null);
  const visibleAgentIds = useMemo(
    () => new Set(Object.keys(filteredState.agents)),
    [filteredState.agents]
  );
  const visibleProjectIds = useMemo(() => {
    if (statusFilter.length > 0) return new Set<string>();
    const needle = query.trim().toLowerCase();
    return new Set(
      projects
        .filter(
          project =>
            !needle ||
            project.label.toLowerCase().includes(needle) ||
            project.id.toLowerCase().includes(needle)
        )
        .map(project => `project:${project.id}`)
    );
  }, [projects, query, statusFilter.length]);
  const boardLayout = useMemo(
    () =>
      selectSpatialBoardLayout(fleetState, {
        altitude,
        focusedProjectId,
        selectedAgentId,
        projection,
        visibleAgentIds,
        visibleProjectIds,
        projects,
        previousLayout: previousBoardLayout.current,
      }),
    [
      altitude,
      fleetState,
      focusedProjectId,
      projection,
      projects,
      selectedAgentId,
      visibleAgentIds,
      visibleProjectIds,
    ]
  );
  useEffect(() => {
    previousBoardLayout.current = boardLayout;
  }, [boardLayout]);

  // Multi-selection (V3.2): real, ephemeral, client-owned — the single
  // inspected Agent stays URL-addressed; a band/shift selection is a working
  // set, not an address. Pruned against the filtered fleet so filters and
  // live departures cannot leave phantom members in the count.
  const [multiSelectedIds, setMultiSelectedIds] = useState<ReadonlySet<string>>(
    () => new Set<string>()
  );
  const multiSelection = useMemo(() => {
    if (multiSelectedIds.size === 0) return multiSelectedIds;
    const pruned = new Set<string>();
    for (const id of multiSelectedIds) {
      if (filteredState.agents[id]) pruned.add(id);
    }
    return pruned.size === multiSelectedIds.size ? multiSelectedIds : pruned;
  }, [filteredState.agents, multiSelectedIds]);

  const toggleAgentSelect = useCallback((agentId: string) => {
    setMultiSelectedIds(previous => {
      const next = new Set(previous);
      if (next.has(agentId)) next.delete(agentId);
      else next.add(agentId);
      return next;
    });
  }, []);

  // Zone toggle: all of the zone's visible Agents join the selection; if the
  // zone is already fully selected, they leave it.
  const toggleZoneSelect = useCallback(
    (zoneId: string) => {
      const zone = boardLayout.zones.find(entry => entry.id === zoneId);
      if (!zone) return;
      const members = zone.agentIds.filter(id => visibleAgentIds.has(id));
      if (members.length === 0) return;
      setMultiSelectedIds(previous => {
        const next = new Set(previous);
        const fullySelected = members.every(id => next.has(id));
        for (const id of members) {
          if (fullySelected) next.delete(id);
          else next.add(id);
        }
        return next;
      });
    },
    [boardLayout.zones, visibleAgentIds]
  );

  // Band select replaces the working set (RTS grammar); an empty band clears.
  const bandSelect = useCallback(
    (band: SpatialBoardRect) => {
      setMultiSelectedIds(
        new Set(selectSpatialBandAgentIds(boardLayout, band, visibleAgentIds))
      );
    },
    [boardLayout, visibleAgentIds]
  );

  const clearMultiSelect = useCallback(() => {
    setMultiSelectedIds(previous =>
      previous.size === 0 ? previous : new Set()
    );
  }, []);

  // Scope-aware activity + burn: the selection's totals while one exists,
  // otherwise the (filtered) fleet's.
  const scopeActivity = useMemo(
    () =>
      selectSpatialScopeActivity(
        filteredState,
        multiSelection.size > 0 ? multiSelection : null
      ),
    [filteredState, multiSelection]
  );

  // Legacy semantic selectors continue to supply Attention and DOM inspector
  // content during V2.0; renderer layout is owned by the board model above.
  const fieldZones = useMemo(
    () =>
      selectSpatialProjectZones(fleetState, {
        now: Date.now(),
        projects,
      }),
    [fleetState, projects]
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

  const changeLens = useCallback(
    (next: SpatialBoardLens) => {
      const params = new URLSearchParams(searchParams.toString());
      if (next === 'burn') params.set('lens', next);
      else params.delete('lens');
      const queryString = params.toString();
      router.replace(`/fleet/spatial${queryString ? `?${queryString}` : ''}`, {
        scroll: false,
      });
    },
    [router, searchParams]
  );

  // Clicking an agent drills to the agent (with its owning Project as the
  // focused context); clicking empty space releases the working set first,
  // then ascends (the RTS deselect-before-zoom-out order).
  const handleSelectAgent = useCallback(
    (agentId: string | null) => {
      if (agentId) {
        const owner =
          fieldZones.find(z => z.agentIds.includes(agentId))?.clusterId ?? null;
        navigate({ altitude: 'agent', project: owner, agent: agentId });
      } else if (multiSelection.size > 0) {
        clearMultiSelect();
      } else {
        ascend();
      }
    },
    [ascend, clearMultiSelect, fieldZones, multiSelection.size, navigate]
  );

  // Escape releases the multi-selection first, then ascends one altitude —
  // but not while typing (there it clears search).
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
      if (event.key === 'Escape') {
        if (multiSelection.size > 0) clearMultiSelect();
        else ascend();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ascend, clearMultiSelect, multiSelection.size]);

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
  const inspectedLightState = inspectedAgent
    ? statusLightStateForAgentStatus(inspectedAgent.status)
    : null;

  const openInspectedSession = useCallback(async () => {
    if (!inspectedAgent || sessionHandoffAgentId) return;
    setSessionHandoffError(null);

    // Demo source (ENG-027 W2): the Session opens in the Demo Workspace
    // shell — same jump event, same pending-slot contract, never a PTY.
    if (isDemo) {
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
      requestSessionJump(inspectedAgent.sessionKey);
      navigateCommandSurface('/workspace');
      return;
    }

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
  }, [
    inspectedAgent,
    isDemo,
    navigateCommandSurface,
    router,
    sessionHandoffAgentId,
  ]);
  const showSideRail = Boolean(inspectedAgent || visibleActivity.length > 0);

  const formatTokens = (n: number) =>
    n >= 1_000_000
      ? `${(n / 1_000_000).toFixed(1)}M`
      : n >= 1_000
        ? `${Math.round(n / 1_000)}k`
        : `${n}`;

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
      data-spatial-shell-theme={resolvedAppearance.themeId}
      className="flex min-h-[calc(100svh-3rem)] flex-col overflow-x-hidden bg-background text-foreground xl:h-[calc(100svh-3rem)] xl:overflow-hidden"
    >
      <FleetMetricsBar />

      <header className="exa-material-chrome relative z-20 flex shrink-0 flex-wrap items-center gap-3 border-b border-border px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <Crosshair className="h-4 w-4 text-primary" />
          <h1 className="truncate text-lg font-semibold tracking-tight text-foreground">
            Fleet
          </h1>
          <span className="rounded-full border border-border bg-secondary px-2 py-0.5 text-xs text-muted-foreground">
            {isDemo ? 'Demo' : 'Live'}
          </span>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {canConnect && (
            <Button onClick={connectToRealOC} size="sm">
              <RadioTower className="h-4 w-4" />
              Connect
            </Button>
          )}
          <Button
            type="button"
            size="icon"
            variant="outline"
            className="grid h-11 w-11 place-items-center xl:hidden"
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
        className="exa-material-chrome relative z-20 flex shrink-0 items-center gap-1 border-b border-border px-4 py-1.5 text-xs"
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
              ? 'text-primary'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          Fleet
        </button>
        {scene.altitude !== 'fleet' && focusedZoneLabel && (
          <>
            <span className="text-muted-foreground">›</span>
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
                  ? 'text-primary'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {focusedZoneLabel}
            </button>
          </>
        )}
        {scene.altitude === 'agent' && inspectedAgent && (
          <>
            <span className="text-muted-foreground">›</span>
            <span
              className="max-w-[40vw] truncate rounded px-2 py-1 text-primary"
              title={inspectedAgent.name}
            >
              {inspectedAgent.name}
            </span>
          </>
        )}
        {scene.altitude !== 'fleet' && (
          <span className="hidden text-chrome-meta text-muted-foreground sm:inline">
            Esc to zoom out
          </span>
        )}

        {scene.altitude !== 'agent' && (
          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            <div className="flex items-center gap-1 rounded border border-input bg-background px-2 py-1">
              <Search className="h-3 w-3 text-muted-foreground" />
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
                className="w-24 rounded-sm bg-transparent text-chrome-meta text-foreground placeholder:text-muted-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-ring sm:w-40"
              />
            </div>
            <div className="flex flex-wrap items-center gap-1">
              {SPATIAL_FILTERABLE_STATUSES.map(status => (
                <button
                  key={status}
                  onClick={() => toggleStatus(status)}
                  aria-pressed={statusFilter.includes(status)}
                  className={`rounded px-1.5 py-1 text-chrome-micro capitalize transition ${
                    statusFilter.includes(status)
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:text-foreground'
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
                className="rounded px-1.5 py-1 text-chrome-micro text-muted-foreground hover:text-foreground"
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
          aria-label="Fleet surface"
        >
          <OperationsBoardSurface
            layout={boardLayout}
            projection={projection}
            lens={lens}
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
            onLensChange={changeLens}
            multiSelection={multiSelection}
            onToggleAgentSelect={toggleAgentSelect}
            onToggleZoneSelect={toggleZoneSelect}
            onBandSelect={bandSelect}
            onClearMultiSelect={clearMultiSelect}
            scopeActivity={scopeActivity}
            sessionTransitionAgentId={sessionHandoffAgentId}
            viewportStorageKey={viewportStorageKey}
          />
        </section>

        {showSideRail && (
          <aside className="exa-material-overlay relative z-10 flex flex-col gap-3 border-t border-border p-4 pb-24 xl:min-h-0 xl:border-l xl:border-t-0 xl:pb-4">
            {inspectedAgent ? (
              <section className="exa-material-raised rounded-lg border border-border p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                      Selected Agent
                    </p>
                    <h2 className="mt-1 break-words text-xl font-semibold leading-tight text-foreground">
                      {inspectedAgent.name}
                    </h2>
                  </div>
                  <span className="inline-flex items-center gap-1.5 rounded border border-border bg-background px-2 py-1 font-mono text-xs text-foreground">
                    {inspectedLightState && (
                      <StatusLight
                        decorative
                        size="compact"
                        state={inspectedLightState}
                      />
                    )}
                    {inspectedAgent.sessionState === 'stopped'
                      ? 'stopped'
                      : inspectedLightState
                        ? STATUS_LIGHT_META[inspectedLightState].label
                        : inspectedAgent.status}
                  </span>
                </div>

                <div className="mt-4 space-y-1.5">
                  <p className="text-sm leading-6 text-foreground">
                    {inspectedGoal?.summary}
                  </p>
                  {inspectedGoal?.context && (
                    <p
                      className="break-words font-mono text-xs leading-5 text-muted-foreground"
                      title={inspectedGoal.contextTitle ?? undefined}
                    >
                      {inspectedGoal.context}
                    </p>
                  )}
                </div>

                <dl className="mt-4 grid grid-cols-2 divide-x divide-border border-y border-border py-3 text-sm">
                  {/* Spend renders only when the source reports it; a source
                      with usage but no dollars shows tokens instead (absent,
                      never zero — the local and demo transports report no
                      cost by design). */}
                  {inspectedAgent.cost > 0 ? (
                    <div className="px-3 first:pl-0">
                      <p className="text-xs text-muted-foreground">Cost</p>
                      <p className="mt-1 font-mono text-foreground">
                        {formatCurrency(inspectedAgent.cost)}
                      </p>
                    </div>
                  ) : inspectedAgent.rawTokens !== undefined ? (
                    <div className="px-3 first:pl-0">
                      <p className="text-xs text-muted-foreground">Tokens</p>
                      <p className="mt-1 font-mono text-foreground">
                        {formatTokens(inspectedAgent.rawTokens)}
                      </p>
                    </div>
                  ) : (
                    <div className="px-3 first:pl-0" />
                  )}
                  <div className="px-3">
                    <p className="text-xs text-muted-foreground">Turns</p>
                    <p className="mt-1 font-mono text-foreground">
                      {inspectedAgent.turnCount}
                    </p>
                  </div>
                </dl>

                {inspectedAgent.needsOperator && (
                  <div
                    className="mt-4 rounded-md border p-3 text-sm"
                    style={{
                      borderColor: needsOperatorCallout.border,
                      background: needsOperatorCallout.background,
                      color: needsOperatorCallout.text,
                    }}
                  >
                    <div className="flex items-center gap-2 font-semibold">
                      <AlertTriangle
                        className="h-4 w-4"
                        style={{ color: needsOperatorCallout.signal }}
                      />
                      {inspectedAgent.blockerTitle ?? 'Needs operator'}
                    </div>
                    {inspectedAgent.blockerDescription && (
                      <p
                        className="mt-2 line-clamp-3"
                        style={{ color: needsOperatorCallout.detail }}
                      >
                        {inspectedAgent.blockerDescription}
                      </p>
                    )}
                  </div>
                )}

                {sessionHandoffError && (
                  <p
                    role="alert"
                    className="mt-4 border p-3 text-sm leading-5"
                    style={{
                      borderColor: faultCallout.border,
                      background: faultCallout.background,
                      color: faultCallout.text,
                    }}
                  >
                    {sessionHandoffError}
                  </p>
                )}

                <div className="mt-4 flex flex-wrap gap-2">
                  <Button
                    type="button"
                    data-open-agent-session={inspectedAgent.id}
                    disabled={Boolean(sessionHandoffAgentId)}
                    onClick={() => void openInspectedSession()}
                  >
                    {sessionHandoffAgentId
                      ? 'Opening…'
                      : inspectedAgent.sessionState === 'stopped'
                        ? 'Open stopped session'
                        : 'Open session'}
                  </Button>
                  {inspectedAgent.needsOperator && !isDemo && (
                    <Button asChild variant="destructive">
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
              className={`exa-material-raised overflow-hidden rounded-lg border border-border p-4 ${
                visibleActivity.length > 0 ? 'min-h-0 flex-1' : ''
              }`}
            >
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
                <Activity className="h-4 w-4 text-primary" />
                Activity
              </div>
              <div className="space-y-2 overflow-y-auto pr-1">
                {visibleActivity.length === 0 ? (
                  <p className="text-sm leading-5 text-muted-foreground">
                    {scene.altitude === 'fleet'
                      ? 'Waiting for events.'
                      : `No recent activity for this ${scene.altitude === 'agent' ? 'Agent' : 'Project'}.`}
                  </p>
                ) : (
                  visibleActivity.map(item => (
                    <div
                      key={item.id}
                      className="rounded-md border border-border bg-background/50 p-2.5"
                    >
                      <p className="truncate text-chrome-meta font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                        {item.agentName}
                      </p>
                      <p className="mt-0.5 line-clamp-2 text-sm text-foreground">
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
    </div>
  );
}
