'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMemo } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Clock3,
  Crosshair,
  RadioTower,
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
  selectFleetCommandView,
  selectFleetSpatialScene,
  type SpatialProjectZone,
} from '@exawatt/ui-model';

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

export function SpatialFleetClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedAgentId = searchParams.get('agent');
  const { fleetState } = useFleet();
  const { isDemo } = useFleetConnection();
  const { connectToRealOC, canConnect } = useConnectToOC();
  const { jobs } = useCron();

  const commandView = useMemo(
    () =>
      selectFleetCommandView(fleetState, {
        heartbeatJobs: jobs,
        selectedAgentId,
        activityLimit: 5,
        blockerLimit: 4,
      }),
    [fleetState, jobs, selectedAgentId]
  );

  const scene = useMemo(
    () =>
      selectFleetSpatialScene(fleetState, {
        selectedAgentId,
        blockerLimit: 3,
      }),
    [fleetState, selectedAgentId]
  );

  const selectedAgent =
    commandView.agents.find(agent => agent.id === selectedAgentId) ??
    commandView.agents[0];

  const setSelectedAgent = (agentId: string | null) => {
    const params = new URLSearchParams(searchParams.toString());
    if (agentId) {
      params.set('agent', agentId);
    } else {
      params.delete('agent');
    }
    const query = params.toString();
    router.replace(`/fleet/spatial${query ? `?${query}` : ''}`, {
      scroll: false,
    });
  };

  const handleSelectProject = (zone: SpatialProjectZone) => {
    setSelectedAgent(zone.agentIds[0] ?? null);
  };

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

      <main className="relative grid min-h-0 flex-1 overflow-hidden xl:grid-cols-[minmax(0,1fr)_360px]">
        <section
          className="relative min-h-[62vh] overflow-hidden"
          aria-label="Spatial fleet map"
        >
          <CommandTableCanvas
            scene={scene}
            onSelectAgent={setSelectedAgent}
            onSelectProject={handleSelectProject}
          />

          <div className="pointer-events-none absolute left-4 top-4 grid gap-2 sm:grid-cols-4">
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
        </section>

        <aside className="relative z-10 flex min-h-0 flex-col gap-4 border-t border-zinc-800 bg-zinc-950/92 p-4 backdrop-blur xl:border-l xl:border-t-0">
          {selectedAgent ? (
            <section className="fleet-panel p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500">
                    Selected Agent
                  </p>
                  <h2 className="mt-1 truncate text-xl font-semibold text-zinc-50">
                    {selectedAgent.name}
                  </h2>
                </div>
                <span className="rounded-full border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs capitalize text-zinc-300">
                  {selectedAgent.status}
                </span>
              </div>

              <p className="mt-4 line-clamp-3 text-sm leading-6 text-zinc-300">
                {selectedAgent.goal || 'No goal set'}
              </p>

              <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-md border border-zinc-800 bg-zinc-950/65 p-3">
                  <p className="text-xs text-zinc-500">Cost</p>
                  <p className="mt-1 font-mono text-zinc-100">
                    {formatCurrency(selectedAgent.cost)}
                  </p>
                </div>
                <div className="rounded-md border border-zinc-800 bg-zinc-950/65 p-3">
                  <p className="text-xs text-zinc-500">Turns</p>
                  <p className="mt-1 font-mono text-zinc-100">
                    {selectedAgent.turnCount}
                  </p>
                </div>
              </div>

              {selectedAgent.needsOperator && (
                <div className="mt-4 rounded-md border border-red-300/20 bg-red-300/10 p-3 text-sm text-red-100">
                  <div className="flex items-center gap-2 font-semibold">
                    <AlertTriangle className="h-4 w-4" />
                    {selectedAgent.blockerTitle ?? 'Needs operator'}
                  </div>
                  {selectedAgent.blockerDescription && (
                    <p className="mt-2 line-clamp-3 text-red-100/75">
                      {selectedAgent.blockerDescription}
                    </p>
                  )}
                </div>
              )}

              <div className="mt-4 flex flex-wrap gap-2">
                <Button asChild className="fleet-action-button">
                  <Link href={`/fleet/${encodeURIComponent(selectedAgent.id)}`}>
                    Focus
                  </Link>
                </Button>
                {selectedAgent.needsOperator && (
                  <Button
                    asChild
                    className="fleet-action-button bg-red-200 text-zinc-950 hover:bg-red-100"
                  >
                    <Link
                      href={`/fleet/${encodeURIComponent(selectedAgent.id)}`}
                    >
                      Clear
                    </Link>
                  </Button>
                )}
              </div>
            </section>
          ) : (
            <section className="fleet-panel p-4 text-sm text-zinc-500">
              Select an agent.
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
