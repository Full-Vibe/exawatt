'use client';

import { useState } from 'react';
import { ResumeRecoveryBar } from '@/components/workspace/resume-recovery-bar';

/** Existing recovery treatment, with the accepted pause-first restart action. */
export default function RestartRecoveryStudy() {
  const [result, setResult] = useState('No Agents started.');
  const props = {
    readyAgents: { count: 5, allPaused: true },
    previouslyRunningCount: 3,
    activeProjectName: 'Exawatt',
    activeProjectReadyCount: 2,
    activeTabCanResume: true,
    progress: null,
    onResumePreviouslyRunning: () =>
      setResult(
        'Resumed the 3 previously running conversations. The 2 previously paused Agents remain paused.'
      ),
    onResumeActiveTab: () => setResult('Resumed this Agent.'),
    onResumeActiveProject: () => setResult('Resumed the selected Project.'),
    onResumeAll: () => setResult('Resumed all eligible Agents.'),
    onDismiss: () => setResult('Dismissed. No Agents started.'),
  };
  return (
    <main className="min-h-screen space-y-8 bg-background p-6 text-foreground font-ui">
      <div className="space-y-2">
        <h1 className="text-surface-title font-semibold">Restart recovery</h1>
        <p className="text-sm text-muted-foreground">
          Your purposes, tab order, and read state remain. Running Agents
          restore paused.
        </p>
      </div>
      <section className="space-y-3">
        <h2 className="text-base font-semibold">
          Three were running; two were already paused
        </h2>
        <ResumeRecoveryBar {...props} reconnectableAgentCount={0} />
      </section>
      <section className="space-y-3">
        <h2 className="text-base font-semibold">
          One conversation needs reconnection
        </h2>
        <ResumeRecoveryBar
          {...props}
          readyAgents={{ count: 4, allPaused: true }}
          previouslyRunningCount={2}
          reconnectableAgentCount={1}
        />
      </section>
      <p role="status" className="text-sm">
        {result}
      </p>
    </main>
  );
}
