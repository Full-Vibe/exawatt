'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Clock3,
  Crosshair,
  RadioTower,
  Search,
  Sparkles,
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
  type Altitude,
  type SpatialProjectZone,
} from '@exawatt/ui-model';
import type { AgentStatus } from '@exawatt/core';
import {
  createLabelRegistry,
  LabelLayer,
} from './command-table/label-layer';
import {
  DEFAULT_SURFACE_STYLE,
  STYLE_THEMES,
  SURFACE_STYLES,
  SURFACE_STYLE_LABELS,
  isSurfaceStyle,
  type SurfaceStyle,
} from './command-table/style-themes';
import { MenuSurface } from './menu/menu-surface';
import { CommandSurface } from './command/command-surface';

const STYLE_STORAGE_KEY = 'exawatt:spatial-style';

const FILTERABLE_STATUSES: AgentStatus[] = [
  'working',
  'blocked',
  'reviewing',
  'idle',
];

const CommandTableCanvas = dynamic(
  () => import('./command-table-canvas').then(mod => mod.CommandTableCanvas),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full min-h-[520px] items-center justify-center bg-zinc-950 text-sm text-zinc-500">
        Initializing command table...
      </div>
    ),
  }
);

const Console3dSurface = dynamic(
  () => import('./console3d/console3d-surface').then(mod => mod.Console3dSurface),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full min-h-[360px] items-center justify-center bg-[#070b10] text-sm text-zinc-500">
        Initializing console…
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
  const rawStyle = searchParams.get('style');
  const style: SurfaceStyle = isSurfaceStyle(rawStyle)
    ? rawStyle
    : DEFAULT_SURFACE_STYLE;
  const labelRegistry = useRef(createLabelRegistry()).current;
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
        activityLimit: 5,
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
        now: Date.now(), // Attention Scheduling age; recomputed as fleet state ticks
      }),
    [filteredState, altitude, focusedProjectId, selectedAgentId]
  );

  const toggleStatus = (status: AgentStatus) =>
    setStatusFilter(prev =>
      prev.includes(status)
        ? prev.filter(s => s !== status)
        : [...prev, status]
    );

  // Drive zoom-resolution + selection through the URL so altitude / Project /
  // Agent are deep-linkable. The selector resolves the EFFECTIVE altitude (and
  // ascends if a focus target is stale), so the UI reads scene.* back.
  const navigate = useCallback(
    (next: {
      altitude?: Altitude;
      project?: string | null;
      agent?: string | null;
      style?: SurfaceStyle;
    }) => {
      const params = new URLSearchParams(searchParams.toString());
      if ('altitude' in next) {
        if (next.altitude && next.altitude !== 'fleet')
          params.set('altitude', next.altitude);
        else params.delete('altitude');
      }
      if ('style' in next && next.style) {
        if (next.style !== DEFAULT_SURFACE_STYLE) params.set('style', next.style);
        else params.delete('style');
      }
      if ('project' in next) {
        if (next.project) params.set('project', next.project);
        else params.delete('project');
      }
      if ('agent' in next) {
        if (next.agent) params.set('agent', next.agent);
        else params.delete('agent');
      }
      const query = params.toString();
      router.replace(`/fleet/spatial${query ? `?${query}` : ''}`, {
        scroll: false,
      });
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

  const setStyle = useCallback(
    (next: SurfaceStyle) => {
      if (typeof window !== 'undefined') {
        try {
          window.localStorage.setItem(STYLE_STORAGE_KEY, next);
        } catch {
          /* ignore */
        }
      }
      navigate({ style: next });
    },
    [navigate]
  );

  // Seed the style from the last choice when the URL doesn't specify one.
  useEffect(() => {
    if (rawStyle || typeof window === 'undefined') return;
    let saved: string | null = null;
    try {
      saved = window.localStorage.getItem(STYLE_STORAGE_KEY);
    } catch {
      /* ignore */
    }
    if (saved && isSurfaceStyle(saved) && saved !== DEFAULT_SURFACE_STYLE) {
      navigate({ style: saved });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const drillToProject = (zone: SpatialProjectZone) =>
    navigate({ altitude: 'project', project: zone.clusterId, agent: null });

  // Clicking a tile / hero card drills to the agent; clicking empty space ascends.
  const handleSelectAgent = (agentId: string | null) => {
    if (agentId) navigate({ altitude: 'agent', agent: agentId });
    else ascend();
  };

  // Escape ascends one altitude level — but not while typing in a field (there
  // Escape clears the search; see the input's onKeyDown).
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
    <div className="fleet-shell flex min-h-screen flex-col overflow-hidden text-zinc-100">
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
          onClick={() => navigate({ altitude: 'fleet', project: null, agent: null })}
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
          <div
            className="flex items-center gap-0.5 rounded border border-zinc-800 bg-zinc-950/80 p-0.5"
            role="group"
            aria-label="Surface style"
          >
            {SURFACE_STYLES.map(s => (
              <button
                key={s}
                onClick={() => setStyle(s)}
                aria-pressed={style === s}
                className={`rounded px-1.5 py-0.5 text-[10px] transition ${
                  style === s
                    ? 'bg-teal-600 text-white'
                    : 'text-zinc-400 hover:text-zinc-100'
                }`}
              >
                {SURFACE_STYLE_LABELS[s]}
              </button>
            ))}
          </div>
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
          className={
            style === 'menu' || style === 'command'
              ? 'relative min-h-0 overflow-y-auto'
              : 'relative h-[52vh] min-h-[360px] overflow-hidden xl:h-auto xl:min-h-[62vh]'
          }
          aria-label="Fleet command surface"
        >
          {style === 'command' ? (
            <CommandSurface
              scene={scene}
              agents={commandView.agents}
              metrics={commandView.metrics}
              selectedAgentId={selectedAgentId}
              onDrillProject={drillToProject}
              onSelectAgent={handleSelectAgent}
            />
          ) : style === 'menu' ? (
            <MenuSurface
              scene={scene}
              agents={commandView.agents}
              metrics={commandView.metrics}
              selectedAgentId={selectedAgentId}
              onDrillProject={drillToProject}
              onSelectAgent={handleSelectAgent}
            />
          ) : style === 'console-3d' ? (
            <Console3dSurface
              scene={scene}
              agents={commandView.agents}
              metrics={commandView.metrics}
              selectedAgentId={selectedAgentId}
              onDrillProject={drillToProject}
              onSelectAgent={handleSelectAgent}
            />
          ) : (
            <>
          <CommandTableCanvas
            scene={scene}
            style={style}
            labelRegistry={labelRegistry}
            onSelectAgent={handleSelectAgent}
            onSelectProject={drillToProject}
          />

          {/* Projected DOM labels: crisp HTML cards positioned over each Project
              zone by the in-canvas projector. Sibling of the canvas, same box. */}
          <LabelLayer
            scene={scene}
            theme={STYLE_THEMES[style]}
            registry={labelRegistry}
          />

          {/* Keyboard / screen-reader equivalent for the pointer-only 3D drill:
              the WebGL canvas isn't focusable, so mirror its actions as buttons. */}
          {scene.altitude === 'fleet' && (
            <ul aria-label="Projects" className="sr-only">
              {scene.groups
                .filter(zone => !zone.isAggregate)
                .map(zone => (
                  <li key={zone.clusterId}>
                    <button onClick={() => drillToProject(zone)}>
                      {zone.label}
                    </button>
                  </li>
                ))}
            </ul>
          )}
          {scene.altitude === 'project' && (
            <ul aria-label="Agents" className="sr-only">
              {scene.tiles.map(tile => (
                <li key={tile.id}>
                  <button onClick={() => handleSelectAgent(tile.agentId)}>
                    {tile.label}
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="pointer-events-none absolute left-3 top-3 grid max-w-[64%] grid-cols-2 gap-2 sm:left-4 sm:top-4 sm:max-w-none sm:grid-cols-4">
            <SpatialMetric
              label="Active"
              value={String(commandView.metrics.activeCount)}
              tone="teal"
            />
            <SpatialMetric
              label="Blocked"
              value={String(commandView.metrics.blockedCount)}
              tone="red"
            />
            <SpatialMetric
              label="Burn/hr"
              value={`${formatCurrency(commandView.metrics.totalCostRate)}/hr`}
              tone="amber"
            />
            <SpatialMetric
              label="Spend"
              value={formatCurrency(commandView.metrics.totalCost)}
              tone="zinc"
            />
          </div>
            </>
          )}
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
                    <Link
                      href={`/fleet/${encodeURIComponent(inspectedAgent.id)}`}
                    >
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

          <section className="fleet-panel min-h-0 flex-1 overflow-hidden p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-zinc-100">
              <Sparkles className="h-4 w-4 text-amber-200" />
              Signals
            </div>
            <div className="space-y-3 overflow-y-auto pr-1">
              {!scene.attention.hero &&
              scene.attention.secondary.length === 0 &&
              commandView.activityFeed.length === 0 ? (
                <p className="rounded-md border border-zinc-800 bg-zinc-950/50 p-3 text-sm text-zinc-500">
                  Waiting for events.
                </p>
              ) : (
                <>
                  {scene.attention.hero && (
                    <Link
                      href={`/fleet/${encodeURIComponent(scene.attention.hero.agentId)}`}
                      className="block rounded-md border border-red-300/30 bg-red-300/15 p-3 transition hover:border-red-200/50 hover:bg-red-300/20"
                    >
                      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-red-200/80">
                        Hero blocker
                      </p>
                      <p className="mt-1 truncate text-sm font-semibold text-red-100">
                        {scene.attention.hero.agentName}
                      </p>
                      <p className="mt-1 line-clamp-2 text-sm text-red-100/75">
                        {scene.attention.hero.title}
                      </p>
                      <p className="mt-1.5 text-[11px] font-medium text-red-200/70">
                        {scene.attention.hero.reason}
                      </p>
                    </Link>
                  )}
                  {scene.attention.secondary.map(item => (
                    <Link
                      key={item.agentId}
                      href={`/fleet/${encodeURIComponent(item.agentId)}`}
                      className="block rounded-md border border-amber-300/20 bg-amber-300/10 p-3 transition hover:border-amber-200/40 hover:bg-amber-300/15"
                    >
                      <p className="truncate text-sm font-semibold text-amber-100">
                        {item.agentName}
                      </p>
                      <p className="mt-1 line-clamp-2 text-sm text-amber-100/75">
                        {item.title}
                      </p>
                      <p className="mt-1.5 text-[11px] font-medium text-amber-200/70">
                        {item.reason}
                      </p>
                    </Link>
                  ))}
                  {scene.attention.overflowCount > 0 && (
                    <p className="rounded-md border border-amber-300/20 bg-amber-300/5 px-3 py-2 text-xs font-medium text-amber-200/80">
                      +{scene.attention.overflowCount} more need you
                    </p>
                  )}
                  {commandView.activityFeed.map(item => (
                    <div
                      key={item.id}
                      className="rounded-md border border-zinc-800 bg-zinc-950/50 p-3"
                    >
                      <p className="truncate text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500">
                        {item.agentName}
                      </p>
                      <p className="mt-1 line-clamp-2 text-sm text-zinc-300">
                        {item.content}
                      </p>
                    </div>
                  ))}
                </>
              )}
            </div>
          </section>
        </aside>
      </main>

      <DemoControls />
    </div>
  );
}

function SpatialMetric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: 'teal' | 'red' | 'amber' | 'zinc';
}) {
  const tones = {
    teal: 'border-teal-200/20 bg-teal-300/10 text-teal-100',
    red: 'border-red-200/20 bg-red-300/10 text-red-100',
    amber: 'border-amber-200/20 bg-amber-300/10 text-amber-100',
    zinc: 'border-zinc-700/70 bg-zinc-950/70 text-zinc-100',
  };

  return (
    <div className={`rounded-md border px-3 py-2 backdrop-blur ${tones[tone]}`}>
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
        {label}
      </p>
      <p className="mt-1 font-mono text-sm font-semibold">{value}</p>
    </div>
  );
}
