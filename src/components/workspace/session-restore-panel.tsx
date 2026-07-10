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
  const harnessLabel = HARNESS_META[tab.harness].label;
  const exact = !!tab.harnessSessionId || tab.harness === 'shell';

  const findCodexConversations = async () => {
    setLoading(true);
    try {
      const found =
        (await window.electron?.pty?.listResumeCandidates(tab.harness, tab.cwd)) ?? [];
      setCandidates(found);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-xl border border-white/10 bg-zinc-950/90 p-5 text-zinc-100 shadow-xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium">{tab.title}</p>
          <p className="mt-1 break-all text-xs text-zinc-500">{tab.cwd}</p>
        </div>
        <span className="text-xs text-zinc-500">
          {tab.resumeState === 'failed' ? 'Resume failed' : 'Process ended'}
        </span>
      </div>

      <p className="mt-4 text-sm leading-5 text-zinc-300">
        {exact
          ? tab.harness === 'shell'
            ? 'The previous shell ended. Start a new shell in the same directory.'
            : `Resume the exact saved ${harnessLabel} conversation in a new process.`
          : `Exawatt has no proven ${harnessLabel} identity for this older tab. It will not guess from the latest conversation.`}
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        {exact && (
          <Button size="sm" onClick={() => void onResumeTab(tab.id)}>
            <Play className="h-3.5 w-3.5" />
            {tab.harness === 'shell' ? 'New shell' : 'Resume exact session'}
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
            {loading ? 'Finding conversations...' : 'Choose Codex conversation'}
          </Button>
        )}
        {project.tabs.filter(candidate =>
          candidate.harness === 'shell' ? true : !!candidate.harnessSessionId
        ).length > 1 && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => onResumeProject(project.dir)}
          >
            Resume eligible in {project.name}
          </Button>
        )}
        {resumableCount > 1 && (
          <Button size="sm" variant="ghost" onClick={onResumeAll}>
            Resume all eligible
          </Button>
        )}
      </div>

      {candidates && (
        <div className="mt-4 max-h-64 space-y-1 overflow-y-auto border-t border-white/10 pt-3">
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
                  {new Date(candidate.updatedAt).toLocaleString()} · {candidate.id}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
