'use client';

/**
 * Agent Terminal Workspace (ENG-002) — orchestration surface.
 *
 * W0.2 model: ONE window; projects are directory-keyed groups inside it
 * (⌘1..9 switches project, ⌘⇧[/] rotates the global tab ring across projects, ⌘T launchs a
 * shell in the active project). Layout persists across app restarts and
 * ended tabs restore without spawning and resume only an exact provider ID.
 * State/verbs live in use-workspace-state; this file is composition only.
 *
 * This terminal regime is FIRST-CLASS: an AI-native tmux++ developed in
 * parallel with the ENG-004 spatial regime — independent skins over the
 * same session system (see docs/product/operator-workflow.md).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { TerminalPane } from './terminal-pane';
import type { PaneLayout } from './terminal-pane';
import {
  acceptTerminalSettings,
  loadTerminalFont,
  loadedTerminalFont,
  resolveTerminalFont,
  terminalFontsEqual,
} from './terminal-font';
import type { EffectiveTerminalFont } from './terminal-font';
import { TabStrip } from './tab-strip';
import { LaunchControls } from './launch-controls';
import { ExposeOverlay } from './expose-overlay';
import { ReentryRecapCard } from './reentry-recap';
import {
  useWorkspaceState,
  tabCanResumeAsAgent,
  tabIsLive,
} from './use-workspace-state';
import { SessionRestorePanel } from './session-restore-panel';
import { RetainedTerminalPane } from './retained-terminal-pane';
import { useWorkspaceShortcuts } from './use-workspace-shortcuts';
import {
  RENAME_ACTIVE_EVENT,
  CLOSE_ACTIVE_EVENT,
  OPEN_OVERVIEW_EVENT,
  FOCUS_ACTIVE_TERMINAL_EVENT,
} from './session-jump';
import {
  useEffectiveShortcut,
  useShortcuts,
} from '@/components/shortcuts';
import { formatShortcutKeys } from '@/lib/shortcuts';
import { useCommandNavigation } from '@/components/nav/command-navigation-provider';
import {
  RoadmapRail,
  ROADMAP_RAIL_FOCUS_EVENT,
  ROADMAP_DRILL_EVENT,
  loadRailMode,
  saveRailMode,
  type RoadmapRailMode,
} from '@/components/roadmap/roadmap-rail';
import {
  useProjectRoadmap,
  type RoadmapSessionDescriptor,
} from '@/components/roadmap/use-project-roadmap';
import { findRoadmapSessionChip } from '@exawatt/ui-model';
import { HUD } from '@/components/hud';
import { spatialReturnHref } from '@/components/nav/spatial-return';
import { Bell, BellOff, FolderOpen, Play, SquareTerminal, X } from 'lucide-react';
import { middleTruncatePath } from './path-label';

/** the discoverability layer (S3): the workspace SHOWS its keys, exactly
 *  like the spatial map's bottom legend — normal case, dim, always there */
const KEY_HINTS: Array<{ shortcutId: string; label: string }> = [
  { shortcutId: 'command-palette', label: 'commands' },
  { shortcutId: 'workspace-overview', label: 'overview' },
  { shortcutId: 'workspace-new-project', label: 'new project' },
  { shortcutId: 'workspace-new-shell', label: 'shell' },
  { shortcutId: 'workspace-split', label: 'split' },
  { shortcutId: 'workspace-roadmap', label: 'roadmap' },
  { shortcutId: 'workspace-jump-attention', label: 'needs you' },
  { shortcutId: 'workspace-rename', label: 'rename' },
  { shortcutId: 'toggle-regime', label: 'spatial' },
  { shortcutId: 'help-modal-slash', label: 'all keys' },
];

function WorkspaceKeyHint({
  shortcutId,
  label,
  roomy = false,
}: {
  shortcutId: string;
  label: string;
  roomy?: boolean;
}) {
  const keys = useEffectiveShortcut(shortcutId);
  if (!keys) return null;
  return (
    <span className={`flex items-center ${roomy ? 'gap-1.5' : 'gap-1'}`}>
      <kbd
        className={`rounded border px-1 ${roomy ? 'py-0.5 text-[10px]' : 'leading-4'}`}
        style={{
          borderColor: roomy
            ? 'rgba(80,230,255,0.3)'
            : 'rgba(80,230,255,0.25)',
          color: HUD.textMono,
        }}
      >
        {formatShortcutKeys(keys)}
      </kbd>
      {label}
    </span>
  );
}

export function WorkspaceClient() {
  const { navigateCommandSurface } = useCommandNavigation();
  // SSR renders neither branch; the electron check runs after mount so the
  // server and client HTML always match (hydration safety)
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const inElectron = mounted && !!window.electron?.pty;

  const panesRef = useRef<HTMLDivElement>(null);
  const chromeRef = useRef<HTMLDivElement>(null);
  // split view (S2): the last active NON-pinned tab — the driven/left side.
  // Lives up here unconditionally (rules of hooks); assigned below once the
  // active tab is known.
  const companionRef = useRef<string | null>(null);

  // effective terminal font = defaults + userData/settings.json (S3) —
  // panes render only after it resolves so every terminal is born with the
  // right font (one local IPC; imperceptible). The state hook awaits the
  // SAME loadTerminalFont() promise before auto-reviving, so restored
  // sessions never spawn with default metrics while a custom font loads.
  const [font, setFont] = useState<EffectiveTerminalFont | null>(null);
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [resumeNoticeDismissed, setResumeNoticeDismissed] = useState(false);
  useEffect(() => {
    if (!inElectron) return;
    let cancelled = false;
    const apply = (next: Promise<EffectiveTerminalFont>) =>
      void next.then(resolved => {
        if (!cancelled) {
          setFont(current =>
            terminalFontsEqual(current, resolved) ? current : resolved
          );
        }
      });
    apply(loadTerminalFont());
    void window.electron?.settings
      ?.get()
      .then(settings =>
        setNotificationsEnabled(settings.notifications?.attention ?? false)
      );
    const offSettings = window.electron?.settings?.onChanged?.(settings => {
      apply(Promise.resolve(acceptTerminalSettings(settings)));
      setNotificationsEnabled(settings.notifications?.attention ?? false);
    });
    return () => {
      cancelled = true;
      offSettings?.();
    };
  }, [inElectron]);

  // derive the spawn-size estimate from the terminal's own font config —
  // new sessions spawn at (approximately) their final size so TUIs never
  // init at 80 cols; the pane's post-attach wiggle-resync covers any drift
  const getInitialSize = useCallback(() => {
    const el = panesRef.current;
    if (!el || el.offsetWidth === 0 || el.offsetHeight === 0) return null;
    const f = loadedTerminalFont() ?? resolveTerminalFont(null);
    const cellW = f.cellWidthEstimate;
    const cellH = f.size * f.lineHeight;
    return {
      cols: Math.min(500, Math.max(20, Math.floor(el.offsetWidth / cellW))),
      rows: Math.min(200, Math.max(10, Math.floor(el.offsetHeight / cellH))),
    };
  }, []);

  const router = useRouter();
  const searchParams = useSearchParams();
  const { openCommandPalette, openHelpModal } = useShortcuts();
  const {
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
    launch,
    launchHere,
    closeTab,
    resumeTab,
    resumeProject,
    resumeAll,
    selectProject,
    selectTab,
    cycleTab,
    jumpAttention,
    togglePin,
    renameTab,
    renameProject,
    setProjectColor,
  } = useWorkspaceState({ getInitialSize });

  const readyAgentCount = useMemo(
    () =>
      projects
        .flatMap(project => project.tabs)
        .filter(tabCanResumeAsAgent).length,
    [projects]
  );

  useEffect(() => {
    const off = window.electron?.pty?.onNotificationClick(({ id }) => {
      for (const project of projects) {
        const tab = project.tabs.find(item => item.sessionId === id);
        if (tab) {
          selectTab(project.dir, tab.id);
          return;
        }
      }
    });
    return off;
  }, [projects, selectTab]);

  const toggleNotifications = () => {
    void window.electron?.settings
      ?.setAttentionNotifications(!notificationsEnabled)
      .then(settings =>
        setNotificationsEnabled(settings.notifications?.attention ?? false)
      )
      .catch(reason =>
        setError(
          reason instanceof Error
            ? reason.message
            : 'Could not update notifications'
        )
      );
  };

  // roadmap rail (ENG-017 S2): ⌘B cycles open → focused → collapsed strip.
  // Mode is a machine-local view preference (localStorage); starts as the
  // ambient strip and re-reads the saved preference after mount (SSR-safe).
  const [railMode, setRailMode] = useState<RoadmapRailMode>('strip');
  useEffect(() => setRailMode(loadRailMode()), []);
  const updateRailMode = useCallback((mode: RoadmapRailMode) => {
    setRailMode(mode);
    saveRailMode(mode);
  }, []);
  // narrow windows: the rail floats over the stage instead of docking, so
  // terminals never reflow below a comfortable column width
  const [railDocks, setRailDocks] = useState(true);
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1180px)');
    const apply = () => setRailDocks(mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);

  // the lens data: live sessions of the focused Project, linked to roadmap
  // items by inference (S3); the same view feeds the rail and the
  // context-bar reciprocal chip
  const roadmapSessions = useMemo<RoadmapSessionDescriptor[]>(
    () =>
      (activeProject?.tabs ?? [])
        .filter(t => t.sessionId && tabIsLive(t))
        .map(t => ({
          sessionId: t.sessionId as string,
          tabId: t.id,
          title: t.title,
          harness: t.harness,
          cwd: t.cwd,
          contextSummary: summaries[t.sessionId as string] ?? null,
          needsAttention: !!attention[t.sessionId as string],
        })),
    [activeProject, summaries, attention]
  );
  // declared-at-launch links (S4): machine-local tab annotations that
  // override inference; a declared id the roadmap no longer contains falls
  // to the unmapped shelf, never silently back to inference
  const declaredLinks = useMemo(
    () =>
      (activeProject?.tabs ?? [])
        .filter(t => t.roadmapItemId && t.sessionId && tabIsLive(t))
        .map(t => ({
          sessionId: t.sessionId as string,
          tabId: t.id,
          projectDir: activeProject?.dir ?? '',
          itemId: t.roadmapItemId as string,
          method: 'declared' as const,
          confidence: 'high' as const,
          evidence: [{ kind: 'declared' as const, excerpt: 'declared at launch' }],
          evaluatedAt: 0,
        })),
    [activeProject]
  );
  const { view: roadmapView } = useProjectRoadmap(
    activeProject?.dir ?? null,
    roadmapSessions,
    declaredLinks
  );
  // the launch picker offers the unfinished queue of the active project
  const launchRoadmapItems = useMemo(
    () =>
      roadmapView.status === 'ok'
        ? [...roadmapView.now, ...roadmapView.next, ...roadmapView.later].map(
            item => ({
              id: item.id,
              label: item.declaredId
                ? `${item.declaredId} — ${item.title}`
                : item.title,
            })
          )
        : [],
    [roadmapView]
  );
  const activeItemChip =
    activeTab && roadmapView.status === 'ok'
      ? findRoadmapSessionChip(roadmapView, activeTab.id)
      : null;

  // exposé overview (S3): ⌘O — sessions fan out as tiles
  const requestedOverview = searchParams.get('view') === 'sessions';
  const [overviewOpen, setOverviewOpen] = useState(requestedOverview);
  const updateOverview = useCallback(
    (open: boolean) => {
      setOverviewOpen(open);
      const href = open ? '/workspace?view=sessions' : '/workspace';
      const current = `${window.location.pathname}${window.location.search}`;
      if (current !== href) router.replace(href, { scroll: false });
    },
    [router]
  );
  useEffect(() => setOverviewOpen(requestedOverview), [requestedOverview]);
  const closeOverview = useCallback(() => {
    updateOverview(false);
    requestAnimationFrame(() =>
      window.dispatchEvent(new CustomEvent(FOCUS_ACTIVE_TERMINAL_EVENT))
    );
  }, [updateOverview]);

  // palette-issued workspace verbs (close/overview live here; the rest are
  // handled by the state hook and the tab strip)
  useEffect(() => {
    const onCloseActive = () => {
      const g = projects.find(x => x.tabs.some(t => t.id === activeTab?.id));
      if (g && activeTab) void closeTab(activeTab.id);
    };
    const onOpenOverview = () => {
      updateOverview(true);
    };
    window.addEventListener(CLOSE_ACTIVE_EVENT, onCloseActive);
    window.addEventListener(OPEN_OVERVIEW_EVENT, onOpenOverview);
    return () => {
      window.removeEventListener(CLOSE_ACTIVE_EVENT, onCloseActive);
      window.removeEventListener(OPEN_OVERVIEW_EVENT, onOpenOverview);
    };
  }, [projects, activeTab, closeTab, updateOverview]);

  const shortcutActions = useMemo(() => {
      const focusTerminal = () => {
        window.dispatchEvent(new CustomEvent(FOCUS_ACTIVE_TERMINAL_EVENT));
        return !!activeTab?.sessionId;
      };
      return {
        launchShell: () => launchHere('shell'),
        // ⌘N — browse for a directory and open it as a new Project: the native
        // picker, then a shell in the chosen dir (which registers the Project).
        newProject: () => {
          const dialog = window.electron?.dialog;
          if (!dialog) return false;
          void (async () => {
            const dir = await dialog.openDirectory();
            if (dir) await launch({ harness: 'shell', dir });
          })();
          return true;
        },
        closeActive: () => {
          if (!activeTab) return false;
          void closeTab(activeTab.id);
          return true;
        },
        toggleOverview: () => {
          // derive open-state from the URL at gesture time (D10): a toggle
          // issued during the open/close transition must close the overview,
          // not re-open it from a stale state closure
          const openNow =
            new URLSearchParams(window.location.search).get('view') ===
            'sessions';
          updateOverview(!openNow);
          return true;
        },
        selectIndex: selectProject,
        cycle: cycleTab,
        jumpAttention,
        toggleRegime: () => {
          navigateCommandSurface(spatialReturnHref());
          return true;
        },
        openPalette: () => {
          openCommandPalette();
          return true;
        },
        openHelp: () => {
          openHelpModal();
          return true;
        },
        focusTerminal,
        toggleFocus: () => {
          const inTerminal = !!document.activeElement?.closest(
            '.xterm-helper-textarea'
          );
          if (!inTerminal) return focusTerminal();
          const target = chromeRef.current?.querySelector<HTMLElement>(
            'button:not([disabled]), input:not([disabled])'
          );
          target?.focus();
          return !!target;
        },
        togglePin,
        // ⌘B three-state cycle: collapsed → open+focused → (already focused)
        // collapse and hand the keyboard back to the terminal
        toggleRoadmap: () => {
          const railFocused = !!document.activeElement?.closest(
            '[data-roadmap-rail]'
          );
          if (railMode !== 'open') {
            updateRailMode('open');
            requestAnimationFrame(() =>
              window.dispatchEvent(new CustomEvent(ROADMAP_RAIL_FOCUS_EVENT))
            );
          } else if (!railFocused) {
            window.dispatchEvent(new CustomEvent(ROADMAP_RAIL_FOCUS_EVENT));
          } else {
            updateRailMode('strip');
            window.dispatchEvent(new CustomEvent(FOCUS_ACTIVE_TERMINAL_EVENT));
          }
          return true;
        },
        renameActive: () => {
          if (!activeTab) return false;
          window.dispatchEvent(new CustomEvent(RENAME_ACTIVE_EVENT));
          return true;
        },
      };
    },
    [
      activeTab,
      railMode,
      updateRailMode,
      launch,
      launchHere,
      closeTab,
      selectProject,
      cycleTab,
      jumpAttention,
      togglePin,
      navigateCommandSurface,
      openCommandPalette,
      openHelpModal,
      updateOverview,
    ]
  );
  useWorkspaceShortcuts(shortcutActions, inElectron);

  if (!mounted) return null;

  if (!inElectron) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div
          className="max-w-md rounded border p-6 text-center"
          style={{
            borderColor: 'rgba(80,230,255,0.25)',
            background: 'rgba(7,12,20,0.9)',
          }}
        >
          <p
            className="font-display text-lg font-semibold"
            style={{ color: HUD.text }}
          >
            Terminal Workspace
          </p>
          <p className="mt-2 font-mono text-sm" style={{ color: HUD.textDim }}>
            Live terminal sessions run in the Exawatt desktop app. Launch it
            with <span style={{ color: HUD.textMono }}>pnpm electron:dev</span>.
          </p>
        </div>
      </div>
    );
  }

  const allTabs = projects.flatMap(g =>
    g.tabs.map(t => ({ tab: t, dir: g.dir }))
  );

  // split view (S2): the pinned tab renders RIGHT beside a companion tab
  // LEFT. The companion is the last active non-pinned tab — so clicking
  // into the pinned pane (active = pinned) moves the KEYBOARD there but
  // keeps both panes up; a click must never collapse the split (you could
  // not even copy text out of the watched pane otherwise).
  const pinnedEntry =
    pinnedTabId !== null
      ? (allTabs.find(
          e =>
            e.tab.id === pinnedTabId &&
            e.tab.sessionId &&
            tabIsLive(e.tab)
        ) ?? null)
      : null;
  if (activeTab && activeTab.sessionId && activeTab.id !== pinnedTabId) {
    companionRef.current = activeTab.id;
  }
  const companionEntry = pinnedEntry
    ? (allTabs.find(
        e =>
          e.tab.id === companionRef.current &&
          e.tab.sessionId &&
          tabIsLive(e.tab)
      ) ?? null)
    : null;
  const split =
    !!pinnedEntry &&
    !!companionEntry &&
    companionEntry.tab.id !== pinnedEntry.tab.id;
  const layoutFor = (tabId: string): PaneLayout => {
    if (split) {
      if (tabId === companionEntry.tab.id) return 'left';
      if (tabId === pinnedEntry.tab.id) return 'right';
      return 'hidden';
    }
    return tabId === activeTab?.id ? 'full' : 'hidden';
  };

  return (
    <div
      className="relative flex h-full flex-col"
      style={{ background: HUD.bg.void }}
    >
      <div
        data-workspace-underlay
        inert={overviewOpen}
        aria-hidden={overviewOpen || undefined}
        className="flex min-h-0 flex-1 flex-col"
      >
      {/* project groups + tabs + launch controls */}
      <div
        ref={chromeRef}
        data-workspace-chrome
        className="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2"
        style={{
          borderColor: 'rgba(80,230,255,0.15)',
          background: HUD.bg.deep,
        }}
      >
        <TabStrip
          projects={projects}
          activeDir={activeProject?.dir ?? null}
          pinnedTabId={pinnedTabId}
          summaries={summaries}
          attention={attention}
          onSelectProject={selectProject}
          onSelectTab={selectTab}
          onCloseTab={id => void closeTab(id)}
          onRenameTab={renameTab}
          onRenameProject={renameProject}
          onSetProjectColor={setProjectColor}
        />
        <LaunchControls
          prefillDir={activeProject?.dir ?? lastUsedDir}
          roadmapItems={launchRoadmapItems}
          onLaunch={launch}
        />
        <button
          type="button"
          aria-label={
            notificationsEnabled
              ? 'Disable attention notifications'
              : 'Enable attention notifications'
          }
          aria-pressed={notificationsEnabled}
          title={
            notificationsEnabled
              ? 'Attention notifications enabled'
              : 'Attention notifications disabled'
          }
          onClick={toggleNotifications}
          className="grid h-7 w-7 shrink-0 place-items-center rounded border outline-none hover:bg-white/10 focus-visible:ring-1 focus-visible:ring-hud-cyan"
          style={{
            color: notificationsEnabled ? HUD.amber : HUD.textDim,
            borderColor: notificationsEnabled
              ? 'rgba(255,184,77,0.42)'
              : 'rgba(80,230,255,0.2)',
          }}
        >
          {notificationsEnabled ? (
            <Bell className="h-3.5 w-3.5" />
          ) : (
            <BellOff className="h-3.5 w-3.5" />
          )}
        </button>
      </div>

      {readyAgentCount > 0 && !resumeNoticeDismissed && (
        <div
          role="status"
          className="flex shrink-0 items-center gap-2 border-b px-3 py-1.5 font-mono text-xs"
          style={{
            borderColor: 'rgba(25,230,255,0.18)',
            background: 'rgba(25,230,255,0.06)',
            color: HUD.textDim,
          }}
        >
          <span className="min-w-0 flex-1">
            {readyAgentCount} {readyAgentCount === 1 ? 'agent is' : 'agents are'} ready to resume
          </span>
          <button
            type="button"
            onClick={resumeAll}
            className="inline-flex h-7 items-center gap-1.5 border px-2 outline-none hover:bg-white/10 focus-visible:ring-1 focus-visible:ring-hud-cyan"
            style={{ borderColor: 'rgba(25,230,255,0.3)', color: HUD.text }}
          >
            <Play className="h-3.5 w-3.5" />
            Resume All
          </button>
          <button
            type="button"
            aria-label="Dismiss resume notice"
            title="Dismiss"
            onClick={() => setResumeNoticeDismissed(true)}
            className="grid h-7 w-7 place-items-center outline-none hover:bg-white/10 focus-visible:ring-1 focus-visible:ring-hud-cyan"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* middle band: [context bar + errors + stage] beside the roadmap
          rail (ENG-017). The stage width changes ONCE when the rail mode
          flips (single xterm fit) — only rail CONTENTS animate, per the
          ENG-015 S3 reflow rule. On narrow windows the rail overlays. */}
      <div className="relative flex min-h-0 flex-1">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {activeTab && (
        <div
          data-active-session-context
          className="flex min-h-9 shrink-0 items-center gap-2 border-b px-3 py-1.5"
          style={{
            borderColor: 'rgba(80,230,255,0.1)',
            background: 'rgba(8,13,22,0.92)',
          }}
        >
          <FolderOpen className="h-3.5 w-3.5 shrink-0" style={{ color: HUD.textDim }} />
          <span
            className="min-w-0 shrink truncate font-mono text-[11px]"
            title={activeTab.cwd}
            tabIndex={0}
            style={{ color: HUD.textMono }}
          >
            {middleTruncatePath(activeTab.cwd)}
          </span>
          {activeItemChip && (
            <button
              type="button"
              title={`working on ${activeItemChip.item.title} — open in roadmap`}
              onClick={() => {
                updateRailMode('open');
                requestAnimationFrame(() =>
                  window.dispatchEvent(
                    new CustomEvent(ROADMAP_DRILL_EVENT, {
                      detail: activeItemChip.item.id,
                    })
                  )
                );
              }}
              className="shrink-0 rounded border px-1.5 py-px font-mono text-[10px] outline-none hover:bg-white/10 focus-visible:ring-1 focus-visible:ring-hud-cyan"
              style={{
                color: activeProject?.color ?? HUD.textMono,
                borderColor: `${activeProject?.color ?? HUD.cyan}55`,
                borderStyle:
                  activeItemChip.chip.method === 'inferred' ? 'dashed' : 'solid',
              }}
            >
              {activeItemChip.item.declaredId ?? activeItemChip.item.title}
            </button>
          )}
          {activeTab.sessionId && summaries[activeTab.sessionId] && (
            <span
              className="line-clamp-2 min-w-0 flex-1 border-l pl-3 text-sm leading-5"
              style={{
                color: HUD.textDim,
                borderColor: 'rgba(138,160,190,0.18)',
              }}
            >
              {summaries[activeTab.sessionId]}
            </span>
          )}
          <button
            type="button"
            aria-label="Focus active terminal"
            title="Focus active terminal"
            onClick={() =>
              window.dispatchEvent(new CustomEvent(FOCUS_ACTIVE_TERMINAL_EVENT))
            }
            className="grid h-7 w-7 shrink-0 place-items-center rounded outline-none hover:bg-white/10 focus-visible:ring-1 focus-visible:ring-hud-cyan"
            style={{ color: HUD.textDim }}
          >
            <SquareTerminal className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* launch errors (missing/bad dir, worktree or spawn failures) */}
      {error && (
        <div
          role="alert"
          className="flex shrink-0 items-center justify-between gap-3 border-b px-3 py-1.5 font-mono text-xs"
          style={{
            color: HUD.red,
            borderColor: 'rgba(255,31,75,0.35)',
            background: 'rgba(255,31,75,0.08)',
          }}
        >
          <span>{error}</span>
          <button
            onClick={() => setError(null)}
            aria-label="Dismiss error"
            className="px-1 outline-none focus-visible:ring-1 focus-visible:ring-hud-red"
          >
            ×
          </button>
        </div>
      )}

      {/* panes: ALL tabs stay mounted (sessions keep streaming across
          project switches); exactly one is visible (two in a split).
          Terminals are born with the EFFECTIVE font, so rendering waits for
          settings.json to resolve (one local IPC) */}
      <div
        ref={panesRef}
        data-workspace-stage
        className={`relative min-h-0 flex-1 origin-center transition-[transform,opacity] duration-300 [transition-timing-function:cubic-bezier(0.16,1,0.3,1)] motion-reduce:scale-100 motion-reduce:transition-opacity ${
          overviewOpen ? 'scale-[0.975] opacity-35' : ''
        }`}
      >
        {reentryRecap && activeTab?.sessionId === reentryRecap.id && (
          <ReentryRecapCard
            recap={reentryRecap}
            title={activeTab.title}
            context={summaries[reentryRecap.id]}
            onDismiss={dismissReentryRecap}
          />
        )}
        {allTabs.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-4">
            <p className="font-mono text-sm" style={{ color: HUD.textDim }}>
              Pick a project directory, then launch an agent or a shell.
            </p>
            <div
              className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 font-mono text-xs"
              style={{ color: HUD.textDim }}
            >
              {KEY_HINTS.map(hint => (
                <WorkspaceKeyHint key={hint.shortcutId} {...hint} roomy />
              ))}
            </div>
          </div>
        ) : font === null ? null : (
          allTabs.map(({ tab, dir }) =>
            tab.sessionId ? (
              <TerminalPane
                key={tab.sessionId}
                sessionId={tab.sessionId}
                cwd={tab.cwd}
                active={tab.id === activeTab?.id}
                layout={layoutFor(tab.id)}
                font={font}
                onActivate={() => selectTab(dir, tab.id)}
              />
            ) : tab.id === activeTab?.id && activeProject ? (
              <div
                key={tab.id}
                className="absolute inset-0"
              >
                {tab.resumeState === 'resuming' ? (
                  <p
                    className="absolute inset-0 flex items-center justify-center text-sm"
                    style={{ color: HUD.textDim }}
                  >
                    Starting a new process for the saved conversation...
                  </p>
                ) : (
                  <>
                    <RetainedTerminalPane
                      durableSessionId={tab.durableSessionId}
                      title={tab.title}
                      font={font}
                    />
                    <SessionRestorePanel
                      tab={tab}
                      project={activeProject}
                      resumableCount={readyAgentCount}
                      onResumeTab={resumeTab}
                      onResumeProject={resumeProject}
                      onResumeAll={resumeAll}
                    />
                  </>
                )}
              </div>
            ) : null
          )
        )}
      </div>
        </div>

        <RoadmapRail
          view={roadmapView}
          projectDir={activeProject?.dir ?? null}
          projectName={activeProject?.name ?? null}
          projectColor={activeProject?.color ?? null}
          mode={railMode}
          onModeChange={updateRailMode}
          onSelectSession={tabId => {
            if (activeProject) selectTab(activeProject.dir, tabId);
            requestAnimationFrame(() =>
              window.dispatchEvent(new CustomEvent(FOCUS_ACTIVE_TERMINAL_EVENT))
            );
          }}
          overlay={railMode === 'open' && !railDocks}
        />
      </div>

      {/* discoverability (S3): the workspace SHOWS its keys — same pattern
          as the spatial map's bottom legend */}
      <div
        data-key-hints
        className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-t px-3 py-1 font-mono text-[10px]"
        style={{
          color: HUD.textDim,
          borderColor: 'rgba(80,230,255,0.12)',
          background: HUD.bg.deep,
        }}
      >
        {KEY_HINTS.map(hint => (
          <WorkspaceKeyHint key={hint.shortcutId} {...hint} />
        ))}
      </div>
      </div>

      {/* Mission Control-style Sessions overview. The obscured workspace
          underlay is inert; shell-level navigation remains reachable. */}
      {overviewOpen && (
        <ExposeOverlay
          projects={projects}
          summaries={summaries}
          attention={attention}
          activeTabId={activeTab?.id ?? null}
          onPick={(dir, tabId) => {
            selectTab(dir, tabId);
            closeOverview();
          }}
          onClose={closeOverview}
        />
      )}
    </div>
  );
}
