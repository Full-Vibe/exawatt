'use client';

/**
 * Workspace state (ENG-002 W0.2): project groups keyed by PROJECT
 * DIRECTORY, tabs within them, persistence, and exact-ID resume.
 *
 * Model decisions (operator, 2026-07-02):
 * - one app window; projects are groups inside it (⌘1..9 switches
 *   project, ⌘⇧[/] rotates the GLOBAL tab ring, crossing projects)
 * - launching REQUIRES a project directory (never a silent home default);
 *   the last-used directory is remembered
 * - directory → project resolution happens in the main process (worktrees
 *   map to their main repo), so grouping is consistent everywhere
 * - on app restart, layout restores without spawning. Each agent resumes only
 *   an exact saved provider ID after an explicit operator action; a renderer
 *   reload re-adopts still-live PTYs.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { HARNESS_META } from './harnesses';
import { pickDistinctColor, projectColor } from './project-colors';
import {
  SESSION_JUMP_EVENT,
  LAUNCH_EVENT,
  OPEN_PROJECT_EVENT,
  TOGGLE_SPLIT_EVENT,
  consumePendingSessionJump,
  consumePendingLaunch,
  consumePendingOpenProject,
} from './session-jump';
import { loadTerminalFont } from './terminal-font';
import {
  openRepositoryProject,
  listProjects,
  renameProject as registryRenameProject,
  setProjectColor as registrySetProjectColor,
} from '@/lib/projects/registry';
import type {
  PtyAttention,
  PtyHarness,
  PtyReentryRecap,
  PtySessionInfo,
} from '@/types/electron';

export interface WorkspaceTab {
  /** stable across revives (sessionId changes when a tab is re-launchd) */
  id: string;
  /** stable logical Session identity, distinct from tab/PTY/provider IDs */
  durableSessionId: string;
  harness: PtyHarness;
  title: string;
  cwd: string;
  sessionId: string | null;
  harnessSessionId: string | null;
  resumeState: ResumeState;
  lifecycle: SessionLifecycle;
  /** null = running; number = exit code; REVIVE_FAILED = revive error */
  exitCode: number | null;
  /** roadmap item declared at launch (ENG-017 S4) — a machine-local view
   *  annotation per decision 0010; overrides link inference, never synced */
  roadmapItemId: string | null;
}

export type SessionLifecycle =
  | 'running'
  | 'stopped-clean'
  | 'interrupted'
  | 'exited'
  | 'resuming'
  | 'failed';

export type ResumeState =
  | 'live'
  | 'ended-resumable'
  | 'identity-missing'
  | 'resuming'
  | 'resumed'
  | 'failed';

export function tabIsLive(tab: WorkspaceTab): boolean {
  return tab.resumeState === 'live' || tab.resumeState === 'resumed';
}

export function tabCanResumeAsAgent(tab: WorkspaceTab): boolean {
  return (
    !tabIsLive(tab) &&
    tab.resumeState !== 'resuming' &&
    tab.harness !== 'shell' &&
    !!tab.harnessSessionId
  );
}

export interface Project {
  /** projectDir — the identity/grouping key */
  dir: string;
  name: string;
  /** distinct per-project hue (least-used at creation; operator can pick) */
  color: string;
  /** the synced registry row id (S5 P3): links this group to Supabase for
   *  name/color sync. Derived from the registry on load / launch, not persisted. */
  registryId?: string | null;
  tabs: WorkspaceTab[];
  activeTabId: string | null;
}

/** Current persisted layout (v5). v5 adds durable identity and lifecycle. */
export interface PersistedV5 {
  v: 5;
  lastUsedDir: string;
  activeDir: string | null;
  /** split view (S2): tab pinned beside the active one; optional (pre-S2
   *  layouts lack it) */
  pinnedTabId?: string | null;
  /** durable recency record (ENG-016 D8): a Project whose tabs all closed
   *  stays reachable from ⌘K even offline or signed out; most recent first,
   *  capped. Optional — pre-D8 layouts lack it. */
  recentProjects?: Array<{
    dir: string;
    name: string;
    color?: string;
    lastOpenedAt: number;
  }>;
  projects: Array<{
    dir: string;
    name: string;
    color?: string;
    activeTabId: string | null;
    tabs: Array<{
      id: string;
      durableSessionId: string;
      harness: PtyHarness;
      title: string;
      cwd: string;
      sessionId: string | null;
      harnessSessionId: string | null;
      roadmapItemId: string | null;
      lifecycle: SessionLifecycle;
      exitCode: number | null;
    }>;
  }>;
}

/** v4 layout on disk: v5 minus durable identity and lifecycle. */
type PersistedV4 = Omit<PersistedV5, 'v' | 'projects'> & {
  v: 4;
  projects: Array<
    Omit<PersistedV5['projects'][number], 'tabs'> & {
      tabs: Array<
        Omit<
          PersistedV5['projects'][number]['tabs'][number],
          'durableSessionId' | 'lifecycle' | 'exitCode'
        >
      >;
    }
  >;
};

/** v3 layout on disk: v4 minus the per-tab declared roadmap link. */
type PersistedV3 = Omit<PersistedV4, 'v' | 'projects'> & {
  v: 3;
  projects: Array<
    Omit<PersistedV4['projects'][number], 'tabs'> & {
      tabs: Array<
        Omit<PersistedV4['projects'][number]['tabs'][number], 'roadmapItemId'>
      >;
    }
  >;
};

type PersistedV2 = Omit<PersistedV3, 'v' | 'projects'> & {
  v: 2;
  projects: Array<
    Omit<PersistedV3['projects'][number], 'tabs'> & {
      tabs: Array<
        Omit<
          PersistedV3['projects'][number]['tabs'][number],
          'harnessSessionId'
        >
      >;
    }
  >;
};

/** v1 layout on disk: identical v2 shape under the old `initiatives` key. */
type PersistedV1 = Omit<PersistedV2, 'v' | 'projects'> & {
  v: 1;
  initiatives: PersistedV2['projects'];
};

export const REVIVE_FAILED = -999;

let tabCounter = 0;
function newTabId(): string {
  return `tab-${Date.now().toString(36)}-${++tabCounter}`;
}

function newDurableSessionId(): string {
  return `session-${crypto.randomUUID()}`;
}

/** Read the persisted layout, upgrading older shapes in place: v1 (key
 *  `initiatives`) → v2 (key `projects`) → v3 (exact provider IDs) → v4
 *  (declared roadmap links) → v5 (durable lifecycle). */
export function parsePersisted(raw: unknown): PersistedV5 | null {
  if (!raw || typeof raw !== 'object') return null;
  const d = raw as { v?: number; projects?: unknown; initiatives?: unknown };
  const toV5 = (p: PersistedV4): PersistedV5 => ({
    ...p,
    v: 5,
    projects: p.projects.map(project => ({
      ...project,
      tabs: project.tabs.map(tab => ({
        ...tab,
        durableSessionId: tab.id,
        lifecycle: 'stopped-clean' as const,
        exitCode: null,
      })),
    })),
  });
  if (d.v === 5 && Array.isArray(d.projects)) {
    const parsed = raw as PersistedV5;
    const seen = new Set<string>();
    return {
      ...parsed,
      projects: parsed.projects.map(project => ({
        ...project,
        tabs: project.tabs.map(tab => {
          let durableSessionId = tab.durableSessionId || tab.id;
          if (seen.has(durableSessionId))
            durableSessionId = `${tab.id}-session`;
          seen.add(durableSessionId);
          const lifecycle: SessionLifecycle = [
            'running',
            'stopped-clean',
            'interrupted',
            'exited',
            'resuming',
            'failed',
          ].includes(tab.lifecycle)
            ? tab.lifecycle
            : 'stopped-clean';
          return {
            ...tab,
            durableSessionId,
            lifecycle,
            exitCode: tab.exitCode ?? null,
          };
        }),
      })),
    };
  }
  if (d.v === 4 && Array.isArray(d.projects)) return toV5(raw as PersistedV4);
  const toV4 = (p: Omit<PersistedV3, 'v'>): PersistedV4 => ({
    ...p,
    v: 4 as const,
    projects: p.projects.map(project => ({
      ...project,
      tabs: project.tabs.map(tab => ({ ...tab, roadmapItemId: null })),
    })),
  });
  if (d.v === 3 && Array.isArray(d.projects)) {
    const { v: _v, ...rest } = raw as PersistedV3;
    return toV5(toV4(rest));
  }
  const upgrade = (
    projects: PersistedV2['projects'],
    rest: Omit<PersistedV2, 'v' | 'projects'>
  ) =>
    toV5(
      toV4({
        ...rest,
        projects: projects.map(project => ({
          ...project,
          tabs: project.tabs.map(tab => ({ ...tab, harnessSessionId: null })),
        })),
      })
    );
  if (d.v === 2 && Array.isArray(d.projects)) {
    const { projects, v: _v, ...rest } = raw as PersistedV2;
    return upgrade(projects, rest);
  }
  if (d.v === 1 && Array.isArray(d.initiatives)) {
    const { initiatives, v: _v, ...rest } = raw as PersistedV1;
    return upgrade(initiatives, rest);
  }
  return null;
}

export interface LaunchOptions {
  harness: PtyHarness;
  dir: string;
  /** create a git worktree (<repo>-wt/<branch>) and launch inside it */
  worktreeBranch?: string;
  /** roadmap item this session will work on (ENG-017 S4, optional) */
  roadmapItemId?: string;
}

export interface WorkspaceStateOptions {
  /**
   * Estimated terminal size for NEW sessions (from the pane container).
   * Passing real dimensions at spawn kills the width race: TUIs read the
   * terminal size during init, and a resize sent milliseconds later can
   * land before their WINCH handler exists — leaving them drawn at the
   * 80-col default forever.
   */
  getInitialSize?: () => { cols: number; rows: number } | null;
}

export function useWorkspaceState(options: WorkspaceStateOptions = {}) {
  const sizeRef = useRef(options.getInitialSize);
  sizeRef.current = options.getInitialSize;
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeDir, setActiveDir] = useState<string | null>(null);
  const [lastUsedDir, setLastUsedDir] = useState('');
  /** split view (S2): this tab renders beside the active one ("watch one,
   *  drive one"); null = no split */
  const [pinnedTabId, setPinnedTabId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  /** micro-context subtitles keyed by sessionId (ephemeral — main process
   *  regenerates them; never persisted) */
  const [summaries, setSummaries] = useState<Record<string, string>>({});
  /** needs-operator flags keyed by sessionId (ENG-015 S1; main is truth) */
  const [attention, setAttention] = useState<Record<string, PtyAttention>>({});
  /** quiet, one-shot S4 catch-up for the session currently being revisited */
  const [reentryRecap, setReentryRecap] = useState<PtyReentryRecap | null>(
    null
  );
  const dismissReentryRecap = useCallback(() => setReentryRecap(null), []);
  const stateRef = useRef({ projects, activeDir, lastUsedDir, pinnedTabId });
  stateRef.current = { projects, activeDir, lastUsedDir, pinnedTabId };
  // dirs whose identity the operator edited locally — the reconcile-on-load
  // must not clobber a rename/recolor made while the registry fetch was still
  // in flight (its snapshot is already stale), and instead pushes it up.
  const editedDirsRef = useRef<Set<string>>(new Set());
  /** durable Project recency (ENG-016 D8) — loaded from the persisted layout,
   *  re-merged on every save so closed Projects survive */
  const recentsRef = useRef<NonNullable<PersistedV5['recentProjects']>>([]);
  const readyRef = useRef(ready);
  readyRef.current = ready;
  const attentionRef = useRef(attention);
  attentionRef.current = attention;
  const resumeInFlightRef = useRef<Set<string>>(new Set());

  /** append a live session as a tab in its (possibly new) project */
  const addSession = useCallback(
    (s: PtySessionInfo, tabId?: string, roadmapItemId?: string | null) => {
      const tab: WorkspaceTab = {
        id: tabId ?? newTabId(),
        durableSessionId: s.durableSessionId,
        harness: s.harness,
        title: s.title,
        cwd: s.cwd,
        sessionId: s.id,
        harnessSessionId: s.harnessSessionId,
        resumeState: 'live',
        lifecycle: 'running',
        exitCode: s.exited ? (s.exitCode ?? 0) : null,
        roadmapItemId: roadmapItemId ?? null,
      };
      setProjects(prev => {
        const i = prev.findIndex(g => g.dir === s.projectDir);
        if (i === -1) {
          return [
            ...prev,
            {
              dir: s.projectDir,
              name: s.projectName,
              color: pickDistinctColor(prev.map(g => g.color)),
              tabs: [tab],
              activeTabId: tab.id,
            },
          ];
        }
        const next = [...prev];
        next[i] = {
          ...next[i],
          tabs: [...next[i].tabs, tab],
          activeTabId: tab.id,
        };
        return next;
      });
      setActiveDir(s.projectDir);
      return tab.id;
    },
    []
  );

  const updateTab = useCallback(
    (tabId: string, patch: Partial<WorkspaceTab>) => {
      setProjects(prev =>
        prev.map(g =>
          g.tabs.some(t => t.id === tabId)
            ? {
                ...g,
                tabs: g.tabs.map(t =>
                  t.id === tabId ? { ...t, ...patch } : t
                ),
              }
            : g
        )
      );
    },
    []
  );

  // ---- mount: adopt live sessions, restore ended layout without spawning ----
  useEffect(() => {
    const api = window.electron?.pty;
    const ws = window.electron?.workspace;
    if (!api) return;
    let cancelled = false;
    // flags cleared by events BETWEEN the pty:list snapshot resolving and
    // the seed merge must stay cleared — main won't re-broadcast for them
    const clearedBeforeSeed = new Set<string>();

    void (async () => {
      // the font settles here too: the revive loop below reads the spawn
      // size via getInitialSize, whose cell metrics come from the resolved
      // font — spawning with defaults while a custom font loads recreates
      // the TUI init-width race
      const [live, persistedRaw, recovery] = await Promise.all([
        api.list(),
        ws?.load() ?? Promise.resolve(null),
        ws?.recovery() ?? Promise.resolve({ previousRunInterrupted: false }),
        loadTerminalFont(),
      ]);
      if (cancelled) return;
      const persisted = parsePersisted(persistedRaw);
      const liveByDurableId = new Map(live.map(s => [s.durableSessionId, s]));
      // adopt existing summaries + attention flags (renderer reload)
      const seeded: Record<string, string> = {};
      const seededAttention: Record<string, PtyAttention> = {};
      for (const s of live) {
        if (s.contextSummary) seeded[s.id] = s.contextSummary;
        if (s.attention && !clearedBeforeSeed.has(s.id)) {
          seededAttention[s.id] = s.attention;
        }
      }
      if (Object.keys(seeded).length > 0) {
        setSummaries(prev => ({ ...seeded, ...prev }));
      }
      if (Object.keys(seededAttention).length > 0) {
        setAttention(prev => ({ ...seededAttention, ...prev }));
      }
      if (persisted) {
        const assigned: Array<string | undefined> = persisted.projects.map(
          g => g.color
        );
        const restored: Project[] = persisted.projects.map((g, gi) => ({
          dir: g.dir,
          name: g.name,
          color:
            g.color ??
            (assigned[gi] = pickDistinctColor(assigned)) ??
            projectColor(g.dir),
          // belt-and-suspenders vs older/hand-edited files: an activeTabId
          // that matches no tab would blank the pane area
          activeTabId: g.tabs.some(t => t.id === g.activeTabId)
            ? g.activeTabId
            : (g.tabs[0]?.id ?? null),
          tabs: g.tabs.map(t => {
            const s = liveByDurableId.get(t.durableSessionId);
            if (s && !s.exited) {
              liveByDurableId.delete(s.durableSessionId);
              return {
                ...t,
                sessionId: s.id,
                harnessSessionId: s.harnessSessionId ?? t.harnessSessionId,
                resumeState: 'live' as const,
                lifecycle: 'running' as const,
                exitCode: s.exited ? (s.exitCode ?? 0) : null,
              };
            }
            if (s?.exited) {
              liveByDurableId.delete(s.durableSessionId);
              return {
                ...t,
                sessionId: null,
                harnessSessionId: s.harnessSessionId ?? t.harnessSessionId,
                resumeState: s.harnessSessionId
                  ? ('ended-resumable' as const)
                  : ('identity-missing' as const),
                lifecycle: 'exited' as const,
                exitCode: s.exitCode ?? t.exitCode,
              };
            }
            // App restart: process is gone. Restore history and identity, but
            // never spawn until the operator explicitly resumes.
            return {
              ...t,
              sessionId: null,
              exitCode: t.exitCode,
              lifecycle:
                recovery.previousRunInterrupted &&
                (t.lifecycle === 'running' || t.lifecycle === 'resuming')
                  ? ('interrupted' as const)
                  : t.lifecycle === 'running' || t.lifecycle === 'resuming'
                    ? ('stopped-clean' as const)
                    : t.lifecycle,
              resumeState: t.harnessSessionId
                ? ('ended-resumable' as const)
                : ('identity-missing' as const),
            };
          }),
        }));
        setProjects(restored);
        setActiveDir(persisted.activeDir ?? restored[0]?.dir ?? null);
        setLastUsedDir(persisted.lastUsedDir ?? '');
        // tolerate a corrupt/hand-edited recentProjects: a bad shape here
        // must not break every later debounced save or the shutdown
        // checkpoint (which calls recentsRef.current.filter)
        recentsRef.current = Array.isArray(persisted.recentProjects)
          ? persisted.recentProjects.filter(
              (r): r is (typeof persisted.recentProjects)[number] =>
                !!r && typeof r === 'object' && typeof r.dir === 'string'
            )
          : [];
        // restore the split only if the pinned tab still exists
        const pinned = persisted.pinnedTabId ?? null;
        if (pinned && restored.some(g => g.tabs.some(t => t.id === pinned))) {
          setPinnedTabId(pinned);
        }
      }
      // live sessions unknown to the persisted layout (e.g. created since
      // the last save) — or the whole fresh-start case
      for (const s of liveByDurableId.values()) {
        if (!s.exited) addSession(s);
      }
      setReady(true);
      // reconcile durable identity (S5 P3) — async, so a slow/offline registry
      // never delays the terminal: adopt each Project's synced name/color (a
      // rename/recolor made on another machine or a prior run shows here) and
      // link the group to its registry row for future syncs.
      void listProjects()
        .then(registry => {
          if (cancelled || registry.length === 0) return;
          const byPath = new Map(registry.map(p => [p.root_path, p]));
          setProjects(prev =>
            prev.map(g => {
              const r = byPath.get(g.dir);
              if (!r) return g;
              // A rename/recolor made during this async window must win over
              // the now-stale registry snapshot: link the row but keep the
              // local edit (it's pushed up below so it still syncs). Otherwise
              // adopt the synced name/color.
              return editedDirsRef.current.has(g.dir)
                ? { ...g, registryId: r.id }
                : {
                    ...g,
                    registryId: r.id,
                    name: r.name || g.name,
                    color: r.color || g.color,
                  };
            })
          );
          // Edits made before the row's id was known couldn't sync (the verbs
          // guard on registryId); now that we have the ids, push them up.
          for (const g of stateRef.current.projects) {
            const r = byPath.get(g.dir);
            if (!r || !editedDirsRef.current.has(g.dir)) continue;
            if (g.name && g.name !== r.name) {
              void registryRenameProject(r.id, g.name).catch(() => {});
            }
            if (g.color && g.color !== r.color) {
              void registrySetProjectColor(r.id, g.color).catch(() => {});
            }
          }
        })
        .catch(() => {});
    })();

    const offExit = api.onExit(({ id, durableSessionId, exitCode }) => {
      setProjects(prev =>
        prev.map(g => ({
          ...g,
          tabs: g.tabs.map(t =>
            t.sessionId === id || t.durableSessionId === durableSessionId
              ? {
                  ...t,
                  sessionId: null,
                  exitCode,
                  resumeState: t.harnessSessionId
                    ? 'ended-resumable'
                    : 'identity-missing',
                  lifecycle: 'exited',
                }
              : t
          ),
        }))
      );
    });
    const offIdentity = api.onIdentity?.(
      ({ id, durableSessionId, harnessSessionId }) => {
        setProjects(prev =>
          prev.map(g => ({
            ...g,
            tabs: g.tabs.map(t =>
              t.sessionId === id || t.durableSessionId === durableSessionId
                ? { ...t, harnessSessionId }
                : t
            ),
          }))
        );
      }
    );
    const offContext = api.onContext?.(({ id, summary }) => {
      setSummaries(prev => ({ ...prev, [id]: summary }));
    });
    const offRecap = api.onRecap?.(next => {
      const { projects: groups, activeDir: dir } = stateRef.current;
      const active = groups.find(group => group.dir === dir);
      const tab = active?.tabs.find(
        candidate => candidate.id === active.activeTabId
      );
      if (tab?.sessionId === next.id) setReentryRecap(next);
    });
    const offAttention = api.onAttention?.(({ id, attention: att }) => {
      if (att) clearedBeforeSeed.delete(id);
      else clearedBeforeSeed.add(id);
      setAttention(prev => {
        if (att) return { ...prev, [id]: att };
        if (!(id in prev)) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      });
    });
    return () => {
      cancelled = true;
      offExit();
      offIdentity?.();
      offContext?.();
      offRecap?.();
      offAttention?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const serializeWorkspace = useCallback(
    (cleanShutdown = false): PersistedV5 => {
      const {
        projects: gs,
        activeDir: ad,
        lastUsedDir: lu,
        pinnedTabId: pin,
      } = stateRef.current;
      const pinSurvives =
        pin !== null &&
        gs.some(g => g.tabs.some(t => t.id === pin && tabIsLive(t)));
      const now = Date.now();
      const recents = [
        ...gs.map(g => ({
          dir: g.dir,
          name: g.name,
          ...(g.color ? { color: g.color } : {}),
          lastOpenedAt: now,
        })),
        ...recentsRef.current.filter(r => !gs.some(g => g.dir === r.dir)),
      ].slice(0, 12);
      recentsRef.current = recents;
      return {
        v: 5,
        lastUsedDir: lu,
        activeDir: ad,
        pinnedTabId: pinSurvives ? pin : null,
        recentProjects: recents,
        projects: gs
          .map(g => {
            const tabs = g.tabs.map(tab => {
              const stopped =
                cleanShutdown &&
                (tabIsLive(tab) || tab.lifecycle === 'resuming');
              return {
                id: tab.id,
                durableSessionId: tab.durableSessionId,
                harness: tab.harness,
                title: tab.title,
                cwd: tab.cwd,
                sessionId: stopped ? null : tab.sessionId,
                harnessSessionId: tab.harnessSessionId,
                roadmapItemId: tab.roadmapItemId,
                lifecycle: stopped ? ('stopped-clean' as const) : tab.lifecycle,
                exitCode: tab.exitCode,
              };
            });
            return {
              dir: g.dir,
              name: g.name,
              color: g.color,
              activeTabId: tabs.some(t => t.id === g.activeTabId)
                ? g.activeTabId
                : (tabs[0]?.id ?? null),
              tabs,
            };
          })
          .filter(g => g.tabs.length > 0),
      };
    },
    []
  );

  // ---- persistence: debounced; ended tabs remain as explicit resume targets ----
  useEffect(() => {
    if (!ready) return;
    const ws = window.electron?.workspace;
    if (!ws) return;
    const handle = setTimeout(() => void ws.save(serializeWorkspace()), 400);
    return () => clearTimeout(handle);
  }, [
    projects,
    activeDir,
    lastUsedDir,
    pinnedTabId,
    ready,
    serializeWorkspace,
  ]);

  useEffect(() => {
    if (!ready) return;
    const appApi = window.electron?.app;
    const ws = window.electron?.workspace;
    const ptyApi = window.electron?.pty;
    if (!appApi || !ws || !ptyApi) return;
    return appApi.onCheckpointRequest(({ requestId }) => {
      const state = serializeWorkspace(true);
      void ptyApi
        .list()
        .then(live => {
          const byDurable = new Map(
            live.map(session => [session.durableSessionId, session])
          );
          for (const project of state.projects) {
            for (const tab of project.tabs) {
              const session = byDurable.get(tab.durableSessionId);
              if (session?.harnessSessionId) {
                tab.harnessSessionId = session.harnessSessionId;
              }
            }
          }
          return ws.save(state);
        })
        .then(() => appApi.completeCheckpoint(requestId, true))
        .catch(() => appApi.completeCheckpoint(requestId, false));
    });
  }, [ready, serializeWorkspace]);

  // ---- verbs ----
  const launch = useCallback(
    async (opts: LaunchOptions): Promise<boolean> => {
      const api = window.electron?.pty;
      if (!api) return false;
      const dir = opts.dir.trim();
      if (!dir) {
        setError(
          'Project directory is required — pick where this session lives.'
        );
        return false;
      }
      let cwd = dir;
      if (opts.worktreeBranch) {
        const wt = await api.createWorktree(dir, opts.worktreeBranch.trim());
        if (!wt.ok) {
          setError(wt.error);
          return false;
        }
        cwd = wt.path;
      }
      const size = sizeRef.current?.() ?? null;
      const tabId = newTabId();
      const durableSessionId = newDurableSessionId();
      const res = await api.create({
        harness: opts.harness,
        cwd,
        title: HARNESS_META[opts.harness].label,
        durableSessionId,
        ...(size ?? {}),
      });
      if (!res.ok) {
        setError(res.error);
        return false;
      }
      setError(null);
      setLastUsedDir(dir);
      addSession(res.session, tabId, opts.roadmapItemId ?? null);
      // Resolution bridge (ENG-015 S5 P3): register/refresh this directory's
      // Project in the durable, synced registry. Best-effort — a registry
      // failure (offline, not signed in) must NEVER stop the operator opening
      // a session, so it runs detached and swallows its own errors.
      void openRepositoryProject({
        rootPath: res.session.projectDir,
        name: res.session.projectName,
      })
        .then(proj => {
          // link the group to its registry row + adopt synced identity; a NEW
          // Project has no registry color yet, so push our locally-assigned
          // one up so it syncs to other machines.
          setProjects(prev =>
            prev.map(g =>
              g.dir === proj.root_path
                ? {
                    ...g,
                    registryId: proj.id,
                    name: proj.name || g.name,
                    color: proj.color || g.color,
                  }
                : g
            )
          );
          if (!proj.color) {
            const g = stateRef.current.projects.find(
              p => p.dir === proj.root_path
            );
            if (g)
              void registrySetProjectColor(proj.id, g.color).catch(() => {});
          }
        })
        .catch(() => {});
      return true;
    },
    [addSession]
  );

  const closeTab = useCallback(async (tabId: string) => {
    const api = window.electron?.pty;
    if (!api) return;
    const { projects: gs } = stateRef.current;
    const g = gs.find(x => x.tabs.some(t => t.id === tabId));
    const tab = g?.tabs.find(t => t.id === tabId);
    setPinnedTabId(cur => (cur === tabId ? null : cur));
    if (tab && !(await api.deleteSession(tab.durableSessionId))) return;
    setProjects(prev => {
      const next = prev
        .map(grp => {
          if (!grp.tabs.some(t => t.id === tabId)) return grp;
          const tabs = grp.tabs.filter(t => t.id !== tabId);
          const activeTabId =
            grp.activeTabId === tabId
              ? (tabs[tabs.length - 1]?.id ?? null)
              : grp.activeTabId;
          return { ...grp, tabs, activeTabId };
        })
        .filter(grp => grp.tabs.length > 0);
      setActiveDir(cur =>
        next.some(grp => grp.dir === cur) ? cur : (next[0]?.dir ?? null)
      );
      return next;
    });
  }, []);

  const resumeTab = useCallback(
    async (tabId: string, selectedHarnessId?: string): Promise<boolean> => {
      const api = window.electron?.pty;
      if (!api) return false;
      const tab = stateRef.current.projects
        .flatMap(project => project.tabs)
        .find(candidate => candidate.id === tabId);
      if (resumeInFlightRef.current.has(tabId)) return false;
      if (!tab || tabIsLive(tab) || tab.resumeState === 'resuming')
        return false;
      const exactId = selectedHarnessId ?? tab.harnessSessionId;
      if (tab.harness !== 'shell' && !exactId) {
        setError(
          `Choose the exact ${HARNESS_META[tab.harness].label} conversation.`
        );
        return false;
      }
      resumeInFlightRef.current.add(tabId);
      updateTab(tabId, {
        resumeState: 'resuming',
        lifecycle: 'resuming',
        exitCode: null,
      });
      const size = sizeRef.current?.() ?? null;
      let result;
      try {
        result = await api.create({
          harness: tab.harness,
          cwd: tab.cwd,
          title: tab.title,
          durableSessionId: tab.durableSessionId,
          ...(exactId ? { resumeSessionId: exactId } : {}),
          ...(size ?? {}),
        });
      } finally {
        resumeInFlightRef.current.delete(tabId);
      }
      if (!result.ok) {
        updateTab(tabId, {
          resumeState: 'failed',
          lifecycle: 'failed',
          exitCode: REVIVE_FAILED,
        });
        setError(result.error);
        return false;
      }
      updateTab(tabId, {
        sessionId: result.session.id,
        harnessSessionId: result.session.harnessSessionId ?? exactId ?? null,
        cwd: result.session.cwd,
        resumeState: exactId ? 'resumed' : 'live',
        lifecycle: 'running',
        exitCode: null,
      });
      setError(null);
      return true;
    },
    [updateTab]
  );

  const resumeTabs = useCallback(
    async (tabs: WorkspaceTab[]) => {
      for (const tab of tabs) {
        if (tabCanResumeAsAgent(tab)) {
          await resumeTab(tab.id);
        }
      }
    },
    [resumeTab]
  );

  const resumeProject = useCallback(
    (dir: string) => {
      const project = stateRef.current.projects.find(
        group => group.dir === dir
      );
      if (project) void resumeTabs(project.tabs);
    },
    [resumeTabs]
  );

  const resumeAll = useCallback(() => {
    void resumeTabs(stateRef.current.projects.flatMap(project => project.tabs));
  }, [resumeTabs]);

  /** launch in the active project's directory (fallback: last used) —
   *  the one dir-resolution path for ⌘T, palette commands, and buttons */
  const launchHere = useCallback(
    (harness: PtyHarness): boolean => {
      const { projects: gs, activeDir: ad, lastUsedDir: lu } = stateRef.current;
      const dir = gs.find(g => g.dir === ad)?.dir ?? (lu || null);
      if (!dir) {
        setError(
          'Project directory is required — pick where this session lives.'
        );
        return false;
      }
      void launch({ harness, dir });
      return true;
    },
    [launch]
  );

  /** ⌘K Projects: open a known Project by its directory — activate it if it
   *  already has live tabs, else launch a shell there (opening/reviving it). */
  const openProject = useCallback(
    (dir: string): void => {
      const g = stateRef.current.projects.find(p => p.dir === dir);
      // activate only if something is actually live there; a group of only
      // dead/resumable tabs should launch a fresh shell (per the contract),
      // not switch to a resume panel.
      if (g && g.tabs.some(tabIsLive)) {
        setActiveDir(dir);
        return;
      }
      void launch({ harness: 'shell', dir });
    },
    [launch]
  );

  const selectProject = useCallback((index: number): boolean => {
    const g = stateRef.current.projects[index];
    if (!g) return false;
    setActiveDir(g.dir);
    return true;
  }, []);

  /** activate the tab hosting this session, wherever it lives (⌘K switcher) */
  const activateSession = useCallback((sessionId: string): boolean => {
    const { projects: gs } = stateRef.current;
    for (const g of gs) {
      const tab = g.tabs.find(t => t.sessionId === sessionId);
      if (tab) {
        setActiveDir(g.dir);
        setProjects(prev =>
          prev.map(x => (x.dir === g.dir ? { ...x, activeTabId: tab.id } : x))
        );
        return true;
      }
    }
    return false;
  }, []);

  /** ⌘D: pin the active tab for a split ("watch one, drive one") — the
   *  pinned tab stays visible beside whatever becomes active; ⌘D unpins.
   *  A pin whose session died is stale, not a real pin — ⌘D then pins the
   *  active tab directly instead of "unpinning" nothing visible. */
  const togglePin = useCallback((): boolean => {
    const { projects: gs, activeDir: ad, pinnedTabId: pin } = stateRef.current;
    const pinAlive =
      pin !== null &&
      gs.some(g => g.tabs.some(t => t.id === pin && tabIsLive(t)));
    if (pinAlive) {
      setPinnedTabId(null);
      return true;
    }
    const active = gs.find(g => g.dir === ad);
    const tab = active?.tabs.find(t => t.id === active.activeTabId);
    if (!tab) {
      setPinnedTabId(null); // still drop a stale pin
      return pin !== null;
    }
    setPinnedTabId(tab.id === pin ? null : tab.id);
    return true;
  }, []);

  const selectTab = useCallback((dir: string, tabId: string) => {
    setActiveDir(dir);
    setProjects(prev =>
      prev.map(g => (g.dir === dir ? { ...g, activeTabId: tabId } : g))
    );
  }, []);

  /** ⌘⇧[/]: rotate through ALL tabs in display order, crossing project
   *  boundaries (operator, 2026-07-03) — the strip is one global ring */
  const cycleTab = useCallback((delta: 1 | -1): boolean => {
    const { projects: gs, activeDir: ad } = stateRef.current;
    const flat = gs.flatMap(g => g.tabs.map(t => ({ dir: g.dir, tab: t })));
    if (flat.length === 0) return false;
    const g = gs.find(x => x.dir === ad);
    const cur = flat.findIndex(
      e => e.dir === ad && e.tab.id === g?.activeTabId
    );
    let next: (typeof flat)[number];
    if (cur === -1) {
      // stale/no active tab: RECOVER in place on the current project's
      // first tab (never yank the user to another project)
      const anchor = flat.findIndex(e => e.dir === ad);
      next = flat[anchor === -1 ? 0 : anchor];
    } else {
      next = flat[(cur + delta + flat.length) % flat.length];
    }
    setActiveDir(next.dir);
    setProjects(prev =>
      prev.map(x =>
        x.dir === next.dir ? { ...x, activeTabId: next.tab.id } : x
      )
    );
    return true;
  }, []);

  const activeProject = projects.find(g => g.dir === activeDir) ?? null;
  /** operator naming (W0.4): titles/names persist via the layout save; the
   *  PTY session is renamed too so fleet/spatial show the same identity */
  const renameTab = useCallback(
    (tabId: string, title: string) => {
      const next = title.trim();
      if (!next) return;
      updateTab(tabId, { title: next });
      const tab = stateRef.current.projects
        .flatMap(g => g.tabs)
        .find(t => t.id === tabId);
      if (tab?.sessionId) {
        void window.electron?.pty?.rename(tab.sessionId, next);
      }
    },
    [updateTab]
  );

  const setProjectColor = useCallback((dir: string, color: string) => {
    editedDirsRef.current.add(dir);
    setProjects(prev => prev.map(g => (g.dir === dir ? { ...g, color } : g)));
    // sync to the durable registry so the recolor persists + syncs (best-effort)
    const g = stateRef.current.projects.find(p => p.dir === dir);
    if (g?.registryId) {
      void registrySetProjectColor(g.registryId, color).catch(() => {});
    }
  }, []);

  const renameProject = useCallback((dir: string, name: string) => {
    const next = name.trim();
    if (!next) return;
    editedDirsRef.current.add(dir);
    setProjects(prev =>
      prev.map(g => (g.dir === dir ? { ...g, name: next } : g))
    );
    // sync to the durable registry so the rename persists + syncs (best-effort)
    const g = stateRef.current.projects.find(p => p.dir === dir);
    if (g?.registryId) {
      void registryRenameProject(g.registryId, next).catch(() => {});
    }
  }, []);

  const activeTab =
    activeProject?.tabs.find(t => t.id === activeProject.activeTabId) ?? null;

  /** ⌘J: jump to the OLDEST session needing the operator (repeat = walk the
   *  queue — focusing each one clears it, surfacing the next-oldest) */
  const jumpAttention = useCallback((): boolean => {
    const { projects: gs } = stateRef.current;
    const flagged = Object.entries(attentionRef.current).sort(
      (a, b) => a[1].since - b[1].since
    );
    for (const [sessionId] of flagged) {
      for (const g of gs) {
        const tab = g.tabs.find(
          t => t.sessionId === sessionId && t.exitCode === null
        );
        if (tab) {
          setActiveDir(g.dir);
          setProjects(prev =>
            prev.map(x => (x.dir === g.dir ? { ...x, activeTabId: tab.id } : x))
          );
          return true;
        }
      }
    }
    return false;
  }, []);

  // ---- palette requests (S2): the ⌘K switcher lives at the app root and
  // asks the workspace to activate a session / launch a harness. Live events
  // handle the mounted-and-ready case; before ready the pending slot is left
  // alone so the ready-effect below applies it against the LOADED layout
  // (acting early would fail against empty state and lose the request).
  useEffect(() => {
    const onJump = (e: Event) => {
      if (!readyRef.current) return;
      consumePendingSessionJump();
      activateSession((e as CustomEvent<string>).detail);
    };
    const onLaunch = (e: Event) => {
      if (!readyRef.current) return;
      consumePendingLaunch();
      launchHere((e as CustomEvent<PtyHarness>).detail);
    };
    const onToggleSplit = () => {
      if (readyRef.current) togglePin();
    };
    // JUMP_ATTENTION_EVENT is owned by WorkspaceClient (ENG-017 S8): it runs
    // the full ladder — PTY needs-you, then roadmap-blocked, then starving —
    // so the ⌘J key, the Session menu item, and the palette row all behave
    // identically. The bare state-level jumpAttention() is still called from
    // inside that ladder.
    const onOpenProject = (e: Event) => {
      if (!readyRef.current) return;
      consumePendingOpenProject();
      openProject((e as CustomEvent<string>).detail);
    };
    window.addEventListener(SESSION_JUMP_EVENT, onJump);
    window.addEventListener(LAUNCH_EVENT, onLaunch);
    window.addEventListener(OPEN_PROJECT_EVENT, onOpenProject);
    window.addEventListener(TOGGLE_SPLIT_EVENT, onToggleSplit);
    return () => {
      window.removeEventListener(SESSION_JUMP_EVENT, onJump);
      window.removeEventListener(LAUNCH_EVENT, onLaunch);
      window.removeEventListener(OPEN_PROJECT_EVENT, onOpenProject);
      window.removeEventListener(TOGGLE_SPLIT_EVENT, onToggleSplit);
    };
  }, [activateSession, launchHere, openProject, togglePin]);

  useEffect(() => {
    if (!ready) return;
    const jump = consumePendingSessionJump();
    if (jump) activateSession(jump);
    const harness = consumePendingLaunch();
    if (harness) launchHere(harness);
    const proj = consumePendingOpenProject();
    if (proj) openProject(proj);
  }, [ready, activateSession, launchHere, openProject]);

  // ---- attention focus contract (S1): tell main which session the operator
  // is looking at — the focused session never flags, and focusing clears.
  // The local record clears optimistically; main confirms via pty:attention.
  const activeSessionId = activeTab?.sessionId ?? null;
  useEffect(() => {
    setReentryRecap(current =>
      current?.id === activeSessionId ? current : null
    );
  }, [activeSessionId]);

  useEffect(() => {
    const api = window.electron?.pty;
    if (!api?.focus) return;
    void api.focus(activeSessionId);
    // optimistic clear ONLY when the operator is really looking (app window
    // focused) — main keeps flags alive for a backgrounded window and is
    // the source of truth; it clears + broadcasts on window refocus
    if (activeSessionId && document.hasFocus()) {
      setAttention(prev => {
        if (!(activeSessionId in prev)) return prev;
        const next = { ...prev };
        delete next[activeSessionId];
        return next;
      });
    }
    // leaving the workspace (unmount) unfocuses — flags accumulate again
    return () => void api.focus(null);
  }, [activeSessionId]);

  return {
    projects,
    activeProject,
    activeTab,
    pinnedTabId,
    lastUsedDir,
    summaries,
    attention,
    reentryRecap,
    error,
    setError,
    dismissReentryRecap,
    ready,
    launch,
    launchHere,
    closeTab,
    resumeTab,
    resumeProject,
    resumeAll,
    selectProject,
    selectTab,
    activateSession,
    cycleTab,
    jumpAttention,
    togglePin,
    renameTab,
    renameProject,
    setProjectColor,
  };
}
