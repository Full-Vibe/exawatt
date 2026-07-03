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
import type { PtyHarness, PtySessionInfo } from '@/types/electron';

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
  tabs: WorkspaceTab[];
  activeTabId: string | null;
}

interface PersistedV1 {
  v: 1;
  lastUsedDir: string;
  activeDir: string | null;
  initiatives: Array<{
    dir: string;
    name: string;
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
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const stateRef = useRef({ initiatives, activeDir, lastUsedDir });
  stateRef.current = { initiatives, activeDir, lastUsedDir };

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
          { dir: s.projectDir, name: s.projectName, tabs: [tab], activeTabId: tab.id },
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

    void (async () => {
      const [live, persistedRaw] = await Promise.all([
        api.list(),
        ws?.load() ?? Promise.resolve(null),
      ]);
      if (cancelled) return;
      const persisted = parsePersisted(persistedRaw);
      const liveById = new Map(live.map((s) => [s.id, s]));
      const toRevive: Array<{ tabId: string; harness: PtyHarness; cwd: string; title: string }> = [];

      if (persisted) {
        const restored: Initiative[] = persisted.initiatives.map((g) => ({
          dir: g.dir,
          name: g.name,
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
    return () => {
      cancelled = true;
      offExit();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- persistence: debounced, exited tabs pruned (no restoring corpses) ----
  useEffect(() => {
    if (!ready) return;
    const ws = window.electron?.workspace;
    if (!ws) return;
    const handle = setTimeout(() => {
      const { initiatives: gs, activeDir: ad, lastUsedDir: lu } = stateRef.current;
      const state: PersistedV1 = {
        v: 1,
        lastUsedDir: lu,
        activeDir: ad,
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
  }, [initiatives, activeDir, lastUsedDir, ready]);

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

  const selectInitiative = useCallback((index: number): boolean => {
    const g = stateRef.current.initiatives[index];
    if (!g) return false;
    setActiveDir(g.dir);
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
  const activeTab =
    activeInitiative?.tabs.find((t) => t.id === activeInitiative.activeTabId) ??
    null;

  return {
    initiatives,
    activeInitiative,
    activeTab,
    lastUsedDir,
    error,
    setError,
    ready,
    ignite,
    closeTab,
    selectInitiative,
    selectTab,
    cycleTab,
  };
}
