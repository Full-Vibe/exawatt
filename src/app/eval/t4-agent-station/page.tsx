'use client';

import { useMemo } from 'react';
import {
  AgentField,
  layoutClusteredField,
} from '@/components/hud/webgl/agent-field';

const AGENT_ID = 'photo-generator-claude';

export default function AgentStationEvalPage() {
  const layout = useMemo(
    () =>
      layoutClusteredField([
        {
          id: 'project:photo-generator',
          label: 'photo-generator',
          agents: [
            {
              id: AGENT_ID,
              name: 'photo-generator · Claude Code',
              status: 'idle',
              detail: 'Interactive Claude Code session',
            },
          ],
        },
      ]),
    []
  );

  return (
    <main className="h-screen bg-[#05080b]">
      <AgentField
        agents={layout.agents}
        clusters={layout.clusters}
        selectedId={AGENT_ID}
        focusedCluster={0}
        onSelect={() => undefined}
        regime="agent"
        preserveDrawingBuffer
      />
    </main>
  );
}
