/**
 * Roadmap lens data hook (ENG-017): reads the focused Project's roadmap
 * file over the dumb `roadmap:read` IPC, parses it renderer-side with
 * `@exawatt/core` (decision 0011), gathers per-session git evidence, runs
 * closed-vocabulary link inference, and builds the pure ui-model lens view.
 *
 * Refresh triggers: project switch, session set change, window focus (same
 * trigger the settings store uses), explicit refresh, and the main-process
 * roadmap file-change broadcast. The watch behind that broadcast belongs to
 * `useFleetRoadmapAttention`, which watches every open Project.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  inferSessionLinks,
  parseRoadmap,
  type SessionLink,
  type SessionLinkCandidate,
} from '@exawatt/core';
import {
  buildRoadmapLens,
  type RoadmapLensRead,
  type RoadmapLensSessionInput,
  type RoadmapRecentChange,
  type RoadmapLensView,
} from '@exawatt/ui-model';
import type {
  RoadmapSessionEvidence,
  RoadmapUndoResult,
  RoadmapWriteAction,
  RoadmapWriteResult,
} from '@/types/electron';

/** What the workspace knows about a live session in the focused Project. */
export interface RoadmapSessionDescriptor {
  sessionId: string;
  tabId: string;
  title: string;
  harness: string;
  cwd: string;
  contextSummary: string | null;
  initialTask: string | null;
  needsAttention: boolean;
  startedAt: number | null;
  turnState: RoadmapLensSessionInput['turnState'];
}

export interface ProjectRoadmap {
  view: RoadmapLensView;
  refresh: () => void;
  write: (
    action: RoadmapWriteAction,
    confirmed?: boolean
  ) => Promise<RoadmapWriteResult>;
  undo: (token: string) => Promise<RoadmapUndoResult>;
}

/** `roadmap:read`-shaped result an injected source resolves to. */
export type RoadmapReadResult =
  | { status: 'ok'; text: string; file: string; mtimeMs: number }
  | { status: 'none'; checked: string[] }
  | { status: 'error'; error: string };

/**
 * Injected roadmap source (ENG-027 W2): the Demo Workspace serves fixture
 * markdown through the SAME hook and parser instead of the `roadmap:read`
 * IPC. Must be referentially stable (module fn / useCallback). When set, git
 * evidence and file watching are skipped — the source is not a filesystem.
 */
export type RoadmapReadSource = (
  projectDir: string
) => RoadmapReadResult | Promise<RoadmapReadResult>;

export function useProjectRoadmap(
  projectDir: string | null,
  sessions: RoadmapSessionDescriptor[] = [],
  /** declared-at-launch links (S4); they override inference in the lens */
  declaredLinks: SessionLink[] = [],
  readSource?: RoadmapReadSource
): ProjectRoadmap {
  const [read, setRead] = useState<RoadmapLensRead>({ status: 'loading' });
  const [evidence, setEvidence] = useState<
    Record<string, RoadmapSessionEvidence>
  >({});
  const [recentChanges, setRecentChanges] = useState<RoadmapRecentChange[]>([]);
  // survives re-renders; bumped to invalidate in-flight reads on refresh
  const generation = useRef(0);
  const activityGeneration = useRef(0);

  const load = useCallback(() => {
    const api = window.electron?.roadmap;
    const readVia: RoadmapReadSource | undefined =
      readSource ?? (api ? dir => api.read(dir) : undefined);
    if (!projectDir || !readVia) {
      setRead({ status: 'loading' });
      return;
    }
    const gen = ++generation.current;
    void Promise.resolve(readVia(projectDir))
      .then(result => {
        if (gen !== generation.current) return;
        if (result.status === 'ok') {
          const doc = parseRoadmap(result.text, {
            projectDir,
            file: result.file,
          });
          setRead(prev =>
            prev.status === 'ok' && prev.doc.contentHash === doc.contentHash
              ? prev
              : { status: 'ok', doc, mtimeMs: result.mtimeMs }
          );
        } else if (result.status === 'none') {
          setRead({ status: 'none', checked: result.checked });
        } else {
          setRead({ status: 'error', error: result.error });
        }
      })
      .catch(reason => {
        if (gen !== generation.current) return;
        setRead({
          status: 'error',
          error: reason instanceof Error ? reason.message : String(reason),
        });
      });
  }, [projectDir, readSource]);

  const loadActivity = useCallback(() => {
    const api = window.electron?.roadmap;
    const gen = ++activityGeneration.current;
    if (readSource || !projectDir || !api?.activity) {
      setRecentChanges([]);
      return;
    }
    void api
      .activity(projectDir)
      .then(changes => {
        if (gen === activityGeneration.current) setRecentChanges(changes);
      })
      .catch(() => {
        if (gen === activityGeneration.current) setRecentChanges([]);
      });
  }, [projectDir, readSource]);

  useEffect(() => {
    // show the shimmer only across project switches, not focus refreshes
    setRead({ status: 'loading' });
    load();
    loadActivity();
  }, [load, loadActivity]);

  // Commits do not necessarily touch the roadmap file. Keep the bounded
  // recent-change trail live while the Project lens exists without adding a
  // second watcher or treating git as project state.
  useEffect(() => {
    if (readSource || !projectDir) return;
    const timer = window.setInterval(loadActivity, 30_000);
    return () => window.clearInterval(timer);
  }, [loadActivity, projectDir, readSource]);

  // git evidence per unique session cwd (worktrees carry their own branch)
  const cwdKey = useMemo(
    () => [...new Set(sessions.map(s => s.cwd))].sort().join('\n'),
    [sessions]
  );
  const loadEvidence = useCallback(() => {
    const api = window.electron?.roadmap;
    // an injected source is not a filesystem: no git evidence to gather
    if (readSource || !api || cwdKey === '') return;
    for (const cwd of cwdKey.split('\n')) {
      void api
        .sessionEvidence(cwd)
        .then(result =>
          setEvidence(prev =>
            prev[cwd]?.branch === result.branch &&
            prev[cwd]?.commitSubjects.join('\n') ===
              result.commitSubjects.join('\n')
              ? prev
              : { ...prev, [cwd]: result }
          )
        )
        .catch(() => {});
    }
  }, [cwdKey, readSource]);
  useEffect(loadEvidence, [loadEvidence]);

  useEffect(() => {
    const onFocus = () => {
      load();
      loadEvidence();
      loadActivity();
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [load, loadEvidence, loadActivity]);

  // live updates (S5): main watches the roadmap file's directory and
  // broadcasts; a change to THIS project's roadmap reparses immediately —
  // an agent committing a roadmap edit shows up without a focus round-trip.
  //
  // This lens LISTENS but no longer owns the watch (BUG-026):
  // `useFleetRoadmapAttention` watches every open Project, and two owners of
  // one per-directory watcher fight — whichever unwatched first (a Project
  // switch here) would blind the other, and fleet-wide attention would go
  // stale for the Project the operator just left.
  useEffect(() => {
    const api = window.electron?.roadmap;
    // fixture sources never change on disk — nothing to listen for
    if (readSource || !projectDir || !api) return;
    const off = api.onFileChanged?.(({ projectDir: changed }) => {
      if (changed === projectDir) {
        load();
        loadActivity();
      }
    });
    return () => off?.();
  }, [projectDir, load, loadActivity, readSource]);

  const view = useMemo(() => {
    const inputs: RoadmapLensSessionInput[] = sessions.map(s => ({
      sessionId: s.sessionId,
      tabId: s.tabId,
      title: s.title,
      harness: s.harness,
      needsAttention: s.needsAttention,
      startedAt: s.startedAt,
      turnState: s.turnState,
    }));
    let links: SessionLink[] = declaredLinks;
    if (read.status === 'ok' && projectDir) {
      const candidates: SessionLinkCandidate[] = sessions.map(s => ({
        sessionId: s.sessionId,
        tabId: s.tabId,
        projectDir,
        title: s.title,
        contextSummary: s.contextSummary,
        initialTask: s.initialTask,
        cwd: s.cwd,
        branch: evidence[s.cwd]?.branch ?? null,
        worktreeDirname: evidence[s.cwd]?.worktreeDirname ?? null,
        commitSubjects: evidence[s.cwd]?.commitSubjects ?? [],
      }));
      const declaredSessions = new Set(declaredLinks.map(l => l.sessionId));
      links = [
        ...declaredLinks,
        ...inferSessionLinks(read.doc, candidates).filter(
          l => !declaredSessions.has(l.sessionId)
        ),
      ];
    }
    return buildRoadmapLens({ read, sessions: inputs, links, recentChanges });
  }, [read, sessions, declaredLinks, evidence, projectDir, recentChanges]);

  const write = useCallback(
    async (
      action: RoadmapWriteAction,
      confirmed = false
    ): Promise<RoadmapWriteResult> => {
      const api = window.electron?.roadmap;
      if (!api?.writeState || !projectDir || read.status !== 'ok') {
        return {
          status: 'failed',
          message: 'Roadmap writes are unavailable',
          permission: 'roadmap-state-write',
        };
      }
      const result = await api.writeState({
        projectDir,
        file: read.doc.file,
        expectedContentHash: read.doc.contentHash,
        action,
        confirmed,
      });
      if (result.status === 'applied') load();
      return result;
    },
    [load, projectDir, read]
  );

  const undo = useCallback(
    async (token: string): Promise<RoadmapUndoResult> => {
      const result = (await window.electron?.roadmap?.undoState?.(token)) ?? {
        status: 'failed' as const,
        message: 'Roadmap undo is unavailable',
      };
      if (result.status === 'applied') load();
      return result;
    },
    [load]
  );

  return { view, refresh: load, write, undo };
}
