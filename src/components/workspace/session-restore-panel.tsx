'use client';

import { useState } from 'react';
import { Link2, Play } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { HarnessResumeCandidate } from '@/types/electron';
import type { SessionTab } from './use-workspace-state';
import { HARNESS_META } from './harnesses';
import { WORKSPACE_HUD as HUD } from './workspace-theme';

export function SessionRestorePanel({
  tab,
  onResumeTab,
}: {
  tab: SessionTab;
  onResumeTab: (tabId: string, selectedHarnessId?: string) => Promise<boolean>;
}) {
  const [candidates, setCandidates] = useState<HarnessResumeCandidate[] | null>(
    null
  );
  const [loading, setLoading] = useState(false);
  const [candidateError, setCandidateError] = useState(false);
  const harnessLabel = HARNESS_META[tab.harness].label;
  const exact = !!tab.harnessSessionId || tab.harness === 'shell';
  const status = !exact
    ? 'Reconnect needed'
    : tab.lifecycle === 'interrupted'
      ? 'Interrupted'
      : tab.lifecycle === 'failed'
        ? 'Resume failed'
        : tab.lifecycle === 'exited'
          ? 'Exited'
          : 'Stopped';

  const findConversations = async () => {
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
      data-identity-missing={!exact || undefined}
      className="relative z-10 shrink-0 border-b px-3 py-2.5 backdrop-blur"
      style={{
        color: HUD.text,
        background: HUD.bg.panelFill,
        borderColor: HUD.divider,
      }}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
        <span
          role="status"
          className="shrink-0 border px-1.5 py-0.5 font-mono text-chrome-micro"
          style={{
            color: exact ? HUD.textDim : HUD.amber,
            borderColor: exact ? HUD.strokeFaint : HUD.amber,
          }}
        >
          {status}
        </span>
        <div className="min-w-48 flex-1">
          <p className="truncate text-xs font-medium">{tab.title}</p>
          <p
            className="mt-0.5 text-chrome-meta leading-4"
            style={{ color: HUD.textDim }}
          >
            {exact
              ? tab.harness === 'shell'
                ? 'Saved terminal history is read-only. Start a new shell in the same directory.'
                : 'Saved terminal history is read-only until this Agent resumes.'
              : `Exawatt saved this Session, but its exact ${harnessLabel} conversation was not recorded. Reconnect it once to restore deterministic relaunches.`}
          </p>
        </div>
        {exact && (
          <Button size="sm" onClick={() => void onResumeTab(tab.id)}>
            <Play className="h-3.5 w-3.5" />
            {tab.harness === 'shell' ? 'Start New Shell' : 'Resume This Agent'}
          </Button>
        )}
        {!exact && tab.harness !== 'shell' && (
          <Button
            size="sm"
            variant="outline"
            disabled={loading}
            onClick={() => void findConversations()}
          >
            <Link2 className="h-3.5 w-3.5" />
            {loading ? 'Finding…' : 'Reconnect Conversation'}
          </Button>
        )}
        {candidateError && (
          <span
            role="status"
            className="text-chrome-micro"
            style={{ color: HUD.amber }}
          >
            Conversations unavailable
          </span>
        )}
      </div>

      {candidates && (
        <div
          className="mt-2 max-h-64 space-y-1 overflow-y-auto border-t pt-2"
          style={{ borderColor: HUD.divider }}
        >
          {candidates.length === 0 ? (
            <p className="text-xs" style={{ color: HUD.textDim }}>
              No saved {harnessLabel} conversations were found for this Project.
            </p>
          ) : (
            candidates.map(candidate => (
              <button
                key={candidate.id}
                type="button"
                className="block w-full border border-transparent px-2 py-2 text-left hover:border-hud-stroke-faint hover:bg-hud-fill focus-visible:border-hud-cyan focus-visible:outline-none"
                onClick={() => void onResumeTab(tab.id, candidate.id)}
              >
                <span
                  className="block truncate text-xs"
                  style={{ color: HUD.text }}
                >
                  {candidate.label}
                </span>
                {candidate.description && (
                  <span
                    className="mt-1 line-clamp-2 block text-chrome-meta leading-4"
                    style={{ color: HUD.textDim }}
                  >
                    {candidate.description}
                  </span>
                )}
                <span
                  className="mt-1 block font-mono text-chrome-micro"
                  style={{ color: HUD.textDim }}
                >
                  {new Date(candidate.updatedAt).toLocaleString()}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
