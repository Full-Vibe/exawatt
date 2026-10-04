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
 *
 * A read that FAILS is not a Project with no roadmap (BUG-162). It used to
 * write the same `absent` a successful read of nothing writes, so a roadmap
 * over the reader's byte limit made the strip, the Project dot and ⌘J read
 * every Session in that Project as quiet while the rail showed the error.
 * Now a failed read declares the producer BLIND to that Project's Sessions,
 * so the merge answers unknown for them and names this producer. That holds
 * even with an earlier good parse in hand: keeping it made a Session the
 * file had since unblocked read "roadmap-blocked" in ⌘J and Fleet for as long
 * as the file stayed unreadable, with nothing to age it out. A held block's
 * `since` survives the gap (`pinRoadmapBlockedSince`), so the ⌘J order is
 * intact when the file reads again.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { parseRoadmap } from '@exawatt/core';
import {
  createLatestRequest,
  useLatestRequest,
  type LatestRequest,
  type RequestTicket,
} from '@/hooks/use-latest-request';
import {
  deriveFleetRoadmapBlocked,
  pinRoadmapBlockedSince,
  type RoadmapAttentionProject,
  type RoadmapAttentionRead,
  type RoadmapAttentionSession,
} from '@exawatt/ui-model';
import {
  fleetAttention,
  scopedAttention,
  type AttentionSource,
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
  observationToken?: string;
}

const PENDING: CachedRead = { mtimeMs: null, read: { status: 'pending' } };
const ABSENT: CachedRead = { mtimeMs: null, read: { status: 'absent' } };

function failed(error: string): CachedRead {
  return { mtimeMs: null, read: { status: 'failed', error } };
}

export function useFleetRoadmapAttention(
  projects: readonly FleetRoadmapProject[]
): AttentionSource {
  const [reads, setReads] = useState<Record<string, CachedRead>>({});
  const [published, setPublished] = useState<Record<string, string>>({});
  const publicationTickets = useRef(new Map<string, number>());
  const retriedPublications = useRef(new Map<string, string>());
  const dirsKey = useMemo(
    () => [...new Set(projects.map(project => project.dir))].sort().join('\n'),
    [projects]
  );
  const dirs = useMemo(
    () => (dirsKey === '' ? [] : dirsKey.split('\n')),
    [dirsKey]
  );
  // One pass per set of open Projects: a read that resolves after its
  // Project closed (or after a newer pass started) must not resurrect stale
  // state. Follow-up reads (file change, focus) belong to the current pass.
  const passes = useLatestRequest();
  // And one channel per Project: two reads of the same roadmap can overlap
  // (a file change during a focus refresh), and the older one must not land
  // after the newer one. The mtime guard below only skips a parse; ordering
  // is this channel's job.
  const channels = useRef(new Map<string, LatestRequest>());
  const channelFor = (dir: string): LatestRequest => {
    let channel = channels.current.get(dir);
    if (!channel) {
      channel = createLatestRequest();
      channels.current.set(dir, channel);
    }
    return channel;
  };

  const load = useRef<(dir: string, pass: RequestTicket) => void>(() => {});
  load.current = (dir: string, pass: RequestTicket) => {
    const api = window.electron?.roadmap;
    if (!api) {
      setReads(prev =>
        prev[dir] === ABSENT ? prev : { ...prev, [dir]: ABSENT }
      );
      return;
    }
    const ticket = channelFor(dir).begin();
    const commit = (next: (cached: CachedRead | undefined) => CachedRead) => {
      if (!pass.current || !ticket.current) return;
      setReads(prev => {
        const cached = prev[dir];
        const entry = next(cached);
        return entry === cached ? prev : { ...prev, [dir]: entry };
      });
    };
    // A read that did not answer is not evidence about the roadmap, and an
    // older parse is not evidence about it NOW: the Project is unread.
    const keepOrFail = (error: string) => (cached: CachedRead | undefined) =>
      cached?.read.status === 'failed' && cached.read.error === error
        ? cached
        : failed(error);
    void api
      .read(dir)
      .then(result => {
        if (result.status === 'error') {
          commit(keepOrFail(result.error));
          return;
        }
        if (result.status !== 'ok') {
          commit(cached =>
            cached?.read.status === 'absent' &&
            cached.observationToken === result.observationToken
              ? cached
              : { ...ABSENT, observationToken: result.observationToken }
          );
          return;
        }
        commit(cached => {
          // The parse is the expensive half; an unchanged file skips it and
          // returns the same state object, so no consumer re-renders.
          if (
            cached?.mtimeMs === result.mtimeMs &&
            cached.read.status === 'ok'
          ) {
            return cached.observationToken === result.observationToken
              ? cached
              : { ...cached, observationToken: result.observationToken };
          }
          const doc = parseRoadmap(result.text, {
            projectDir: dir,
            file: result.file,
          });
          return {
            mtimeMs: result.mtimeMs,
            read: { status: 'ok', doc },
            observationToken: result.observationToken,
          };
        });
      })
      .catch((reason: unknown) => {
        commit(
          keepOrFail(reason instanceof Error ? reason.message : String(reason))
        );
      });
  };

  // Project set changed: read the new ones, forget the closed ones.
  useEffect(() => {
    const pass = passes.begin();
    const open = new Set(dirs);
    for (const [dir, channel] of channels.current) {
      if (!open.has(dir)) {
        channel.invalidate();
        channels.current.delete(dir);
      }
    }
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
    for (const dir of dirs) load.current(dir, pass);
  }, [dirs, passes]);

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
      if (dirs.includes(projectDir)) load.current(projectDir, passes.current());
    });
    return () => off?.();
  }, [dirs, passes]);

  // The same fallback the lens uses when a watcher could not be installed.
  useEffect(() => {
    const onFocus = () => {
      for (const dir of dirs) load.current(dir, passes.current());
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [dirs, passes]);

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

  // The renderer owns parsing and link inference; main owns source request
  // identities, read receipts, checkpointing, and one alert transition.
  const authoritative =
    typeof window !== 'undefined' &&
    !!window.electron?.roadmap?.publishAttention;
  useEffect(() => {
    const publish = window.electron?.roadmap?.publishAttention;
    if (!publish) return;
    for (const project of projects) {
      const cached = reads[project.dir];
      if (
        !cached?.observationToken ||
        (cached.read.status !== 'ok' && cached.read.status !== 'absent')
      )
        continue;
      const sessions = project.sessions.flatMap(session =>
        session.durableSessionId
          ? [
              {
                sessionId: session.sessionId,
                durableSessionId: session.durableSessionId,
                itemIds: fleet.blocked
                  .filter(entry => entry.sessionId === session.sessionId)
                  .map(entry => entry.itemId),
              },
            ]
          : []
      );
      if (sessions.length === 0) continue;
      const ticket = (publicationTickets.current.get(project.dir) ?? 0) + 1;
      publicationTickets.current.set(project.dir, ticket);
      const token = cached.observationToken;
      const acknowledge = (accepted: boolean) => {
        if (publicationTickets.current.get(project.dir) !== ticket) return;
        if (!accepted) {
          const rejected = JSON.stringify([
            token,
            sessions.map(session => session.sessionId),
          ]);
          if (retriedPublications.current.get(project.dir) !== rejected) {
            retriedPublications.current.set(project.dir, rejected);
            load.current(project.dir, passes.current());
          }
        }
        setPublished(previous => {
          if (accepted && previous[project.dir] === token) return previous;
          if (!accepted && !(project.dir in previous)) return previous;
          const next = { ...previous };
          if (accepted) next[project.dir] = token;
          else delete next[project.dir];
          return next;
        });
      };
      void publish({
        projectDir: project.dir,
        observationToken: token,
        sessions,
      })
        .then(acknowledge)
        .catch(() => acknowledge(false));
    }
  }, [fleet, projects, reads, passes]);

  // `since` survives Project switches; see `pinRoadmapBlockedSince`.
  const pins = useRef<ReadonlyMap<string, number>>(new Map());
  return useMemo(() => {
    pins.current = pinRoadmapBlockedSince(pins.current, fleet, Date.now());
    const signals: Record<string, SessionAttentionSignal> = {};
    for (const entry of fleet.blocked) {
      const since = pins.current.get(entry.sessionId);
      if (since === undefined) continue;
      if (!authoritative)
        signals[entry.sessionId] = { kind: 'roadmap-blocked', since };
    }
    // Fleet-wide by construction: every open Project's live Sessions were
    // evaluated by the same rule, wherever the operator is standing. Unless
    // some could not be: a Session whose Project has not answered, or whose
    // roadmap could not be read, is outside this producer's coverage, and
    // saying so is what keeps the merge from reading it as quiet.
    const blind = new Set([...fleet.pending, ...fleet.unread]);
    if (authoritative) {
      for (const project of projects) {
        if (
          !reads[project.dir]?.observationToken ||
          published[project.dir] !== reads[project.dir]?.observationToken
        ) {
          for (const session of project.sessions) blind.add(session.sessionId);
        }
      }
    }
    if (blind.size === 0) return fleetAttention('roadmap', signals);
    const covered = projects.flatMap(project =>
      project.sessions
        .map(session => session.sessionId)
        .filter(sessionId => !blind.has(sessionId))
    );
    return scopedAttention('roadmap', signals, covered);
  }, [fleet, projects, authoritative, published, reads]);
}
