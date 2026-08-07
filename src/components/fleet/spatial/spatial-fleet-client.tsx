'use client';

import dynamic from 'next/dynamic';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Crosshair, Keyboard, RadioTower, Search } from 'lucide-react';
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
  spatialBoardPieceForAgent,
  type Altitude,
  type SpatialBoardLayout,
  type SpatialBoardProjection,
  type SpatialBoardRect,
} from '@exawatt/ui-model';
import { SpatialSelectionPanel } from './spatial-selection-panel';
import { requestSessionJump } from '@/components/workspace/session-jump';
import { rememberSpatialReturn } from '@/components/nav/spatial-return';
import { useEffectiveShortcut, useShortcuts } from '@/components/shortcuts';
import { useCommandNavigation } from '@/components/nav/command-navigation-provider';
import { formatShortcutKeys, formatShortcutKeysAria } from '@/lib/shortcuts';
import {
  readSpatialFilters,
  spatialFilterSignals,
  spatialViewportStorageKey,
  toggleSpatialFilterSignal,
  writeSpatialFilters,
} from './spatial-navigation-state';
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
  // Router replacement is asynchronous; keep the latest requested filters
  // synchronously so two quick pill presses compose instead of the second
  // press reading a stale URL snapshot and replacing the first.
  const requestedFiltersRef = useRef({ query, statuses: statusFilter });
  useEffect(() => {
    requestedFiltersRef.current = { query, statuses: statusFilter };
  }, [query, statusFilter]);
  const [sessionHandoffAgentId, setSessionHandoffAgentId] = useState<
    string | null
  >(null);
  const [sessionHandoffError, setSessionHandoffError] = useState<string | null>(
    null
  );
  const filtered = query.trim() !== '' || statusFilter.length > 0;
  const selectedStatusSignals = useMemo(
    () => spatialFilterSignals(statusFilter),
    [statusFilter]
  );
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
      requestedFiltersRef.current = next;
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

  const toggleStatusSignal = (
    signal: (typeof selectedStatusSignals)[number]
  ) => {
    const current = requestedFiltersRef.current;
    updateFilters({
      query: current.query,
      statuses: toggleSpatialFilterSignal(current.statuses, signal),
    });
  };

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

  const moveAgentSelection = useCallback(
    (agentId: string) => {
      const owner =
        fieldZones.find(zone => zone.agentIds.includes(agentId))?.clusterId ??
        null;
      navigate({
        altitude: scene.altitude,
        project: scene.altitude === 'fleet' ? null : owner,
        agent: agentId,
      });
    },
    [fieldZones, navigate, scene.altitude]
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
  // "What has this unit been doing" (UX pass, 2026-08-02): the panel carries
  // the inspected Agent's own Events. The fleet-wide feed is retired — its
  // state-transition exhaust was chrome nobody read.
  const inspectedActivity = useMemo(() => {
    if (!selectedAgentId) return [];
    return commandView.activityFeed.filter(
      item => item.agentId === selectedAgentId
    );
  }, [commandView.activityFeed, selectedAgentId]);
  // The selection panel is the ONE command surface (S4/F6): the always-present
  // inspector rail and the fleet-wide activity feed are retired, so board
  // chrome is the header strip, the tool cluster, and this panel on selection.
  const selectedAgents = useMemo(() => {
    if (multiSelection.size === 0) return [];
    return commandView.agents.filter(agent => multiSelection.has(agent.id));
  }, [commandView.agents, multiSelection]);
  const inspectedDelegation = useMemo(() => {
    if (!inspectedAgent) return null;
    const piece = spatialBoardPieceForAgent(boardLayout, inspectedAgent.id);
    return piece?.delegation ?? null;
  }, [boardLayout, inspectedAgent]);
  const showSelectionPanel = Boolean(inspectedAgent) || selectedAgents.length > 0;

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
  return (
    <div
      // The inline appearance bootstrap may intentionally change the root
      // before hydration. This diagnostic attribute follows that client
      // snapshot; the visual contract itself is root-token driven.
      suppressHydrationWarning
      data-spatial-command
      data-spatial-altitude={scene.altitude}
      data-agent-count={commandView.agents.length}
      data-spatial-shell-theme={resolvedAppearance.themeId}
      className="flex min-h-[calc(100svh-3rem)] flex-col overflow-x-hidden bg-background text-foreground xl:h-[calc(100svh-3rem)] xl:overflow-hidden"
    >
      <header className="exa-material-chrome relative z-20 flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-4 py-2">
        <span className="sr-only" aria-live="polite">
          {scene.altitude === 'agent' && inspectedAgent
            ? `Agent view: ${inspectedAgent.name}`
            : scene.altitude === 'project' && focusedZoneLabel
              ? `Project view: ${focusedZoneLabel}`
              : 'Fleet view'}
        </span>
        <div className="flex min-w-0 items-center gap-2">
          <Crosshair className="h-4 w-4 text-primary" />
          <button
            type="button"
            onClick={() =>
              navigate({ altitude: 'fleet', project: null, agent: null })
            }
            className="truncate text-left text-lg font-semibold tracking-tight text-foreground outline-none transition-colors hover:text-primary focus-visible:ring-1 focus-visible:ring-ring"
          >
            Fleet
          </button>
          <span className="rounded-full border border-border bg-secondary px-2 py-0.5 text-xs text-muted-foreground">
            {isDemo ? 'Demo' : 'Live'}
          </span>
        </div>
        {scene.altitude !== 'fleet' && focusedZoneLabel && (
          <nav
            aria-label="Zoom altitude"
            className="flex min-w-0 items-center gap-1 text-xs"
          >
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
            {scene.altitude === 'agent' && inspectedAgent && (
              <>
                <span className="text-muted-foreground">›</span>
                <span
                  className="max-w-[24vw] truncate rounded px-2 py-1 text-primary"
                  title={inspectedAgent.name}
                >
                  {inspectedAgent.name}
                </span>
              </>
            )}
          </nav>
        )}
        {scene.altitude !== 'fleet' && (
          <span className="hidden text-chrome-meta text-muted-foreground sm:inline">
            Esc to zoom out
          </span>
        )}

        <div className="hidden h-5 w-px bg-border lg:block" />
        <div className="order-last w-full overflow-x-auto lg:order-none lg:w-auto">
          <FleetMetricsBar
            embedded
            selectedStates={selectedStatusSignals}
            onToggleState={
              scene.altitude === 'agent' ? undefined : toggleStatusSignal
            }
          />
        </div>

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
            {filtered && (
              <span
                className="font-mono text-chrome-micro tabular-nums text-muted-foreground"
                aria-live="polite"
              >
                {Object.keys(filteredState.agents).length} shown
              </span>
            )}
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
        {canConnect && (
          <Button
            onClick={connectToRealOC}
            size="sm"
            className="fleet-action-button h-8"
          >
            <RadioTower className="h-4 w-4" />
            Connect
          </Button>
        )}
        <Button
          type="button"
          size="icon"
          variant="outline"
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
      </header>

      <main
        className={`relative grid flex-none xl:flex-1 xl:overflow-hidden ${
          showSelectionPanel
            ? 'min-h-[calc(100svh+6rem)] xl:min-h-0 xl:grid-cols-[minmax(0,1fr)_340px]'
            : 'min-h-0'
        }`}
      >
        <section
          className="relative h-[52svh] min-h-[360px] overflow-hidden sm:min-h-[420px] xl:h-auto"
          aria-label="Fleet surface"
        >
          <OperationsBoardSurface
            layout={boardLayout}
            projection={projection}
            onDrillProject={drillToProject}
            onSelectAgent={handleSelectAgent}
            onMoveAgentSelection={moveAgentSelection}
            onOverview={overview}
            onProjectionChange={changeProjection}
            multiSelection={multiSelection}
            onToggleAgentSelect={toggleAgentSelect}
            onToggleZoneSelect={toggleZoneSelect}
            onBandSelect={bandSelect}
            sessionTransitionAgentId={sessionHandoffAgentId}
            viewportStorageKey={viewportStorageKey}
          />
        </section>

        {showSelectionPanel && (
          <SpatialSelectionPanel
            agent={inspectedAgent}
            selectedAgents={selectedAgents}
            scopeActivity={scopeActivity}
            activity={inspectedActivity}
            delegation={inspectedDelegation}
            statusColors={{
              active: spatialTheme.status.active,
              blocked: spatialTheme.status['needs-you'],
              idle: spatialTheme.status.off,
            }}
            needsOperatorCallout={needsOperatorCallout}
            faultCallout={faultCallout}
            isDemo={isDemo}
            opening={Boolean(sessionHandoffAgentId)}
            handoffError={sessionHandoffError}
            now={Date.now()}
            onOpenSession={() => void openInspectedSession()}
            onClearSelection={clearMultiSelect}
            onInspectAgent={handleSelectAgent}
          />
        )}
      </main>
    </div>
  );
}
