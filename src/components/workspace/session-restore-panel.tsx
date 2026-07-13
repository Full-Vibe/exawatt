'use client';

import { useState } from 'react';
import { Play, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { HarnessResumeCandidate } from '@/types/electron';
import type { Project, WorkspaceTab } from './use-workspace-state';
import { HARNESS_META } from './harnesses';

export function SessionRestorePanel({
  tab,
  project,
  resumableCount,
  onResumeTab,
  onResumeProject,
  onResumeAll,
}: {
  tab: WorkspaceTab;
  project: Project;
  resumableCount: number;
  onResumeTab: (tabId: string, selectedHarnessId?: string) => Promise<boolean>;
  onResumeProject: (dir: string) => void;
  onResumeAll: () => void;
}) {
  const [candidates, setCandidates] = useState<HarnessResumeCandidate[] | null>(
    null
  );
  const [loading, setLoading] = useState(false);
  const [candidateError, setCandidateError] = useState(false);
  const harnessLabel = HARNESS_META[tab.harness].label;
  const exact = !!tab.harnessSessionId || tab.harness === 'shell';
  const status =
    tab.lifecycle === 'interrupted'
      ? 'Interrupted'
      : tab.lifecycle === 'failed'
        ? 'Resume failed'
        : tab.lifecycle === 'exited'
          ? 'Exited'
          : 'Stopped';

  const findCodexConversations = async () => {
    setLoading(true);
    setCandidateError(false);
    try {
      const found =
        (await window.electron?.pty?.listResumeCandidates(
          tab.harness,
          tab.cwd
        )) ?? [];
      setCandidates(found);
    } catch {
      setCandidateError(true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      data-session-restore={tab.id}
      data-session-durable={tab.durableSessionId}
      className="absolute inset-x-0 top-0 z-10 border-b border-white/10 bg-zinc-950/95 px-3 py-2 text-zinc-100 shadow-lg backdrop-blur"
    >
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <span
          role="status"
          className="shrink-0 border border-white/15 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400"
        >
          {status}
        </span>
        <span className="truncate text-xs font-medium">{tab.title}</span>
        <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-zinc-500">
          {tab.cwd}
        </span>
        {exact && (
          <Button size="sm" onClick={() => void onResumeTab(tab.id)}>
            <Play className="h-3.5 w-3.5" />
            {tab.harness === 'shell' ? 'New Shell Here' : 'Resume'}
          </Button>
        )}
        {!exact && tab.harness === 'codex' && (
          <Button
            size="sm"
            variant="outline"
            disabled={loading}
            onClick={() => void findCodexConversations()}
          >
            <RotateCcw className="h-3.5 w-3.5" />
            {loading ? 'Finding…' : 'Choose Conversation'}
          </Button>
        )}
        {candidateError && (
          <span role="status" className="text-[10px] text-amber-300">
            Conversations unavailable
          </span>
        )}
        {project.tabs.filter(
          candidate =>
            candidate.harness !== 'shell' && !!candidate.harnessSessionId
        ).length > 1 && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => onResumeProject(project.dir)}
          >
            Resume Agents in {project.name}
          </Button>
        )}
        {resumableCount > 1 && (
          <Button size="sm" variant="ghost" onClick={onResumeAll}>
            Resume All
          </Button>
        )}
      </div>

      {candidates && (
        <div className="mt-2 max-h-64 space-y-1 overflow-y-auto border-t border-white/10 pt-2">
          {candidates.length === 0 ? (
            <p className="text-xs text-zinc-500">
              No saved Codex conversations were found for this directory.
            </p>
          ) : (
            candidates.map(candidate => (
              <button
                key={candidate.id}
                type="button"
                className="block w-full border border-transparent px-2 py-2 text-left hover:border-white/10 hover:bg-white/5 focus-visible:border-cyan-400 focus-visible:outline-none"
                onClick={() => void onResumeTab(tab.id, candidate.id)}
              >
                <span className="block truncate text-xs text-zinc-200">
                  {candidate.label}
                </span>
                <span className="mt-1 block font-mono text-[10px] text-zinc-500">
                  {new Date(candidate.updatedAt).toLocaleString()} ·{' '}
                  {candidate.id}
                </span>
              </button>
            ))
          )}
        </div>
      )}
      {!exact && tab.harness !== 'codex' && (
        <p className="mt-2 font-mono text-[10px] text-amber-300">
          No exact {harnessLabel} conversation identity is saved.
        </p>
      )}
    </div>
  );
}
