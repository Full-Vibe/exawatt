'use client';

import { useState } from 'react';
import { Link2, Play } from 'lucide-react';
import {
  SESSION_LIFECYCLE_VERB_LABEL,
  sessionLifecyclePresentation,
} from '@exawatt/ui-model';
import { Button } from '@/components/ui/button';
import type { HarnessResumeCandidate } from '@/types/electron';
import type { SessionTab } from './use-workspace-state';
import { HARNESS_META } from './harnesses';
import { lifecycleToneColor } from './session-lifecycle-tone';
import { WORKSPACE_HUD as HUD } from './workspace-theme';

/**
 * The bar over an ended Session: the lifecycle word, the one line saying how
 * it ended, and the verb that answers it. Every word here comes from the
 * shared lifecycle vocabulary (ENG-015 S6.4), so this bar, the tab, the
 * recovery bar, the record, and the Team tile say the same thing about the
 * same Session.
 */
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
  const presentation = sessionLifecyclePresentation(tab);
  const tone = lifecycleToneColor(presentation.tone);

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

  const verb = presentation.verb;

  return (
    <div
      data-session-restore={tab.id}
      data-session-durable={tab.durableSessionId}
      data-identity-missing={verb === 'reconnect' || undefined}
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
          data-session-lifecycle-word
          className="shrink-0 border px-1.5 py-0.5 font-mono text-chrome-micro"
          style={{ color: tone, borderColor: tone }}
        >
          {presentation.word}
        </span>
        <div className="min-w-48 flex-1">
          <p className="truncate text-xs font-medium">{tab.title}</p>
          {presentation.line && (
            <p
              data-session-lifecycle-line
              className="mt-0.5 text-chrome-meta leading-4 text-hud-text-dim"
            >
              {presentation.line}
            </p>
          )}
        </div>
        {(verb === 'resume' || verb === 'new-shell') && (
          <Button size="sm" onClick={() => void onResumeTab(tab.id)}>
            <Play className="h-3.5 w-3.5" />
            {SESSION_LIFECYCLE_VERB_LABEL[verb]}
          </Button>
        )}
        {verb === 'reconnect' && (
          <Button
            size="sm"
            variant="outline"
            disabled={loading}
            onClick={() => void findConversations()}
          >
            <Link2 className="h-3.5 w-3.5" />
            {loading ? 'Finding…' : SESSION_LIFECYCLE_VERB_LABEL.reconnect}
          </Button>
        )}
        {candidateError && (
          <span
            role="status"
            className="text-chrome-micro"
            style={{ color: lifecycleToneColor('warn') }}
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
            <p className="text-xs text-hud-text-dim">
              No saved {harnessLabel} conversations in this Project.
            </p>
          ) : (
            candidates.map(candidate => (
              <button
                key={candidate.id}
                type="button"
                className="block w-full border border-transparent px-2 py-2 text-left hover:border-hud-stroke-faint hover:bg-hud-fill focus-visible:border-hud-cyan focus-visible:outline-none"
                onClick={() => void onResumeTab(tab.id, candidate.id)}
              >
                <span className="block truncate text-xs text-hud-text">
                  {candidate.label}
                </span>
                {candidate.description && (
                  <span className="mt-1 line-clamp-2 block text-chrome-meta leading-4 text-hud-text-dim">
                    {candidate.description}
                  </span>
                )}
                <span className="mt-1 block font-mono text-chrome-micro text-hud-text-dim">
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
