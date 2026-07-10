'use client';

/**
 * Workspace state (ENG-002 W0.2): initiative groups keyed by PROJECT
 * DIRECTORY, tabs within them, persistence, and auto-revive.
 *
 * Model decisions (operator, 2026-07-02):
 * - one app window; initiatives are groups inside it (⌘1..9 switches
 *   initiative, ⌘⇧[/] rotates the GLOBAL tab ring, crossing projects)
 * - igniting REQUIRES a project directory (never a silent home default);
 *   the last-used directory is remembered
 * - directory → project resolution happens in the main process (worktrees
 *   map to their main repo), so grouping is consistent everywhere
 * - on app restart, layout is restored and dead agent tabs AUTO-REVIVE
 *   (claude --continue / codex resume --last); a mere renderer reload
 *   re-adopts still-live sessions instead
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { HARNESS_META } from './harnesses';
import { pickDistinctColor, projectColor } from './project-colors';
import {
  SESSION_JUMP_EVENT,
  IGNITE_EVENT,
  consumePendingSessionJump,
  consumePendingIgnite,
} from './session-jump';
import type { PtyAttention, PtyHarness, PtySessionInfo } from '@/types/electron';

export interface WorkspaceTab {
  /** stable across revives (sessionId changes when a tab is re-ignited) */
  id: string;
  harness: PtyHarness;
  title: string;
  cwd: string;
  sessionId: string | null;
  /** null = running; number = exit code; REVIVE_FAILED = revive error */
  exitCode: number | null;
}

export interface Initiative {
  /** projectDir — the identity/grouping key */
  dir: string;
  name: string;
  /** distinct per-project hue (least-used at creation; operator can pick) */
  color: string;
  tabs: WorkspaceTab[];
  activeTabId: string | null;
}

interface PersistedV1 {
  v: 1;
  lastUsedDir: string;
  activeDir: string | null;
  /** split view (S2): tab pinned beside the active one; optional (pre-S2
   *  layouts lack it) */
  pinnedTabId?: string | null;
  initiatives: Array<{
    dir: string;
    name: string;
    color?: string;
    activeTabId: string | null;
    tabs: Array<{
      id: string;
      harness: PtyHarness;
      title: string;
      cwd: string;
      sessionId: string | null;
    }>;
  }>;
}

export const REVIVE_FAILED = -999;

let tabCounter = 0;
function newTabId(): string {
  return `tab-${Date.now().toString(36)}-${++tabCounter}`;
}

function parsePersisted(raw: unknown): PersistedV1 | null {
  if (!raw || typeof raw !== 'object') return null;
  const d = raw as Partial<PersistedV1>;
  if (d.v !== 1 || !Array.isArray(d.initiatives)) return null;
  return d as PersistedV1;
}

export interface IgniteOptions {
  harness: PtyHarness;
  dir: string;
  /** create a git worktree (<repo>-wt/<branch>) and ignite inside it */
  worktreeBranch?: string;
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
  const [initiatives, setInitiatives] = useState<Initiative[]>([]);
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
  const stateRef = useRef({ initiatives, activeDir, lastUsedDir, pinnedTabId });
  stateRef.current = { initiatives, activeDir, lastUsedDir, pinnedTabId };
  const readyRef = useRef(ready);
  readyRef.current = ready;
  const attentionRef = useRef(attention);
  attentionRef.current = attention;

  /** append a live session as a tab in its (possibly new) initiative */
  const addSession = useCallback((s: PtySessionInfo, tabId?: string) => {
    const tab: WorkspaceTab = {
      id: tabId ?? newTabId(),
      harness: s.harness,
      title: s.title,
      cwd: s.cwd,
      sessionId: s.id,
      exitCode: s.exited ? (s.exitCode ?? 0) : null,
    };
    setInitiatives((prev) => {
      const i = prev.findIndex((g) => g.dir === s.projectDir);
      if (i === -1) {
        return [
          ...prev,
          {
            dir: s.projectDir,
            name: s.projectName,
            color: pickDistinctColor(prev.map((g) => g.color)),
            tabs: [tab],
            activeTabId: tab.id,
          },
        ];
      }
      const next = [...prev];
      next[i] = { ...next[i], tabs: [...next[i].tabs, tab], activeTabId: tab.id };
      return next;
    });
    setActiveDir(s.projectDir);
    return tab.id;
  }, []);

  const updateTab = useCallback(
    (tabId: string, patch: Partial<WorkspaceTab>) => {
      setInitiatives((prev) =>
        prev.map((g) =>
          g.tabs.some((t) => t.id === tabId)
            ? { ...g, tabs: g.tabs.map((t) => (t.id === tabId ? { ...t, ...patch } : t)) }
            : g
        )
      );
    },
    []
  );

  // ---- mount: adopt live sessions, restore layout, auto-revive ----
  useEffect(() => {
    const api = window.electron?.pty;
    const ws = window.electron?.workspace;
    if (!api) return;
    let cancelled = false;
    // flags cleared by events BETWEEN the pty:list snapshot resolving and
    // the seed merge must stay cleared — main won't re-broadcast for them
    const clearedBeforeSeed = new Set<string>();

    void (async () => {
      const [live, persistedRaw] = await Promise.all([
        api.list(),
        ws?.load() ?? Promise.resolve(null),
      ]);
      if (cancelled) return;
      const persisted = parsePersisted(persistedRaw);
      const liveById = new Map(live.map((s) => [s.id, s]));
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
        setSummaries((prev) => ({ ...seeded, ...prev }));
      }
      if (Object.keys(seededAttention).length > 0) {
        setAttention((prev) => ({ ...seededAttention, ...prev }));
      }
      const toRevive: Array<{ tabId: string; harness: PtyHarness; cwd: string; title: string }> = [];

      if (persisted) {
        const assigned: Array<string | undefined> = persisted.initiatives.map(
          (g) => g.color
        );
        const restored: Initiative[] = persisted.initiatives.map((g, gi) => ({
          dir: g.dir,
          name: g.name,
          color:
            g.color ??
            (assigned[gi] = pickDistinctColor(assigned)) ??
            projectColor(g.dir),
          // belt-and-suspenders vs older/hand-edited files: an activeTabId
          // that matches no tab would blank the pane area
          activeTabId: g.tabs.some((t) => t.id === g.activeTabId)
            ? g.activeTabId
            : (g.tabs[0]?.id ?? null),
          tabs: g.tabs.map((t) => {
            const s = t.sessionId ? liveById.get(t.sessionId) : undefined;
            if (s) {
              liveById.delete(s.id); // renderer reload: session still alive
              return {
                ...t,
                sessionId: s.id,
                exitCode: s.exited ? (s.exitCode ?? 0) : null,
              };
            }
            // app restart: process is gone — revive it below
            toRevive.push({ tabId: t.id, harness: t.harness, cwd: t.cwd, title: t.title });
            return { ...t, sessionId: null, exitCode: null };
          }),
        }));
        setInitiatives(restored);
        setActiveDir(persisted.activeDir ?? restored[0]?.dir ?? null);
        setLastUsedDir(persisted.lastUsedDir ?? '');
        // restore the split only if the pinned tab still exists
        const pinned = persisted.pinnedTabId ?? null;
        if (
          pinned &&
          restored.some((g) => g.tabs.some((t) => t.id === pinned))
        ) {
          setPinnedTabId(pinned);
        }
      }
      // live sessions unknown to the persisted layout (e.g. created since
      // the last save) — or the whole fresh-start case
      for (const s of liveById.values()) addSession(s);
      setReady(true);

      // auto-revive sequentially (no spawn stampede); harness tabs resume
      // their previous conversation in that directory
      for (const r of toRevive) {
        if (cancelled) return;
        const size = sizeRef.current?.() ?? null;
        const res = await api.create({
          harness: r.harness,
          cwd: r.cwd,
          title: r.title,
          resume: r.harness !== 'shell',
          ...(size ?? {}),
        });
        if (cancelled) return;
        if (res.ok) {
          updateTab(r.tabId, {
            sessionId: res.session.id,
            cwd: res.session.cwd,
            exitCode: null,
          });
        } else {
          updateTab(r.tabId, { exitCode: REVIVE_FAILED });
        }
      }
    })();

    const offExit = api.onExit(({ id, exitCode }) => {
      setInitiatives((prev) =>
        prev.map((g) => ({
          ...g,
          tabs: g.tabs.map((t) =>
            t.sessionId === id ? { ...t, exitCode } : t
          ),
        }))
      );
    });
    const offContext = api.onContext?.(({ id, summary }) => {
      setSummaries((prev) => ({ ...prev, [id]: summary }));
    });
    const offAttention = api.onAttention?.(({ id, attention: att }) => {
      if (att) clearedBeforeSeed.delete(id);
      else clearedBeforeSeed.add(id);
      setAttention((prev) => {
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
      offContext?.();
      offAttention?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- persistence: debounced, exited tabs pruned (no restoring corpses) ----
  useEffect(() => {
    if (!ready) return;
    const ws = window.electron?.workspace;
    if (!ws) return;
    const handle = setTimeout(() => {
      const {
        initiatives: gs,
        activeDir: ad,
        lastUsedDir: lu,
        pinnedTabId: pin,
      } = stateRef.current;
      // the pinned tab may be pruned below (exited) — never persist a
      // dangling pin
      const pinSurvives =
        pin !== null &&
        gs.some((g) =>
          g.tabs.some((t) => t.id === pin && t.exitCode === null)
        );
      const state: PersistedV1 = {
        v: 1,
        lastUsedDir: lu,
        activeDir: ad,
        pinnedTabId: pinSurvives ? pin : null,
        initiatives: gs
          .map((g) => {
            const tabs = g.tabs
              .filter((t) => t.exitCode === null)
              .map(({ id, harness, title, cwd, sessionId }) => ({
                id,
                harness,
                title,
                cwd,
                sessionId,
              }));
            return {
              dir: g.dir,
              name: g.name,
              color: g.color,
              // the active tab may have been pruned (it exited) — never
              // persist a dangling id, or the restore renders no pane
              activeTabId: tabs.some((t) => t.id === g.activeTabId)
                ? g.activeTabId
                : (tabs[0]?.id ?? null),
              tabs,
            };
          })
          .filter((g) => g.tabs.length > 0),
      };
      void ws.save(state);
    }, 400);
    return () => clearTimeout(handle);
  }, [initiatives, activeDir, lastUsedDir, pinnedTabId, ready]);

  // ---- verbs ----
  const ignite = useCallback(
    async (opts: IgniteOptions): Promise<boolean> => {
      const api = window.electron?.pty;
      if (!api) return false;
      const dir = opts.dir.trim();
      if (!dir) {
        setError('Project directory is required — pick where this session lives.');
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
      const res = await api.create({
        harness: opts.harness,
        cwd,
        title: HARNESS_META[opts.harness].label,
        ...(size ?? {}),
      });
      if (!res.ok) {
        setError(res.error);
        return false;
      }
      setError(null);
      setLastUsedDir(dir);
      addSession(res.session);
      return true;
    },
    [addSession]
  );

  const closeTab = useCallback(async (tabId: string) => {
    const api = window.electron?.pty;
    if (!api) return;
    const { initiatives: gs } = stateRef.current;
    const g = gs.find((x) => x.tabs.some((t) => t.id === tabId));
    const tab = g?.tabs.find((t) => t.id === tabId);
    setPinnedTabId((cur) => (cur === tabId ? null : cur));
    if (tab?.sessionId) await api.kill(tab.sessionId);
    setInitiatives((prev) => {
      const next = prev
        .map((grp) => {
          if (!grp.tabs.some((t) => t.id === tabId)) return grp;
          const tabs = grp.tabs.filter((t) => t.id !== tabId);
          const activeTabId =
            grp.activeTabId === tabId
              ? (tabs[tabs.length - 1]?.id ?? null)
              : grp.activeTabId;
          return { ...grp, tabs, activeTabId };
        })
        .filter((grp) => grp.tabs.length > 0);
      setActiveDir((cur) =>
        next.some((grp) => grp.dir === cur) ? cur : (next[0]?.dir ?? null)
      );
      return next;
    });
  }, []);

  /** ignite in the active initiative's directory (fallback: last used) —
   *  the one dir-resolution path for ⌘T, palette commands, and buttons */
  const igniteHere = useCallback(
    (harness: PtyHarness): boolean => {
      const { initiatives: gs, activeDir: ad, lastUsedDir: lu } = stateRef.current;
      const dir = gs.find((g) => g.dir === ad)?.dir ?? (lu || null);
      if (!dir) {
        setError('Project directory is required — pick where this session lives.');
        return false;
      }
      void ignite({ harness, dir });
      return true;
    },
    [ignite]
  );

  const selectInitiative = useCallback((index: number): boolean => {
    const g = stateRef.current.initiatives[index];
    if (!g) return false;
    setActiveDir(g.dir);
    return true;
  }, []);

  /** activate the tab hosting this session, wherever it lives (⌘K switcher) */
  const activateSession = useCallback((sessionId: string): boolean => {
    const { initiatives: gs } = stateRef.current;
    for (const g of gs) {
      const tab = g.tabs.find((t) => t.sessionId === sessionId);
      if (tab) {
        setActiveDir(g.dir);
        setInitiatives((prev) =>
          prev.map((x) =>
            x.dir === g.dir ? { ...x, activeTabId: tab.id } : x
          )
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
    const { initiatives: gs, activeDir: ad, pinnedTabId: pin } = stateRef.current;
    const pinAlive =
      pin !== null &&
      gs.some((g) =>
        g.tabs.some((t) => t.id === pin && t.exitCode === null)
      );
    if (pinAlive) {
      setPinnedTabId(null);
      return true;
    }
    const active = gs.find((g) => g.dir === ad);
    const tab = active?.tabs.find((t) => t.id === active.activeTabId);
    if (!tab) {
      setPinnedTabId(null); // still drop a stale pin
      return pin !== null;
    }
    setPinnedTabId(tab.id === pin ? null : tab.id);
    return true;
  }, []);

  const selectTab = useCallback((dir: string, tabId: string) => {
    setActiveDir(dir);
    setInitiatives((prev) =>
      prev.map((g) => (g.dir === dir ? { ...g, activeTabId: tabId } : g))
    );
  }, []);

  /** ⌘⇧[/]: rotate through ALL tabs in display order, crossing project
   *  boundaries (operator, 2026-07-03) — the strip is one global ring */
  const cycleTab = useCallback((delta: 1 | -1): boolean => {
    const { initiatives: gs, activeDir: ad } = stateRef.current;
    const flat = gs.flatMap((g) => g.tabs.map((t) => ({ dir: g.dir, tab: t })));
    if (flat.length === 0) return false;
    const g = gs.find((x) => x.dir === ad);
    const cur = flat.findIndex(
      (e) => e.dir === ad && e.tab.id === g?.activeTabId
    );
    let next: (typeof flat)[number];
    if (cur === -1) {
      // stale/no active tab: RECOVER in place on the current initiative's
      // first tab (never yank the user to another project)
      const anchor = flat.findIndex((e) => e.dir === ad);
      next = flat[anchor === -1 ? 0 : anchor];
    } else {
      next = flat[(cur + delta + flat.length) % flat.length];
    }
    setActiveDir(next.dir);
    setInitiatives((prev) =>
      prev.map((x) =>
        x.dir === next.dir ? { ...x, activeTabId: next.tab.id } : x
      )
    );
    return true;
  }, []);

  const activeInitiative = initiatives.find((g) => g.dir === activeDir) ?? null;
  /** operator naming (W0.4): titles/names persist via the layout save; the
   *  PTY session is renamed too so fleet/spatial show the same identity */
  const renameTab = useCallback(
    (tabId: string, title: string) => {
      const next = title.trim();
      if (!next) return;
      updateTab(tabId, { title: next });
      const tab = stateRef.current.initiatives
        .flatMap((g) => g.tabs)
        .find((t) => t.id === tabId);
      if (tab?.sessionId) {
        void window.electron?.pty?.rename(tab.sessionId, next);
      }
    },
    [updateTab]
  );

  const setInitiativeColor = useCallback((dir: string, color: string) => {
    setInitiatives((prev) =>
      prev.map((g) => (g.dir === dir ? { ...g, color } : g))
    );
  }, []);

  const renameInitiative = useCallback((dir: string, name: string) => {
    const next = name.trim();
    if (!next) return;
    setInitiatives((prev) =>
      prev.map((g) => (g.dir === dir ? { ...g, name: next } : g))
    );
  }, []);

  const activeTab =
    activeInitiative?.tabs.find((t) => t.id === activeInitiative.activeTabId) ??
    null;

  // ---- palette requests (S2): the ⌘K switcher lives at the app root and
  // asks the workspace to activate a session / ignite a harness. Live events
  // handle the mounted-and-ready case; before ready the pending slot is left
  // alone so the ready-effect below applies it against the LOADED layout
  // (acting early would fail against empty state and lose the request).
  useEffect(() => {
    const onJump = (e: Event) => {
      if (!readyRef.current) return;
      consumePendingSessionJump();
      activateSession((e as CustomEvent<string>).detail);
    };
    const onIgnite = (e: Event) => {
      if (!readyRef.current) return;
      consumePendingIgnite();
      igniteHere((e as CustomEvent<PtyHarness>).detail);
    };
    window.addEventListener(SESSION_JUMP_EVENT, onJump);
    window.addEventListener(IGNITE_EVENT, onIgnite);
    return () => {
      window.removeEventListener(SESSION_JUMP_EVENT, onJump);
      window.removeEventListener(IGNITE_EVENT, onIgnite);
    };
  }, [activateSession, igniteHere]);

  useEffect(() => {
    if (!ready) return;
    const jump = consumePendingSessionJump();
    if (jump) activateSession(jump);
    const harness = consumePendingIgnite();
    if (harness) igniteHere(harness);
  }, [ready, activateSession, igniteHere]);

  // ---- attention focus contract (S1): tell main which session the operator
  // is looking at — the focused session never flags, and focusing clears.
  // The local record clears optimistically; main confirms via pty:attention.
  const activeSessionId = activeTab?.sessionId ?? null;
  useEffect(() => {
    const api = window.electron?.pty;
    if (!api?.focus) return;
    void api.focus(activeSessionId);
    // optimistic clear ONLY when the operator is really looking (app window
    // focused) — main keeps flags alive for a backgrounded window and is
    // the source of truth; it clears + broadcasts on window refocus
    if (activeSessionId && document.hasFocus()) {
      setAttention((prev) => {
        if (!(activeSessionId in prev)) return prev;
        const next = { ...prev };
        delete next[activeSessionId];
        return next;
      });
    }
    // leaving the workspace (unmount) unfocuses — flags accumulate again
    return () => void api.focus(null);
  }, [activeSessionId]);

  /** ⌘J: jump to the OLDEST session needing the operator (repeat = walk the
   *  queue — focusing each one clears it, surfacing the next-oldest) */
  const jumpAttention = useCallback((): boolean => {
    const { initiatives: gs } = stateRef.current;
    const flagged = Object.entries(attentionRef.current).sort(
      (a, b) => a[1].since - b[1].since
    );
    for (const [sessionId] of flagged) {
      for (const g of gs) {
        const tab = g.tabs.find(
          (t) => t.sessionId === sessionId && t.exitCode === null
        );
        if (tab) {
          setActiveDir(g.dir);
          setInitiatives((prev) =>
            prev.map((x) =>
              x.dir === g.dir ? { ...x, activeTabId: tab.id } : x
            )
          );
          return true;
        }
      }
    }
    return false;
  }, []);

  return {
    initiatives,
    activeInitiative,
    activeTab,
    pinnedTabId,
    lastUsedDir,
    summaries,
    attention,
    error,
    setError,
    ready,
    ignite,
    igniteHere,
    closeTab,
    selectInitiative,
    selectTab,
    activateSession,
    cycleTab,
    jumpAttention,
    togglePin,
    renameTab,
    renameInitiative,
    setInitiativeColor,
  };
}
