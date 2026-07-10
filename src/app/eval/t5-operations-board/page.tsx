'use client';

import type { ExawattAgent, FleetMetrics, FleetState } from '@exawatt/core';
import { selectSpatialBoardLayout } from '@exawatt/ui-model';
import { OperationsBoardSurface } from '@/components/fleet/spatial/operations-board/operations-board-surface';

const metrics: FleetMetrics = {
  activeCount: 2,
  blockedCount: 1,
  idleCount: 2,
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
  agent('atlas-build', 'Build Pipeline', 'Atlas', 'working'),
  agent('atlas-review', 'Release Review', 'Atlas', 'reviewing'),
  agent('atlas-docs', 'Launch Notes', 'Atlas', 'idle'),
  agent('relay-auth', 'Auth Repair', 'Relay', 'blocked'),
  agent('relay-tests', 'Regression Tests', 'Relay', 'working'),
];

const state: FleetState = {
  agents: Object.fromEntries(agents.map(item => [item.id, item])),
  metrics,
  lastUpdated: 1,
};

const layout = selectSpatialBoardLayout(state);

export default function OperationsBoardEvalPage() {
  return (
    <main className="h-screen min-h-[620px] bg-[#101418] p-5">
      <div className="h-full overflow-hidden border border-[#354149]">
        <OperationsBoardSurface
          layout={layout}
          hero={{
            agentId: 'relay-auth',
            title: 'Authentication needs operator input',
            reason: 'Credentials needed · blocks Relay',
          }}
          onDrillProject={() => undefined}
          onSelectAgent={() => undefined}
          onOverview={() => undefined}
          preserveDrawingBuffer
        />
      </div>
    </main>
  );
}
