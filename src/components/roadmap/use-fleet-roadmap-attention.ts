/**
 * Fleet-wide roadmap attention (BUG-026).
 *
 * Attention is a fleet fact: the tab strip, the Project dots and the ⌘J queue
 * are all fleet-wide surfaces. Roadmap-derived attention used to be computed
 * from the ACTIVE Project's lens and merged into that fleet-wide map, so a
 * Session blocked on a roadmap item in any other Project painted nothing and
 * ⌘J refused to visit it — until the operator stood in that Project.
 *
 * This hook is the fleet-wide producer, and the ONLY owner of roadmap file
 * watching. Its cost is stated, not incidental:
 *
 *   - one `roadmap:read` per OPEN Project, on the Project set changing, on
 *     window focus, and on that Project's own file-change broadcast;
 *   - a parse only when the file's mtime actually moved — a focus refresh
 *     over unchanged roadmaps costs no parsing and no re-render;
 *   - one watcher per open Project (main caps the total at 32 and dedupes);
 *   - one cache entry per open Project, dropped when the Project closes.
 *
 * Nothing here runs per render, per PTY tick, or per Session: there is no
 * per-Session git evidence, deliberately (see `roadmap-attention.ts`).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { parseRoadmap } from '@exawatt/core';
import {
  deriveFleetRoadmapBlocked,
  pinRoadmapBlockedSince,
  type RoadmapAttentionProject,
  type RoadmapAttentionRead,
  type RoadmapAttentionSession,
} from '@exawatt/ui-model';
import {
  fleetAttention,
  type FleetAttentionSource,
  type SessionAttentionSignal,
} from '@/components/workspace/session-status';

/** One open Project's live Sessions, as the producer needs them. */
export interface FleetRoadmapProject {
  dir: string;
  sessions: readonly RoadmapAttentionSession[];
}

interface CachedRead {
  /** file mtime the cached parse came from; null when there is no file */
  mtimeMs: number | null;
  read: RoadmapAttentionRead;
}

const PENDING: CachedRead = { mtimeMs: null, read: { status: 'pending' } };
const ABSENT: CachedRead = { mtimeMs: null, read: { status: 'absent' } };

export function useFleetRoadmapAttention(
  projects: readonly FleetRoadmapProject[]
): FleetAttentionSource {
  const [reads, setReads] = useState<Record<string, CachedRead>>({});
  const dirsKey = useMemo(
    () =>
      [...new Set(projects.map(project => project.dir))].sort().join('\n'),
    [projects]
  );
  const dirs = useMemo(
    () => (dirsKey === '' ? [] : dirsKey.split('\n')),
    [dirsKey]
  );
  // Generation guard per load pass: a read that resolves after its Project
  // closed (or after a newer read started) must not resurrect stale state.
  const generation = useRef(0);

  const load = useRef<(dir: string, gen: number) => void>(() => {});
  load.current = (dir: string, gen: number) => {
    const api = window.electron?.roadmap;
    if (!api) {
      setReads(prev => (prev[dir] === ABSENT ? prev : { ...prev, [dir]: ABSENT }));
      return;
    }
    void api
      .read(dir)
      .then(result => {
        if (gen !== generation.current) return;
        setReads(prev => {
          const cached = prev[dir];
          if (result.status !== 'ok') {
            return cached?.read.status === 'absent'
              ? prev
              : { ...prev, [dir]: ABSENT };
          }
          // The parse is the expensive half; an unchanged file skips it and
          // returns the same state object, so no consumer re-renders.
          if (cached?.mtimeMs === result.mtimeMs && cached.read.status === 'ok') {
            return prev;
          }
          const doc = parseRoadmap(result.text, {
            projectDir: dir,
            file: result.file,
          });
          return {
            ...prev,
            [dir]: { mtimeMs: result.mtimeMs, read: { status: 'ok', doc } },
          };
        });
      })
      .catch(() => {
        if (gen !== generation.current) return;
        setReads(prev =>
          prev[dir]?.read.status === 'absent' ? prev : { ...prev, [dir]: ABSENT }
        );
      });
  };

  // Project set changed: read the new ones, forget the closed ones.
  useEffect(() => {
    const gen = ++generation.current;
    const open = new Set(dirs);
    setReads(prev => {
      const next: Record<string, CachedRead> = {};
      let changed = false;
      for (const dir of dirs) {
        next[dir] = prev[dir] ?? PENDING;
        if (!prev[dir]) changed = true;
      }
      for (const dir of Object.keys(prev)) if (!open.has(dir)) changed = true;
      return changed ? next : prev;
    });
    for (const dir of dirs) load.current(dir, gen);
  }, [dirs]);

  // One owner watches every open Project's roadmap; `use-project-roadmap`
  // only listens. Two owners would fight over main's per-directory watcher:
  // whichever unwatched first would blind the other.
  useEffect(() => {
    const api = window.electron?.roadmap;
    if (!api?.watch) return;
    for (const dir of dirs) void api.watch(dir).catch(() => {});
    return () => {
      for (const dir of dirs) void api.unwatch(dir).catch(() => {});
    };
  }, [dirs]);

  useEffect(() => {
    const api = window.electron?.roadmap;
    const off = api?.onFileChanged?.(({ projectDir }) => {
      if (dirs.includes(projectDir)) load.current(projectDir, generation.current);
    });
    return () => off?.();
  }, [dirs]);

  // The same fallback the lens uses when a watcher could not be installed.
  useEffect(() => {
    const onFocus = () => {
      for (const dir of dirs) load.current(dir, generation.current);
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [dirs]);

  const fleet = useMemo(
    () =>
      deriveFleetRoadmapBlocked(
        projects.map<RoadmapAttentionProject>(project => ({
          dir: project.dir,
          read: reads[project.dir]?.read ?? PENDING.read,
          sessions: project.sessions,
        }))
      ),
    [projects, reads]
  );

  // `since` survives Project switches; see `pinRoadmapBlockedSince`.
  const pins = useRef<ReadonlyMap<string, number>>(new Map());
  return useMemo(() => {
    pins.current = pinRoadmapBlockedSince(pins.current, fleet, Date.now());
    const signals: Record<string, SessionAttentionSignal> = {};
    for (const entry of fleet.blocked) {
      const since = pins.current.get(entry.sessionId);
      if (since === undefined) continue;
      signals[entry.sessionId] = { kind: 'roadmap-blocked', since };
    }
    // Fleet-wide by construction: every open Project's live Sessions were
    // evaluated by the same rule, wherever the operator is standing.
    return fleetAttention('roadmap', signals);
  }, [fleet]);
}
