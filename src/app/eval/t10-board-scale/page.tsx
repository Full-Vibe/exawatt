'use client';

/**
 * t10-board-scale — deterministic demo-scale board fixture (ENG-004 V3.1).
 *
 * Renders the real OperationsBoardSurface over a synthetic fleet of
 * `?agents=N` (default 1000) spread across `?projects=P` (default 26)
 * Projects with a weighted status mix. Everything is seeded, so repeated
 * runs measure the same scene. `?altitude=project&project=<clusterId>`
 * drills; `?projection=fixed-angle` tilts.
 *
 * Exposes `window.__EVAL_BOARD__` = { agentCount, layoutMs, stats } for the
 * scale eval harness (scripts/spatial-scale-eval.mjs).
 */

import { Suspense, useEffect, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import type { ExawattAgent, FleetMetrics, FleetState } from '@exawatt/core';
import {
  selectSpatialBoardLayout,
  type SpatialBoardProjection,
} from '@exawatt/ui-model';
import { OperationsBoardSurface } from '@/components/fleet/spatial/operations-board/operations-board-surface';

const PROJECT_NAMES = [
  'Exawatt Demo Polish',
  'OpenClaw Local Parity',
  'Investor Pipeline Research',
  'Mobile App',
  'Infra Hardening',
  'Growth Experiments',
  'Support Triage',
  'Docs & DX',
  'Billing & Metering',
  'Security Review',
  'Data Pipeline',
  'Design System',
  'Release Engineering',
  'Customer Onboarding',
  'Observability',
  'Payments Migration',
  'Search Relevance',
  'Localization',
  'Compliance Audit',
  'Sales Tooling',
  'Marketplace Integrations',
  'Edge Performance',
  'Identity & Access',
  'Content Studio',
  'QA Automation',
  'Capacity Planning',
];

// Weighted like the mock transport: mostly quiet work, a slice blocked.
const STATUS_POOL: ExawattAgent['status'][] = [
  'working',
  'working',
  'working',
  'idle',
  'idle',
  'idle',
  'reviewing',
  'complete',
  'blocked',
  'error',
];

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildFleet(agentCount: number, projectCount: number): FleetState {
  const random = mulberry32(0x5ca1e);
  const projects = PROJECT_NAMES.slice(
    0,
    Math.max(1, Math.min(projectCount, PROJECT_NAMES.length))
  );
  const agents: Record<string, ExawattAgent> = {};
  let blocked = 0;
  let active = 0;
  for (let index = 0; index < agentCount; index++) {
    const status = STATUS_POOL[Math.floor(random() * STATUS_POOL.length)]!;
    if (status === 'blocked' || status === 'error') blocked++;
    if (status === 'working' || status === 'reviewing') active++;
    // Concentrate ~1/3 into the lead Project (mirrors the mock transport) so
    // one Project exercises the dense-zone path and the giant-Project drill.
    const project =
      index % 3 === 0
        ? projects[0]!
        : projects[1 + (index % Math.max(1, projects.length - 1))]!;
    const id = `scale-${index}`;
    agents[id] = {
      id,
      name: `Agent ${index}`,
      project,
      status,
      goal: `Synthetic demo-scale agent ${index} advancing ${project}`,
      sessionKey: id,
      metrics: {
        tokensIn: Math.floor(random() * 50_000),
        tokensOut: Math.floor(random() * 20_000),
        estimatedCost: random() * 2,
        turnCount: Math.floor(random() * 24),
        startedAt: null,
        duration: 0,
        costRate: random() * 1.5,
        tokenRate: 0,
        costHistory: [],
      },
      lastActivityAt: 1,
      createdAt: 1,
    };
  }
  const metrics: FleetMetrics = {
    activeCount: active,
    blockedCount: blocked,
    idleCount: agentCount - active - blocked,
    totalCost: 0,
    totalTokens: 0,
    totalCostRate: 0,
    costByProject: {},
  };
  return { agents, metrics, lastUpdated: 1 };
}

declare global {
  interface Window {
    __EVAL_BOARD__?: {
      agentCount: number;
      projectCount: number;
      layoutMs: number;
      stats: ReturnType<typeof selectSpatialBoardLayout>['stats'];
    };
  }
}

function BoardScaleFixture() {
  const params = useSearchParams();
  const agentCount = Math.max(1, Number(params.get('agents') ?? 1000) || 1000);
  const projectCount = Math.max(
    1,
    Number(params.get('projects') ?? PROJECT_NAMES.length) ||
      PROJECT_NAMES.length
  );
  const altitude = params.get('altitude') === 'project' ? 'project' : 'fleet';
  const focusedProjectId =
    altitude === 'project'
      ? (params.get('project') ?? `project:${PROJECT_NAMES[0]}`)
      : null;
  const projection: SpatialBoardProjection =
    params.get('projection') === 'fixed-angle' ? 'fixed-angle' : 'top-down';

  const state = useMemo(
    () => buildFleet(agentCount, projectCount),
    [agentCount, projectCount]
  );
  const { layout, layoutMs } = useMemo(() => {
    const start = performance.now();
    const result = selectSpatialBoardLayout(state, {
      altitude,
      focusedProjectId,
    });
    return { layout: result, layoutMs: performance.now() - start };
  }, [altitude, focusedProjectId, state]);
  useEffect(() => {
    window.__EVAL_BOARD__ = {
      agentCount,
      projectCount,
      layoutMs,
      stats: layout.stats,
    };
  }, [agentCount, layout.stats, layoutMs, projectCount]);

  return (
    <main className="h-screen min-h-[620px] bg-[#101418]">
      <div className="h-full overflow-hidden">
        <OperationsBoardSurface
          layout={layout}
          projection={projection}
          onDrillProject={() => undefined}
          onSelectAgent={() => undefined}
          onOverview={() => undefined}
          onProjectionChange={() => undefined}
          viewportStorageKey={`exawatt:spatial-viewport:t10:${agentCount}:${altitude}`}
          preserveDrawingBuffer
        />
      </div>
    </main>
  );
}

export default function BoardScaleEvalPage() {
  return (
    <Suspense fallback={null}>
      <BoardScaleFixture />
    </Suspense>
  );
}
