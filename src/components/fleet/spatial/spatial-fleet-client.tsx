'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Activity,
  Clock3,
  Crosshair,
  FlaskConical,
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
  selectSpatialProjectZones,
  type Altitude,
} from '@exawatt/ui-model';
import type { AgentStatus } from '@exawatt/core';

const FILTERABLE_STATUSES: AgentStatus[] = [
  'working',
  'blocked',
  'reviewing',
  'idle',
];

// The single Fleet spatial surface: the AgentField WebGL world (instanced
// tactical cluster map) under DOM chrome. ssr:false so three.js loads only on
// this route.
const AgentFieldSurface = dynamic(
  () =>
    import('./agent-field/agent-field-surface').then(
      mod => mod.AgentFieldSurface
    ),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full min-h-[360px] items-center justify-center bg-[#070b10] text-sm text-zinc-500">
        Initializing field…
      </div>
    ),
  }
);

export function SpatialFleetClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const rawAltitude = searchParams.get('altitude');
  const altitude: Altitude =
    rawAltitude === 'project' || rawAltitude === 'agent' ? rawAltitude : 'fleet';
  const focusedProjectId = searchParams.get('project');
  const selectedAgentId = searchParams.get('agent');
  const { fleetState } = useFleet();
  const { isDemo } = useFleetConnection();
  const { connectToRealOC, canConnect } = useConnectToOC();
  const { jobs } = useCron();

  // Fleet-scale search / status filter. Empty = full fleet (no behavior change).
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<AgentStatus[]>([]);
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
      selectFleetSpatialScene(filteredState, {
        altitude,
        focusedProjectId,
        selectedAgentId,
        blockerLimit: 3,
        now: Date.now(), // Attention Scheduling age; recomputed as fleet ticks
      }),
    [filteredState, altitude, focusedProjectId, selectedAgentId]
  );

  // The world always shows the WHOLE (filtered) fleet regardless of altitude —
  // altitude only moves the camera. Fleet-level zones feed the field layout.
  const fieldZones = useMemo(
    () => selectSpatialProjectZones(filteredState, { now: Date.now() }),
    [filteredState]
  );

  const toggleStatus = (status: AgentStatus) =>
    setStatusFilter(prev =>
      prev.includes(status)
        ? prev.filter(s => s !== status)
        : [...prev, status]
    );

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

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);

  return (
    <div className="fleet-shell flex h-[calc(100svh-3rem)] flex-col overflow-hidden text-zinc-100">
      <FleetMetricsBar />

      <header className="relative z-20 flex shrink-0 flex-wrap items-center gap-3 border-b border-zinc-800/80 bg-zinc-950/90 px-4 py-3 backdrop-blur">
        <Button
          asChild
          variant="ghost"
          size="sm"
          className="text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
        >
          <Link href="/fleet">
            <ArrowLeft className="h-4 w-4" />
            Fleet
          </Link>
        </Button>

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
          <Link
            href="/hud-gallery"
            title="Internal HUD component library (in development)"
            className="flex items-center gap-1.5 rounded-full border border-amber-400/40 bg-amber-400/10 px-2.5 py-1 text-xs font-medium text-amber-300 transition-colors hover:bg-amber-400/20"
          >
            <FlaskConical className="h-3.5 w-3.5" />
            Dev · HUD Library
          </Link>
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
        </div>
      </header>

      <nav
        aria-label="Zoom altitude"
        className="relative z-20 flex shrink-0 items-center gap-1 border-b border-zinc-800/60 bg-zinc-950/70 px-4 py-1.5 text-xs"
      >
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
            <span className="max-w-[40vw] truncate rounded px-2 py-1 text-teal-200">
              {inspectedAgent.name}
            </span>
          </>
        )}
        {scene.altitude !== 'fleet' && (
          <span className="hidden text-[11px] text-zinc-600 sm:inline">
            Esc to zoom out
          </span>
        )}

        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <div className="flex items-center gap-1 rounded border border-zinc-800 bg-zinc-950/80 px-2 py-1">
            <Search className="h-3 w-3 text-zinc-500" />
            <input
              value={query}
              onChange={event => setQuery(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Escape') {
                  event.stopPropagation();
                  setQuery('');
                }
              }}
              placeholder="Search agents…"
              aria-label="Search agents"
              className="w-24 rounded-sm bg-transparent text-[11px] text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus-visible:ring-1 focus-visible:ring-teal-400/70 sm:w-40"
            />
          </div>
          <div className="flex flex-wrap items-center gap-1">
            {FILTERABLE_STATUSES.map(status => (
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
                setQuery('');
                setStatusFilter([]);
              }}
              className="rounded px-1.5 py-1 text-[10px] text-zinc-500 hover:text-zinc-200"
              title="Clear search and filters"
            >
              clear
            </button>
          )}
        </div>
      </nav>

      <main className="relative grid min-h-0 flex-1 overflow-hidden xl:grid-cols-[minmax(0,1fr)_360px]">
        <section
          className="relative h-[56vh] min-h-[420px] overflow-hidden xl:h-auto"
          aria-label="Fleet command surface"
        >
          <AgentFieldSurface
            zones={fieldZones}
            agents={filteredState.agents}
            altitude={scene.altitude}
            focusedProjectId={scene.focusedProjectId}
            selectedAgentId={selectedAgentId}
            onDrillProject={drillToProject}
            onSelectAgent={handleSelectAgent}
            onOverview={overview}
          />
        </section>

        <aside className="relative z-10 flex min-h-0 flex-col gap-4 border-t border-zinc-800 bg-zinc-950/92 p-4 backdrop-blur xl:border-l xl:border-t-0">
          {inspectedAgent ? (
            <section className="fleet-panel p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500">
                    Selected Agent
                  </p>
                  <h2 className="mt-1 truncate text-xl font-semibold text-zinc-50">
                    {inspectedAgent.name}
                  </h2>
                </div>
                <span className="rounded-full border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs capitalize text-zinc-300">
                  {inspectedAgent.status}
                </span>
              </div>

              <p className="mt-4 line-clamp-3 text-sm leading-6 text-zinc-300">
                {inspectedAgent.goal || 'No goal set'}
              </p>

              <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-md border border-zinc-800 bg-zinc-950/65 p-3">
                  <p className="text-xs text-zinc-500">Cost</p>
                  <p className="mt-1 font-mono text-zinc-100">
                    {formatCurrency(inspectedAgent.cost)}
                  </p>
                </div>
                <div className="rounded-md border border-zinc-800 bg-zinc-950/65 p-3">
                  <p className="text-xs text-zinc-500">Turns</p>
                  <p className="mt-1 font-mono text-zinc-100">
                    {inspectedAgent.turnCount}
                  </p>
                </div>
              </div>

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

              <div className="mt-4 flex flex-wrap gap-2">
                <Button asChild className="fleet-action-button">
                  <Link href={`/fleet/${encodeURIComponent(inspectedAgent.id)}`}>
                    Focus
                  </Link>
                </Button>
                {inspectedAgent.needsOperator && (
                  <Button
                    asChild
                    className="fleet-action-button bg-red-200 text-zinc-950 hover:bg-red-100"
                  >
                    <Link href={`/fleet/${encodeURIComponent(inspectedAgent.id)}`}>
                      Clear
                    </Link>
                  </Button>
                )}
              </div>
            </section>
          ) : (
            <section className="fleet-panel p-4 text-sm text-zinc-500">
              {scene.altitude === 'fleet'
                ? 'Select a Project to zoom in, then an Agent to inspect.'
                : 'Select an Agent to inspect.'}
            </section>
          )}

          {/* Activity feed — a live event stream, distinct from the hero/blocker
              attention shown on the surface itself (no duplicate blocker list). */}
          <section className="fleet-panel min-h-0 flex-1 overflow-hidden p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-zinc-100">
              <Activity className="h-4 w-4 text-teal-200" />
              Activity
            </div>
            <div className="space-y-2 overflow-y-auto pr-1">
              {commandView.activityFeed.length === 0 ? (
                <p className="rounded-md border border-zinc-800 bg-zinc-950/50 p-3 text-sm text-zinc-500">
                  Waiting for events.
                </p>
              ) : (
                commandView.activityFeed.map(item => (
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
      </main>

      <DemoControls />
    </div>
  );
}
