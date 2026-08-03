'use client';

/**
 * t11-altitude-handoff — deterministic Team→Fleet handoff fixture
 * (ENG-004 V3.0, decision 0023).
 *
 * Phase "team" renders one card per Voltaic Project with the real
 * `data-handoff-card` capture hooks at Team-altitude-like positions.
 * Pressing **Enter Fleet** (or `f`) runs the REAL machinery: capture →
 * publish → ghost layer → board mount → rig claim → entry pose → crossfade
 * → pull-back. `?claimDelay=<ms>` delays the board mount to simulate a cold
 * route and exercise the missed-frame-budget fallback.
 *
 * Exposes `window.__EVAL_HANDOFF__` for scripts/r3f-eval/spatial.mjs:
 * { allowed, attempted, cardCount, outcome, poseTargets, entryZoom,
 *   poseAt, fallbackAt, drilled }.
 */

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  DEMO_PROJECTS,
  DEMO_PROJECTS_BY_KEY,
  demoFleetAgents,
  type ExawattAgent,
  type FleetMetrics,
  type FleetState,
} from '@exawatt/core';
import { selectSpatialBoardLayout } from '@exawatt/ui-model';
import { OperationsBoardSurface } from '@/components/fleet/spatial/operations-board/operations-board-surface';
import {
  ALTITUDE_HANDOFF_FALLBACK_EVENT,
  ALTITUDE_HANDOFF_POSE_EVENT,
  altitudeHandoffAllowed,
  captureAltitudeCards,
  publishAltitudeHandoff,
  type HandoffPoseDetail,
  type HandoffSnapshot,
} from '@/components/nav/altitude-handoff';
import { AltitudeHandoffGhosts } from '@/components/nav/altitude-handoff-ghosts';

interface EvalHandoffState {
  allowed: boolean;
  attempted: boolean;
  cardCount: number;
  outcome: 'pose' | 'fallback' | null;
  poseTargets: number;
  entryZoom: number | null;
  poseAt: number | null;
  fallbackAt: number | null;
  drilled: string | null;
}

declare global {
  interface Window {
    __EVAL_HANDOFF__?: EvalHandoffState;
  }
}

function evalState(): EvalHandoffState {
  if (!window.__EVAL_HANDOFF__) {
    window.__EVAL_HANDOFF__ = {
      allowed: false,
      attempted: false,
      cardCount: 0,
      outcome: null,
      poseTargets: 0,
      entryZoom: null,
      poseAt: null,
      fallbackAt: null,
      drilled: null,
    };
  }
  return window.__EVAL_HANDOFF__;
}

/** The real W4 Voltaic fleet mapped into FleetState (same mapping as the
 *  t10 scale fixture — the canonical V3.0 tuning target). */
function buildVoltaicFleet(): FleetState {
  const demo = demoFleetAgents('scale');
  const agents: Record<string, ExawattAgent> = {};
  let blocked = 0;
  let active = 0;
  for (const item of demo) {
    if (item.status === 'blocked' || item.status === 'error') blocked++;
    if (item.status === 'working' || item.status === 'reviewing') active++;
    agents[item.id] = {
      id: item.id,
      name: item.name,
      project:
        DEMO_PROJECTS_BY_KEY.get(item.projectKey)?.name ?? item.projectKey,
      status: item.status,
      goal: item.goal,
      sessionKey: item.id,
      metrics: {
        tokensIn: item.usage.input,
        tokensOut: item.usage.output,
        estimatedCost: 0,
        turnCount: item.turns,
        startedAt: item.startedAtMs,
        duration: 0,
        costRate: 0,
        tokenRate: 0,
        costHistory: [],
      },
      lastActivityAt: item.lastActivityAtMs,
      createdAt: item.startedAtMs,
    };
  }
  const metrics: FleetMetrics = {
    activeCount: active,
    blockedCount: blocked,
    idleCount: demo.length - active - blocked,
    totalCost: 0,
    totalTokens: 0,
    totalCostRate: 0,
    costByProject: {},
  };
  return { agents, metrics, lastUpdated: 1 };
}

function HandoffFixture() {
  const params = useSearchParams();
  const claimDelay = Math.max(0, Number(params.get('claimDelay') ?? 0) || 0);
  const [phase, setPhase] = useState<'team' | 'board'>('team');
  const [boardMounted, setBoardMounted] = useState(false);
  const [snapshot, setSnapshot] = useState<HandoffSnapshot | null>(null);

  const state = useMemo(() => buildVoltaicFleet(), []);
  const layout = useMemo(
    () => selectSpatialBoardLayout(state, { altitude: 'fleet' }),
    [state]
  );

  useEffect(() => {
    const target = evalState();
    target.allowed = altitudeHandoffAllowed();
    const onPose = (event: Event) => {
      const detail = (event as CustomEvent<HandoffPoseDetail>).detail;
      const record = evalState();
      record.poseTargets = detail.targets.length;
      record.poseAt = performance.now();
      // `__EVAL_CAM__` is exposed by the Canvas onCreated hook, which can
      // land a frame after the rig dispatches the pose — retry briefly.
      const readZoom = (attempt: number) => {
        const camera = (
          window as unknown as { __EVAL_CAM__?: { zoom: number } }
        ).__EVAL_CAM__;
        if (camera) {
          evalState().entryZoom = camera.zoom;
        } else if (attempt < 12) {
          window.requestAnimationFrame(() => readZoom(attempt + 1));
        }
      };
      readZoom(0);
    };
    const onFallback = () => {
      evalState().fallbackAt = performance.now();
    };
    window.addEventListener(ALTITUDE_HANDOFF_POSE_EVENT, onPose);
    window.addEventListener(ALTITUDE_HANDOFF_FALLBACK_EVENT, onFallback);
    return () => {
      window.removeEventListener(ALTITUDE_HANDOFF_POSE_EVENT, onPose);
      window.removeEventListener(ALTITUDE_HANDOFF_FALLBACK_EVENT, onFallback);
    };
  }, []);

  const enterFleet = useCallback(() => {
    if (phase !== 'team') return;
    const record = evalState();
    // The same gate the transition owner applies: reduced motion or low
    // power never attempts the handoff.
    const captured = altitudeHandoffAllowed() ? captureAltitudeCards() : null;
    record.attempted = captured !== null;
    record.cardCount = captured?.cards.length ?? 0;
    if (captured) {
      publishAltitudeHandoff(captured);
      setSnapshot(captured);
    }
    setPhase('board');
    if (claimDelay > 0) {
      window.setTimeout(() => setBoardMounted(true), claimDelay);
    } else {
      setBoardMounted(true);
    }
  }, [claimDelay, phase]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === 'f' && phase === 'team') enterFleet();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enterFleet, phase]);

  return (
    <main
      data-handoff-fixture-phase={phase}
      className="h-screen min-h-[620px] overflow-hidden bg-[#0a0e13]"
    >
      {phase === 'team' && (
        <div className="h-full overflow-y-auto px-8 py-6">
          <div className="mb-4 flex items-baseline gap-3">
            <h1 className="font-sans text-base font-semibold text-zinc-100">
              Projects &amp; Sessions
            </h1>
            <button
              type="button"
              data-enter-fleet
              onClick={enterFleet}
              className="border border-teal-300/40 bg-teal-300/10 px-3 py-1 font-mono text-xs text-teal-200"
            >
              Enter Fleet (F)
            </button>
          </div>
          <div className="grid grid-cols-2 gap-4">
            {DEMO_PROJECTS.map(project => (
              <section
                key={project.key}
                data-handoff-card=""
                data-handoff-label={project.name}
                data-handoff-color={project.color}
                className="rounded border p-3"
                style={{
                  borderColor: `${project.color}44`,
                  background: 'rgba(7,12,20,0.92)',
                }}
              >
                <div className="flex items-center gap-2">
                  <span
                    className="h-3.5 w-[3px] shrink-0 rounded-full"
                    style={{ background: project.color }}
                  />
                  <h3 className="truncate font-sans text-sm font-semibold text-zinc-100">
                    {project.name}
                  </h3>
                </div>
                <p className="mt-2 line-clamp-2 font-mono text-[10px] leading-4 text-zinc-500">
                  {project.summary}
                </p>
              </section>
            ))}
          </div>
        </div>
      )}
      {phase === 'board' && (
        <>
          {snapshot && (
            <AltitudeHandoffGhosts
              snapshot={snapshot}
              onDone={outcome => {
                evalState().outcome = outcome;
                setSnapshot(null);
              }}
            />
          )}
          {boardMounted ? (
            <div className="h-full overflow-hidden">
              <OperationsBoardSurface
                layout={layout}
                projection="top-down"
                onDrillProject={projectId => {
                  evalState().drilled = projectId;
                }}
                onSelectAgent={() => undefined}
                onOverview={() => undefined}
                onProjectionChange={() => undefined}
                viewportStorageKey="exawatt:spatial-viewport:t11"
                preserveDrawingBuffer
              />
            </div>
          ) : (
            <div className="grid h-full place-items-center font-mono text-xs text-zinc-600">
              loading board…
            </div>
          )}
        </>
      )}
    </main>
  );
}

export default function AltitudeHandoffEvalPage() {
  return (
    <Suspense fallback={null}>
      <HandoffFixture />
    </Suspense>
  );
}
