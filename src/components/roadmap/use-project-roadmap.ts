/**
 * Roadmap lens data hook (ENG-017): reads the focused Project's roadmap
 * file over the dumb `roadmap:read` IPC, parses it renderer-side with
 * `@exawatt/core` (decision 0011), gathers per-session git evidence, runs
 * closed-vocabulary link inference, and builds the pure ui-model lens view.
 *
 * Refresh triggers: project switch, session set change, window focus (same
 * trigger the settings store uses), and explicit refresh. Live
 * file-watching arrives in S5.
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
  type RoadmapLensView,
} from '@exawatt/ui-model';
import type { RoadmapSessionEvidence } from '@/types/electron';

/** What the workspace knows about a live session in the focused Project. */
export interface RoadmapSessionDescriptor {
  sessionId: string;
  tabId: string;
  title: string;
  harness: string;
  cwd: string;
  contextSummary: string | null;
  needsAttention: boolean;
}

export interface ProjectRoadmap {
  view: RoadmapLensView;
  refresh: () => void;
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
  const [evidence, setEvidence] = useState<Record<string, RoadmapSessionEvidence>>({});
  // survives re-renders; bumped to invalidate in-flight reads on refresh
  const generation = useRef(0);

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

  useEffect(() => {
    // show the shimmer only across project switches, not focus refreshes
    setRead({ status: 'loading' });
    load();
  }, [load]);

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
            prev[cwd]?.commitSubjects.join('\n') === result.commitSubjects.join('\n')
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
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [load, loadEvidence]);

  // live updates (S5): main watches the roadmap file's directory and
  // broadcasts; a change to THIS project's roadmap reparses immediately —
  // an agent committing a roadmap edit shows up without a focus round-trip
  useEffect(() => {
    const api = window.electron?.roadmap;
    // fixture sources never change on disk — nothing to watch
    if (readSource || !projectDir || !api?.watch) return;
    void api.watch(projectDir).catch(() => {});
    const off = api.onFileChanged?.(({ projectDir: changed }) => {
      if (changed === projectDir) load();
    });
    return () => {
      off?.();
      void api.unwatch(projectDir).catch(() => {});
    };
  }, [projectDir, load, readSource]);

  const view = useMemo(() => {
    const inputs: RoadmapLensSessionInput[] = sessions.map(s => ({
      sessionId: s.sessionId,
      tabId: s.tabId,
      title: s.title,
      harness: s.harness,
      needsAttention: s.needsAttention,
    }));
    let links: SessionLink[] = declaredLinks;
    if (read.status === 'ok' && projectDir) {
      const candidates: SessionLinkCandidate[] = sessions.map(s => ({
        sessionId: s.sessionId,
        tabId: s.tabId,
        projectDir,
        title: s.title,
        contextSummary: s.contextSummary,
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
    return buildRoadmapLens({ read, sessions: inputs, links });
  }, [read, sessions, declaredLinks, evidence, projectDir]);

  return { view, refresh: load };
}
