'use client';

import { useMemo, useState } from 'react';
import {
  AgentField,
  layoutClusteredField,
} from '@/components/hud/webgl/agent-field';

export default function SparseSpatialEvalPage() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const layout = useMemo(
    () =>
      layoutClusteredField([
        {
          id: 'project:photo-generator',
          label: 'photo-generator',
          statLine: '1 agent · 0 blocked · $0.00/hr',
          agents: [
            {
              id: 'photo-generator-claude',
              name: 'photo-generator · Claude Code',
              status: 'idle',
            },
          ],
        },
        {
          id: 'project:gpagent',
          label: 'gpagent',
          statLine: '2 agents · 0 blocked · $0.00/hr',
          agents: [
            { id: 'gpagent-codex', name: 'gpagent · Codex', status: 'idle' },
            {
              id: 'gpagent-claude',
              name: 'gpagent · Claude Code',
              status: 'idle',
            },
          ],
        },
      ]),
    []
  );
  const selectable = useMemo(
    () => new Set(layout.clusters.map(cluster => cluster.id)),
    [layout.clusters]
  );

  return (
    <main className="h-screen bg-[#05080b]">
      <AgentField
        agents={layout.agents}
        clusters={layout.clusters}
        selectedId={selectedId}
        onSelect={setSelectedId}
        onSelectCluster={() => undefined}
        selectableClusters={selectable}
        regime="fleet"
        preserveDrawingBuffer
      />
    </main>
  );
}
