import { useCallback, useEffect, useRef, useState } from 'react';
import type { Project } from './use-workspace-state';

/** The empty composer remains useful feedback before its Project leaves. */
export const EMPTY_PROJECT_LINGER_MS = 3_000;

/** Exit is intentionally quicker than the surrounding 300ms stage entrance. */
export const PROJECT_EXIT_MS = 240;

function reducedMotionPreferred(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/**
 * Owns the visual half of closing an open Project.
 *
 * A Project that is opened empty is stable. Only a non-empty -> empty
 * transition starts the grace period, so Project selection remains separate
 * from Agent creation. Re-populating the Project during either the grace
 * period or exit cancels the close.
 */
export function useProjectCloseLifecycle({
  projects,
  ready,
  onCloseProject,
}: {
  projects: Project[];
  ready: boolean;
  onCloseProject: (dir: string) => boolean;
}) {
  const [exitingProjectDirs, setExitingProjectDirs] = useState<Set<string>>(
    () => new Set()
  );
  const projectsRef = useRef(projects);
  projectsRef.current = projects;
  const previousCountsRef = useRef<Map<string, number> | null>(null);
  const lingerTimersRef = useRef(
    new Map<string, ReturnType<typeof setTimeout>>()
  );
  const exitTimersRef = useRef(
    new Map<string, ReturnType<typeof setTimeout>>()
  );
  const manualCloseDirsRef = useRef(new Set<string>());

  const removeExitState = useCallback((dir: string) => {
    setExitingProjectDirs(current => {
      if (!current.has(dir)) return current;
      const next = new Set(current);
      next.delete(dir);
      return next;
    });
  }, []);

  const cancelProjectClose = useCallback(
    (dir: string, clearManualIntent = true) => {
      const lingerTimer = lingerTimersRef.current.get(dir);
      if (lingerTimer) clearTimeout(lingerTimer);
      lingerTimersRef.current.delete(dir);
      const exitTimer = exitTimersRef.current.get(dir);
      if (exitTimer) clearTimeout(exitTimer);
      exitTimersRef.current.delete(dir);
      if (clearManualIntent) manualCloseDirsRef.current.delete(dir);
      removeExitState(dir);
    },
    [removeExitState]
  );

  const beginExit = useCallback(
    (dir: string) => {
      const project = projectsRef.current.find(
        candidate => candidate.dir === dir
      );
      if (!project || project.tabs.length > 0) {
        cancelProjectClose(dir);
        return;
      }
      const lingerTimer = lingerTimersRef.current.get(dir);
      if (lingerTimer) clearTimeout(lingerTimer);
      lingerTimersRef.current.delete(dir);
      if (exitTimersRef.current.has(dir)) return;
      setExitingProjectDirs(current => {
        if (current.has(dir)) return current;
        return new Set(current).add(dir);
      });
      const duration = reducedMotionPreferred() ? 0 : PROJECT_EXIT_MS;
      exitTimersRef.current.set(
        dir,
        setTimeout(() => {
          exitTimersRef.current.delete(dir);
          manualCloseDirsRef.current.delete(dir);
          removeExitState(dir);
          onCloseProject(dir);
        }, duration)
      );
    },
    [cancelProjectClose, onCloseProject, removeExitState]
  );

  /** Manual close bypasses the grace period but still uses the exit motion. */
  const requestProjectExit = useCallback(
    (dir: string): boolean => {
      const project = projectsRef.current.find(
        candidate => candidate.dir === dir
      );
      if (!project) return false;
      manualCloseDirsRef.current.add(dir);
      if (project.tabs.length === 0) beginExit(dir);
      return true;
    },
    [beginExit]
  );

  useEffect(() => {
    const currentCounts = new Map(
      projects.map(project => [project.dir, project.tabs.length] as const)
    );
    const previousCounts = previousCountsRef.current;
    previousCountsRef.current = currentCounts;
    if (!ready || !previousCounts) return;

    for (const project of projects) {
      if (project.tabs.length > 0) {
        // Starting another Agent during the grace/exit keeps the Project open.
        cancelProjectClose(project.dir);
        continue;
      }
      if (manualCloseDirsRef.current.has(project.dir)) {
        beginExit(project.dir);
        continue;
      }
      if (
        (previousCounts.get(project.dir) ?? 0) > 0 &&
        !lingerTimersRef.current.has(project.dir) &&
        !exitTimersRef.current.has(project.dir)
      ) {
        lingerTimersRef.current.set(
          project.dir,
          setTimeout(() => beginExit(project.dir), EMPTY_PROJECT_LINGER_MS)
        );
      }
    }

    for (const dir of previousCounts.keys()) {
      if (!currentCounts.has(dir)) cancelProjectClose(dir);
    }
  }, [beginExit, cancelProjectClose, projects, ready]);

  useEffect(
    () => () => {
      for (const timer of lingerTimersRef.current.values()) clearTimeout(timer);
      for (const timer of exitTimersRef.current.values()) clearTimeout(timer);
    },
    []
  );

  return { exitingProjectDirs, requestProjectExit };
}
