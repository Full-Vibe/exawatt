'use client';

import { useEffect, useMemo, useState } from 'react';
import type { ExawattAgent, FleetMetrics, FleetState } from '@exawatt/core';
import { selectSpatialBoardLayout } from '@exawatt/ui-model';
import { OperationsBoardSurface } from '@/components/fleet/spatial/operations-board/operations-board-surface';
import { THEME_REGISTRY } from '@/generated/theme-registry';
import { resolveAppearance } from '@/lib/appearance/resolve-appearance';
import type { BuiltInThemeId } from '@/lib/appearance/types';

const metrics: FleetMetrics = {
  activeCount: 2,
  blockedCount: 2,
  idleCount: 3,
  totalCost: 4.82,
  totalTokens: 18_420,
  totalCostRate: 1.38,
  costByProject: { Atlas: 2.41, Relay: 2.41 },
};

function agent(
  id: string,
  name: string,
  project: string,
  status: ExawattAgent['status']
): ExawattAgent {
  return {
    id,
    name,
    project,
    status,
    goal: `${name} is advancing ${project}`,
    sessionKey: id,
    metrics: {
      tokensIn: 0,
      tokensOut: 0,
      estimatedCost: 0.86,
      turnCount: 4,
      startedAt: null,
      duration: 0,
      costRate: 0.28,
      tokenRate: 0,
      costHistory: [],
    },
    lastActivityAt: 1,
    createdAt: 1,
  };
}

const agents = [
  {
    // Delegating parent (ENG-023 D3b): satellites under the piece, the count
    // and kinds in the DOM control copy.
    ...agent('atlas-build', 'Build Pipeline', 'Atlas', 'working'),
    delegation: {
      children: [
        {
          id: 'child-1',
          agentType: 'Explore',
          description: 'Map the release gates',
          startedAt: 1,
        },
        {
          id: 'child-2',
          agentType: 'general-purpose',
          description: 'Rebuild the artifact index',
          startedAt: 1,
        },
        {
          id: 'child-3',
          agentType: 'Explore',
          description: null,
          startedAt: 1,
        },
      ],
    },
  },
  agent('atlas-review', 'Release Review', 'Atlas', 'reviewing'),
  agent('atlas-docs', 'Launch Notes', 'Atlas', 'idle'),
  agent('atlas-result', 'Build Result', 'Atlas', 'complete'),
  agent('relay-auth', 'Auth Repair', 'Relay', 'blocked'),
  agent('relay-tests', 'Regression Tests', 'Relay', 'working'),
  agent('relay-fault', 'Deploy Fault', 'Relay', 'error'),
];

const state: FleetState = {
  agents: Object.fromEntries(agents.map(item => [item.id, item])),
  metrics,
  lastUpdated: 1,
};

const EVAL_THEME_IDS = {
  air: 'exawatt-air-light',
  classic: 'exawatt-classic-dark',
  night: 'exawatt-night-dark',
} as const satisfies Record<string, BuiltInThemeId>;

declare global {
  interface Window {
    __EVAL_SET_BOARD_THEME__?: (theme: keyof typeof EVAL_THEME_IDS) => void;
  }
}

export default function OperationsBoardEvalPage() {
  // Eval-only altitude override so screenshots can grade the Team-altitude
  // regime (satellites + control copy) against the same fixture fleet. Read
  // after mount so the server and first client render agree.
  const [focusedProject, setFocusedProject] = useState<string | null>(null);
  const [themeId, setThemeId] = useState<BuiltInThemeId>(
    'exawatt-classic-dark'
  );
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('altitude') === 'project') {
      setFocusedProject(params.get('project') ?? 'project:Atlas');
    }
    const requested = params.get('theme');
    if (requested && requested in EVAL_THEME_IDS) {
      setThemeId(EVAL_THEME_IDS[requested as keyof typeof EVAL_THEME_IDS]);
    }
  }, []);
  useEffect(() => {
    window.__EVAL_SET_BOARD_THEME__ = theme => {
      setThemeId(EVAL_THEME_IDS[theme]);
    };
    return () => {
      delete window.__EVAL_SET_BOARD_THEME__;
    };
  }, []);
  const layout = useMemo(
    () =>
      selectSpatialBoardLayout(
        state,
        focusedProject
          ? { altitude: 'project', focusedProjectId: focusedProject }
          : {}
      ),
    [focusedProject]
  );
  const resolvedAppearance = useMemo(() => {
    const theme = THEME_REGISTRY[themeId];
    return resolveAppearance(
      THEME_REGISTRY,
      {
        schemaVersion: 1,
        selection: { mode: 'manual', themeId },
        accentSource: 'theme',
        interfaceFont: 'theme',
        interfaceScale: 100,
        contrast: 'system',
        transparency: 'system',
      },
      {
        dark: theme.appearance === 'dark',
        highContrast: false,
        forcedColors: false,
        invertedColors: false,
        reducedTransparency: false,
      }
    );
  }, [themeId]);
  return (
    <main
      className="h-screen min-h-[620px] p-5"
      data-eval-board-theme={themeId}
      style={{ background: resolvedAppearance.theme.foundation.canvas }}
    >
      <div
        className="h-full overflow-hidden border"
        style={{
          borderColor: resolvedAppearance.theme.foundation.borderStrong,
        }}
      >
        <OperationsBoardSurface
          layout={layout}
          projection="top-down"
          onDrillProject={() => undefined}
          onSelectAgent={() => undefined}
          onOverview={() => undefined}
          onProjectionChange={() => undefined}
          preserveDrawingBuffer
          resolvedAppearance={resolvedAppearance}
        />
      </div>
    </main>
  );
}
