'use client';

/**
 * This launch's options (ENG-016): a new git worktree and its branch, the
 * roadmap item the Agent works on, and naming the setup.
 *
 * Their own home, opened from the launcher's Options trigger. They used to
 * sit inside the "All engines and models" catalog, which the launcher renders
 * inside the form Start submits, so Enter in the branch field started the
 * Agent. They are not catalog content and not part of what Start submits;
 * the launcher renders them outside its form, so Enter here is only Enter.
 */

import { useId } from 'react';
import { GitBranch, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';

export interface LaunchOptionsItem {
  id: string;
  label: string;
}

export interface LaunchOptionsPanelProps {
  worktree: boolean;
  branch: string;
  onWorktreeChange: (worktree: boolean) => void;
  onBranchChange: (branch: string) => void;
  roadmapItems: readonly LaunchOptionsItem[];
  roadmapItemId: string;
  onRoadmapItemChange: (id: string) => void;
  /** Null while there is no model to name a setup for. */
  onNameSetup: (() => void) | null;
}

/** What the options hold, for the trigger while they are folded. */
export function launchOptionsSummary({
  worktree,
  branch,
  roadmapItemId,
  setupName,
}: {
  worktree: boolean;
  branch: string;
  roadmapItemId: string;
  setupName: string | null;
}): string | null {
  return (
    [
      worktree ? `Worktree ${branch.trim() || 'needs a branch'}` : null,
      roadmapItemId || null,
      setupName,
    ]
      .filter(Boolean)
      .join(' · ') || null
  );
}

export function LaunchOptionsPanel({
  worktree,
  branch,
  onWorktreeChange,
  onBranchChange,
  roadmapItems,
  roadmapItemId,
  onRoadmapItemChange,
  onNameSetup,
}: LaunchOptionsPanelProps) {
  const branchErrorId = useId();
  const branchReady = !worktree || branch.trim().length > 0;
  return (
    <div
      data-launch-options
      className="grid gap-2 rounded-md border border-hud-stroke-soft bg-hud-deep px-3 py-2.5"
    >
      <div className="flex min-w-0 flex-wrap items-center gap-3">
        <label className="flex cursor-pointer items-center gap-2 font-mono text-chrome-label text-hud-text">
          <input
            type="checkbox"
            checked={worktree}
            onChange={event => onWorktreeChange(event.target.checked)}
            className="accent-cyan-400"
          />
          <GitBranch aria-hidden="true" className="size-3.5" />
          New git worktree
        </label>
        {roadmapItems.length > 0 ? (
          <select
            data-launch-roadmap-item
            aria-label="Roadmap item this session will work on"
            value={roadmapItemId}
            onChange={event => onRoadmapItemChange(event.target.value)}
            className="h-8 min-w-40 flex-1 rounded-md border border-hud-stroke-faint bg-hud-deep px-2 font-mono text-chrome-label text-hud-text outline-none focus-visible:ring-2 focus-visible:ring-hud-cyan"
          >
            <option value="">No roadmap link</option>
            {roadmapItems.map(item => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={!onNameSetup}
          className="ml-auto shrink-0 font-mono text-chrome-label"
          onClick={() => onNameSetup?.()}
        >
          <Save aria-hidden="true" className="size-3.5" />
          Name setup…
        </Button>
      </div>
      {worktree ? (
        <input
          value={branch}
          onChange={event => onBranchChange(event.target.value)}
          aria-label="Branch name for the new worktree"
          aria-invalid={!branchReady}
          aria-describedby={branchReady ? undefined : branchErrorId}
          className="h-8 w-full rounded-md border border-hud-stroke-faint bg-hud-deep px-2 font-mono text-chrome-label text-hud-text outline-none focus-visible:ring-2 focus-visible:ring-hud-cyan"
        />
      ) : null}
      {worktree && !branchReady ? (
        <p
          id={branchErrorId}
          className="font-mono text-chrome-micro text-hud-red"
        >
          Enter a branch name before starting.
        </p>
      ) : null}
    </div>
  );
}
