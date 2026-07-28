import { useCallback, useEffect, useRef, useState } from 'react';
import type { Project } from './use-workspace-state';

/**
 * Empty Projects remain real open objects, then become low-salience ribbon
 * residents. Centralized for later preference/settings work (the operator
 * explicitly wants this delay tunable rather than scattered through views).
 */
export const EMPTY_PROJECT_DORMANCY_MS = 4_000;

/** Chrome-adjacent target-bounds timing: quick, legible, never theatrical. */
export const PROJECT_EXIT_MS = 200;

function reducedMotionPreferred(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/**
 * Owns the lifecycle that is shared by the Project stage and elastic ribbon.
 *
 * Natural non-empty → empty transitions no longer destroy an open Project.
 * They keep the useful empty stage and, once inactive for a short dwell, move
 * the compact Project chip to a dormant tail. Explicit Close Project remains a
 * close and uses the same bounded exit motion. Starting work or selecting the
 * Project cancels dormancy immediately.
 */
export function useProjectCloseLifecycle({
  projects,
  activeDir,
  ready,
  onCloseProject,
  dormancyMs = EMPTY_PROJECT_DORMANCY_MS,
}: {
  projects: Project[];
  activeDir: string | null;
  ready: boolean;
  onCloseProject: (dir: string) => boolean;
  /** Test/settings seam; production uses EMPTY_PROJECT_DORMANCY_MS. */
  dormancyMs?: number;
}) {
  const [exitingProjectDirs, setExitingProjectDirs] = useState<Set<string>>(
    () => new Set()
  );
  const [dormantProjectDirs, setDormantProjectDirs] = useState<Set<string>>(
    () => new Set()
  );
  const projectsRef = useRef(projects);
  const activeDirRef = useRef(activeDir);
  projectsRef.current = projects;
  activeDirRef.current = activeDir;
  const emptySinceRef = useRef(new Map<string, number>());
  const dormancyTimersRef = useRef(
    new Map<string, ReturnType<typeof setTimeout>>()
  );
  const exitTimersRef = useRef(
    new Map<string, ReturnType<typeof setTimeout>>()
  );
  const manualCloseDirsRef = useRef(new Set<string>());

  const removeFromSet = useCallback(
    (
      setter: React.Dispatch<React.SetStateAction<Set<string>>>,
      dir: string
    ) => {
      setter(current => {
        if (!current.has(dir)) return current;
        const next = new Set(current);
        next.delete(dir);
        return next;
      });
    },
    []
  );

  const cancelDormancy = useCallback(
    (dir: string, resetClock: boolean) => {
      const timer = dormancyTimersRef.current.get(dir);
      if (timer) clearTimeout(timer);
      dormancyTimersRef.current.delete(dir);
      if (resetClock) emptySinceRef.current.set(dir, Date.now());
      removeFromSet(setDormantProjectDirs, dir);
    },
    [removeFromSet]
  );

  const cancelExit = useCallback(
    (dir: string, clearManualIntent = true) => {
      const timer = exitTimersRef.current.get(dir);
      if (timer) clearTimeout(timer);
      exitTimersRef.current.delete(dir);
      if (clearManualIntent) manualCloseDirsRef.current.delete(dir);
      removeFromSet(setExitingProjectDirs, dir);
    },
    [removeFromSet]
  );

  const makeDormant = useCallback((dir: string) => {
    dormancyTimersRef.current.delete(dir);
    const project = projectsRef.current.find(
      candidate => candidate.dir === dir
    );
    if (!project || project.tabs.length > 0 || activeDirRef.current === dir) {
      return;
    }
    setDormantProjectDirs(current =>
      current.has(dir) ? current : new Set(current).add(dir)
    );
  }, []);

  const armDormancy = useCallback(
    (dir: string) => {
      const project = projectsRef.current.find(
        candidate => candidate.dir === dir
      );
      if (!project || project.tabs.length > 0) {
        emptySinceRef.current.delete(dir);
        cancelDormancy(dir, false);
        return;
      }
      // Dormancy measures time spent both empty and inactive. An empty
      // Project can remain selected indefinitely without using up its dwell;
      // leaving it starts a fresh, predictable countdown.
      if (activeDirRef.current === dir) {
        emptySinceRef.current.delete(dir);
        cancelDormancy(dir, false);
        return;
      }
      if (!emptySinceRef.current.has(dir)) {
        emptySinceRef.current.set(dir, Date.now());
      }
      if (dormancyTimersRef.current.has(dir)) return;
      const elapsed =
        Date.now() - (emptySinceRef.current.get(dir) ?? Date.now());
      const remaining = Math.max(0, dormancyMs - elapsed);
      dormancyTimersRef.current.set(
        dir,
        setTimeout(() => makeDormant(dir), remaining)
      );
    },
    [cancelDormancy, dormancyMs, makeDormant]
  );

  const beginExit = useCallback(
    (dir: string) => {
      const project = projectsRef.current.find(
        candidate => candidate.dir === dir
      );
      if (!project || project.tabs.length > 0) {
        cancelExit(dir);
        return;
      }
      cancelDormancy(dir, false);
      if (exitTimersRef.current.has(dir)) return;
      setExitingProjectDirs(current =>
        current.has(dir) ? current : new Set(current).add(dir)
      );
      const duration = reducedMotionPreferred() ? 0 : PROJECT_EXIT_MS;
      exitTimersRef.current.set(
        dir,
        setTimeout(() => {
          exitTimersRef.current.delete(dir);
          manualCloseDirsRef.current.delete(dir);
          emptySinceRef.current.delete(dir);
          removeFromSet(setExitingProjectDirs, dir);
          onCloseProject(dir);
        }, duration)
      );
    },
    [cancelDormancy, cancelExit, onCloseProject, removeFromSet]
  );

  /** Manual close waits for any confirmed tab closes, then exits immediately. */
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

  /** Engagement promotes a dormant empty Project back into its manual slot. */
  const retainProject = useCallback(
    (dir: string): boolean => {
      if (!projectsRef.current.some(project => project.dir === dir))
        return false;
      cancelDormancy(dir, true);
      armDormancy(dir);
      return true;
    },
    [armDormancy, cancelDormancy]
  );

  useEffect(() => {
    if (!ready) return;
    const existing = new Set(projects.map(project => project.dir));
    for (const project of projects) {
      if (project.tabs.length > 0) {
        emptySinceRef.current.delete(project.dir);
        cancelDormancy(project.dir, false);
        cancelExit(project.dir);
      } else if (manualCloseDirsRef.current.has(project.dir)) {
        beginExit(project.dir);
      } else {
        armDormancy(project.dir);
      }
    }
    for (const dir of [...emptySinceRef.current.keys()]) {
      if (existing.has(dir)) continue;
      emptySinceRef.current.delete(dir);
      cancelDormancy(dir, false);
      cancelExit(dir);
    }
  }, [
    activeDir,
    armDormancy,
    beginExit,
    cancelDormancy,
    cancelExit,
    projects,
    ready,
  ]);

  useEffect(
    () => () => {
      for (const timer of dormancyTimersRef.current.values())
        clearTimeout(timer);
      for (const timer of exitTimersRef.current.values()) clearTimeout(timer);
    },
    []
  );

  return {
    dormantProjectDirs,
    exitingProjectDirs,
    requestProjectExit,
    retainProject,
  };
}
