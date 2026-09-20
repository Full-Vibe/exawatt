import { useCallback, useRef, useState } from 'react';
import type { Project } from './use-workspace-state';

/** Same confirmation protocol for every source. The confirmed IDs are a snapshot,
 * so an Agent added while the dialog is open cannot be interrupted by accident. */
type PauseResult = (
  | { kind: 'needs-confirmation'; activeSessionIds: string[] }
  | {
      kind: 'completed';
      results: Array<{ status: string; error?: string }>;
    }
) & { sessionIds: string[] };

export function useProjectPauseInteraction(
  projects: Project[],
  pause: (dir: string, confirmedSessionIds?: string[]) => Promise<PauseResult>,
  announce: (message: string) => void,
  reportFailure: (message: string) => void = announce
) {
  const [confirmation, setConfirmation] = useState<{
    dir: string;
    name: string;
    color: string;
    activeCount: number;
    sessionIds: string[];
  } | null>(null);
  const pending = useRef(false);
  const requestPause = useCallback(
    async (dir: string, confirmedIds?: string[]) => {
      if (pending.current) return;
      const project = projects.find(item => item.dir === dir);
      if (!project) return;
      pending.current = true;
      setConfirmation(null);
      try {
        const result = await pause(dir, confirmedIds);
        if (result.kind === 'needs-confirmation') {
          setConfirmation({
            dir,
            name: project.name,
            color: project.color,
            activeCount: result.activeSessionIds.length,
            sessionIds: result.sessionIds,
          });
        } else {
          const failures = result.results.filter(
            item => item.status === 'failed' || item.status === 'unsupported'
          );
          const paused = result.results.filter(
            item => item.status === 'paused'
          ).length;
          if (failures.length) {
            reportFailure(
              `${paused} Agents paused. ${failures.length} could not pause. ${failures[0].error ?? ''}`
            );
          } else {
            announce(`${paused} Agents paused in ${project.name}.`);
          }
        }
      } catch (error) {
        reportFailure(
          error instanceof Error
            ? error.message
            : 'Could not pause this Project.'
        );
      } finally {
        pending.current = false;
      }
    },
    [projects, pause, announce, reportFailure]
  );
  return {
    confirmation,
    requestPause,
    cancelPause: () => setConfirmation(null),
    confirmPause: () => {
      if (confirmation)
        void requestPause(confirmation.dir, confirmation.sessionIds);
    },
  };
}
