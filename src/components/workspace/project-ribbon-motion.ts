import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Project, WorkspaceTab } from './use-workspace-state';
import type { RibbonTarget } from './project-ribbon-layout';

export const RIBBON_MOTION_MS = 210;
export const RIBBON_EXIT_MS = 150;
export const POINTER_CLOSE_STABILIZE_MS = 600;

export type RibbonToken =
  | {
      key: string;
      kind: 'project';
      project: Project;
      sourceProjectIndex: number;
      priority: number;
    }
  | {
      key: string;
      kind: 'tab';
      project: Project;
      tab: WorkspaceTab;
      priority: number;
    };

export interface PresentRibbonToken {
  token: RibbonToken;
  phase: 'entering' | 'active' | 'exiting';
}

/**
 * Presence is deliberately separate from layout. Removed work remains
 * paintable for one bounded exit while survivors receive new target bounds.
 * Retained pointer-close entries keep their exact sequence slot until release.
 */
export function useRibbonPresence(
  tokens: readonly RibbonToken[],
  retainedExitKeys: ReadonlySet<string>
) {
  const [present, setPresent] = useState<PresentRibbonToken[]>(() =>
    tokens.map(token => ({ token, phase: 'active' }))
  );
  const exitTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const enterTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  useLayoutEffect(() => {
    const current = new Map(tokens.map(token => [token.key, token] as const));
    setPresent(previous => {
      const previousByKey = new Map(
        previous.map(entry => [entry.token.key, entry] as const)
      );
      const next: PresentRibbonToken[] = tokens.map(token => ({
        token,
        phase: previousByKey.has(token.key) ? 'active' : 'entering',
      }));

      for (const prior of previous) {
        if (current.has(prior.token.key)) continue;
        const priorIndex = previous.findIndex(
          candidate => candidate.token.key === prior.token.key
        );
        const nextSurvivor = previous
          .slice(priorIndex + 1)
          .find(candidate => current.has(candidate.token.key));
        const insertion = nextSurvivor
          ? next.findIndex(
              candidate => candidate.token.key === nextSurvivor.token.key
            )
          : next.length;
        next.splice(insertion < 0 ? next.length : insertion, 0, {
          token: prior.token,
          phase: 'exiting',
        });
      }
      return next;
    });

    for (const token of tokens) {
      const timer = exitTimers.current.get(token.key);
      if (timer) clearTimeout(timer);
      exitTimers.current.delete(token.key);
    }
  }, [tokens]);

  useEffect(() => {
    for (const entry of present) {
      if (
        entry.phase === 'entering' &&
        !enterTimers.current.has(entry.token.key)
      ) {
        enterTimers.current.set(
          entry.token.key,
          setTimeout(() => {
            enterTimers.current.delete(entry.token.key);
            setPresent(current =>
              current.map(candidate =>
                candidate.token.key === entry.token.key &&
                candidate.phase === 'entering'
                  ? { ...candidate, phase: 'active' }
                  : candidate
              )
            );
          }, 16)
        );
      }

      if (entry.phase !== 'exiting') continue;
      if (retainedExitKeys.has(entry.token.key)) {
        const timer = exitTimers.current.get(entry.token.key);
        if (timer) clearTimeout(timer);
        exitTimers.current.delete(entry.token.key);
        continue;
      }
      if (exitTimers.current.has(entry.token.key)) continue;
      exitTimers.current.set(
        entry.token.key,
        setTimeout(() => {
          exitTimers.current.delete(entry.token.key);
          setPresent(current =>
            current.filter(candidate => candidate.token.key !== entry.token.key)
          );
        }, RIBBON_MOTION_MS)
      );
    }
  }, [present, retainedExitKeys]);

  useEffect(
    () => () => {
      for (const timer of exitTimers.current.values()) clearTimeout(timer);
      for (const timer of enterTimers.current.values()) clearTimeout(timer);
    },
    []
  );
  return present;
}

export function estimateRibbonTokenWidth(token: RibbonToken): number {
  if (token.kind === 'project') {
    return Math.min(210, Math.max(80, token.project.name.length * 7.2 + 56));
  }
  const title = token.tab.title || 'New agent';
  return Math.min(250, Math.max(92, title.length * 7.2 + 74));
}

export function ribbonTargetTransform(target: RibbonTarget, scale = 1): string {
  return `translate3d(${target.x}px, ${target.y}px, 0) scaleX(${scale})`;
}
