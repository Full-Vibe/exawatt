'use client';

import { ChevronDownIcon, Cross2Icon, PlayIcon } from '@radix-ui/react-icons';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { formatShortcutKeys } from '@/lib/shortcuts/format';
import { useEffectiveShortcut } from '@/components/shortcuts/use-effective-shortcut';
import { WORKSPACE_HUD as HUD, withThemeAlpha } from './workspace-theme';

interface ResumeBatchProgress {
  completed: number;
  total: number;
}

/**
 * The bar's own chord hints (2026-08-13, operator: "there's no cmd+k or
 * discoverable keyboard shortcut for resume this agent"). Rendered ALWAYS,
 * never on a hover or modifier reveal: the bar appears for a few seconds
 * after a relaunch, so a hint that has to be discovered to be discovered is
 * no hint at all — and reserving the space by construction is how a hint
 * satisfies "never shifts layout". The combo comes from the registry, so a
 * rebind in Settings changes what the bar advertises.
 */
function ChordHint({ shortcutId }: { shortcutId: string }) {
  const keys = useEffectiveShortcut(shortcutId);
  if (!keys) return null;
  return (
    <kbd
      aria-hidden
      data-resume-chord-hint={shortcutId}
      className="pointer-events-none ml-1 shrink-0 font-mono text-chrome-micro opacity-70"
    >
      {formatShortcutKeys(keys)}
    </kbd>
  );
}

export interface ResumeRecoveryBarProps {
  readyAgentCount: number;
  reconnectableAgentCount: number;
  activeProjectName: string | null;
  activeProjectReadyCount: number;
  activeTabCanResume: boolean;
  progress: ResumeBatchProgress | null;
  onResumeActiveTab: () => void;
  onResumeActiveProject: () => void;
  onResumeAll: () => void;
  onDismiss: () => void;
}

function agents(count: number) {
  return `${count} ${count === 1 ? 'agent' : 'agents'}`;
}

export function ResumeRecoveryBar({
  readyAgentCount,
  reconnectableAgentCount,
  activeProjectName,
  activeProjectReadyCount,
  activeTabCanResume,
  progress,
  onResumeActiveTab,
  onResumeActiveProject,
  onResumeAll,
  onDismiss,
}: ResumeRecoveryBarProps) {
  const disabled = progress !== null;
  const stoppedAgentCount = readyAgentCount + reconnectableAgentCount;
  if (stoppedAgentCount === 0) return null;

  const projectIsUsefulScope =
    activeProjectName !== null && activeProjectReadyCount > 0;
  const agentIsDistinctScope =
    activeTabCanResume && activeProjectReadyCount > 1;
  const allIsDistinctScope = readyAgentCount > activeProjectReadyCount;
  const hasAlternateScope = agentIsDistinctScope || allIsDistinctScope;

  let status: string;
  if (progress) {
    status = `Resuming ${progress.completed} of ${progress.total} agents…`;
  } else if (readyAgentCount > 0) {
    status = `${agents(readyAgentCount)} paused`;
    if (projectIsUsefulScope && readyAgentCount > activeProjectReadyCount) {
      status += ` · ${activeProjectReadyCount} in ${activeProjectName}`;
    }
    if (reconnectableAgentCount > 0) {
      status += ` · ${agents(reconnectableAgentCount)} need${reconnectableAgentCount === 1 ? 's' : ''} reconnection`;
    }
  } else {
    status = `${agents(reconnectableAgentCount)} need${reconnectableAgentCount === 1 ? 's' : ''} reconnection`;
  }

  return (
    <div
      role="region"
      aria-label="Saved Agent recovery"
      className="flex shrink-0 items-center gap-2 border-b px-3 py-1.5 font-mono text-chrome-label"
      style={{
        borderColor: withThemeAlpha(HUD.cyan, 0.18),
        background: withThemeAlpha(HUD.cyan, 0.06),
        color: HUD.textDim,
      }}
    >
      <span role="status" className="min-w-0 flex-1 truncate">
        {status}
      </span>

      {readyAgentCount > 0 &&
        (projectIsUsefulScope ? (
          <div className="flex shrink-0">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={disabled}
              aria-label={`Resume ${agents(activeProjectReadyCount)} in ${activeProjectName}`}
              onClick={onResumeActiveProject}
              className="h-7 rounded-r-none border-r-0 font-mono"
            >
              <PlayIcon className="h-3.5 w-3.5" />
              {progress ? 'Resuming…' : 'Resume project'}
              {!progress && (
                <>
                  <span className="text-chrome-micro opacity-60">
                    {activeProjectReadyCount}
                  </span>
                  <ChordHint shortcutId="workspace-resume-scope" />
                </>
              )}
            </Button>

            {hasAlternateScope && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={disabled}
                    aria-label="Choose resume scope"
                    className="h-7 w-7 rounded-l-none px-0"
                  >
                    <ChevronDownIcon className="h-3.5 w-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48 font-mono">
                  <DropdownMenuLabel className="text-chrome-meta font-medium text-muted-foreground">
                    Resume
                  </DropdownMenuLabel>
                  {/* Counts move inline and the trailing slot becomes the
                      chord column, the way every other menu in the app
                      reads. Only the scopes that HAVE a chord show one —
                      All projects is reachable by chord only when it is the
                      bar's own default scope, and a hint that lies is worse
                      than none. */}
                  {agentIsDistinctScope && (
                    <DropdownMenuItem
                      aria-label="Resume this agent"
                      onSelect={onResumeActiveTab}
                    >
                      This agent
                      <span className="ml-1 opacity-60">1</span>
                      <DropdownMenuShortcut>
                        <ChordHint shortcutId="workspace-resume-agent" />
                      </DropdownMenuShortcut>
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem
                    aria-label={`Resume ${agents(activeProjectReadyCount)} in this project`}
                    onSelect={onResumeActiveProject}
                  >
                    This project
                    <span className="ml-1 opacity-60">
                      {activeProjectReadyCount}
                    </span>
                    <DropdownMenuShortcut>
                      <ChordHint shortcutId="workspace-resume-scope" />
                    </DropdownMenuShortcut>
                  </DropdownMenuItem>
                  {allIsDistinctScope && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        aria-label={`Resume all ${agents(readyAgentCount)}`}
                        onSelect={onResumeAll}
                      >
                        All projects
                        <DropdownMenuShortcut>
                          {readyAgentCount}
                        </DropdownMenuShortcut>
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled}
            aria-label={`Resume all ${agents(readyAgentCount)}`}
            onClick={onResumeAll}
            className="h-7 shrink-0 font-mono"
          >
            <PlayIcon className="h-3.5 w-3.5" />
            {progress ? 'Resuming…' : 'Resume all'}
            {!progress && (
              <>
                <span className="text-chrome-micro opacity-60">
                  {readyAgentCount}
                </span>
                <ChordHint shortcutId="workspace-resume-scope" />
              </>
            )}
          </Button>
        ))}

      <button
        type="button"
        aria-label="Dismiss resume notice"
        title="Dismiss"
        onClick={onDismiss}
        className="grid h-7 w-7 shrink-0 place-items-center rounded outline-none hover:bg-hud-fill-hi focus-visible:ring-1 focus-visible:ring-hud-cyan"
      >
        <Cross2Icon className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
