'use client';

/**
 * Agent Terminal Workspace (ENG-002) — orchestration surface.
 *
 * W0.2 model: ONE window; initiatives are directory-keyed groups inside it
 * (⌘1..9 switches initiative, ⌘⇧[/] rotates the global tab ring across projects, ⌘T ignites a
 * shell in the active initiative). Layout persists across app restarts and
 * dead agent tabs auto-revive (claude --continue / codex resume --last).
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
import { IgniteControls } from './ignite-controls';
import { ExposeOverlay } from './expose-overlay';
import { ReentryRecapCard } from './reentry-recap';
import { useWorkspaceState, REVIVE_FAILED } from './use-workspace-state';
import { useWorkspaceShortcuts } from './use-workspace-shortcuts';
import {
  RENAME_ACTIVE_EVENT,
  CLOSE_ACTIVE_EVENT,
  OPEN_OVERVIEW_EVENT,
  FOCUS_ACTIVE_TERMINAL_EVENT,
} from './session-jump';
import { useShortcuts } from '@/components/shortcuts';
import { HUD } from '@/components/hud';

/** the discoverability layer (S3): the workspace SHOWS its keys, exactly
 *  like the spatial map's bottom legend — normal case, dim, always there */
const KEY_HINTS: Array<[string, string]> = [
  ['⌘K', 'sessions'],
  ['⌘O', 'overview'],
  ['⌘T', 'shell'],
  ['⌘D', 'split'],
  ['⌘J', 'needs you'],
  ['⌘E', 'rename'],
  ['⌘⇧M', 'spatial'],
  ['⌘/', 'all keys'],
];

export function WorkspaceClient() {
  // SSR renders neither branch; the electron check runs after mount so the
  // server and client HTML always match (hydration safety)
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const inElectron = mounted && !!window.electron?.pty;

  const panesRef = useRef<HTMLDivElement>(null);
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
    const offSettings = window.electron?.settings?.onChanged?.(settings => {
      apply(Promise.resolve(acceptTerminalSettings(settings)));
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
    initiatives,
    activeInitiative,
    activeTab,
    pinnedTabId,
    lastUsedDir,
    summaries,
    attention,
    reentryRecap,
    error,
    setError,
    dismissReentryRecap,
    ignite,
    igniteHere,
    closeTab,
    selectInitiative,
    selectTab,
    cycleTab,
    jumpAttention,
    togglePin,
    renameTab,
    renameInitiative,
    setInitiativeColor,
  } = useWorkspaceState({ getInitialSize });

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
      const g = initiatives.find(x => x.tabs.some(t => t.id === activeTab?.id));
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
  }, [initiatives, activeTab, closeTab, updateOverview]);

  const shortcutActions = useMemo(
    () => ({
      igniteShell: () => igniteHere('shell'),
      closeActive: () => {
        if (!activeTab) return false;
        void closeTab(activeTab.id);
        return true;
      },
      toggleOverview: () => {
        updateOverview(!overviewOpen);
        return true;
      },
      selectIndex: selectInitiative,
      cycle: cycleTab,
      jumpAttention,
      // regime switching is a two-way street: ⌘⇧M here goes to the map, the
      // same chord anywhere else comes back (global shortcut, defaults.ts)
      toggleRegime: () => {
        router.push('/fleet/spatial');
        return true;
      },
      // ⌘K/⌘/ re-bound here because the global chord engine never sees
      // keystrokes from inside xterm's hidden textarea
      openPalette: () => {
        openCommandPalette();
        return true;
      },
      openHelp: () => {
        openHelpModal();
        return true;
      },
      togglePin,
      renameActive: () => {
        if (!activeTab) return false;
        window.dispatchEvent(new CustomEvent(RENAME_ACTIVE_EVENT));
        return true;
      },
    }),
    [
      activeTab,
      overviewOpen,
      igniteHere,
      closeTab,
      selectInitiative,
      cycleTab,
      jumpAttention,
      togglePin,
      router,
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

  const allTabs = initiatives.flatMap(g =>
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
            e.tab.exitCode === null
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
          e.tab.exitCode === null
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
      {/* initiative groups + tabs + ignite controls */}
      <div
        className="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2"
        style={{
          borderColor: 'rgba(80,230,255,0.15)',
          background: HUD.bg.deep,
        }}
      >
        <TabStrip
          initiatives={initiatives}
          activeDir={activeInitiative?.dir ?? null}
          pinnedTabId={pinnedTabId}
          summaries={summaries}
          attention={attention}
          onSelectInitiative={selectInitiative}
          onSelectTab={selectTab}
          onCloseTab={id => void closeTab(id)}
          onRenameTab={renameTab}
          onRenameInitiative={renameInitiative}
          onSetInitiativeColor={setInitiativeColor}
        />
        <IgniteControls
          prefillDir={activeInitiative?.dir ?? lastUsedDir}
          onIgnite={ignite}
        />
      </div>

      {/* ignite errors (missing/bad dir, worktree or spawn failures) */}
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
          initiative switches); exactly one is visible (two in a split).
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
              {KEY_HINTS.map(([keys, label]) => (
                <span key={keys} className="flex items-center gap-1.5">
                  <kbd
                    className="rounded border px-1 py-0.5 text-[10px]"
                    style={{
                      borderColor: 'rgba(80,230,255,0.3)',
                      color: HUD.textMono,
                    }}
                  >
                    {keys}
                  </kbd>
                  {label}
                </span>
              ))}
            </div>
          </div>
        ) : font === null ? null : (
          allTabs.map(({ tab, dir }) =>
            tab.sessionId ? (
              <TerminalPane
                key={tab.sessionId}
                sessionId={tab.sessionId}
                active={tab.id === activeTab?.id}
                layout={layoutFor(tab.id)}
                font={font}
                onActivate={() => selectTab(dir, tab.id)}
              />
            ) : (
              <div
                key={tab.id}
                className={`absolute inset-0 flex items-center justify-center ${
                  tab.id === activeTab?.id ? '' : 'invisible'
                }`}
              >
                <p className="font-mono text-sm" style={{ color: HUD.textDim }}>
                  {tab.exitCode === REVIVE_FAILED
                    ? 'Revive failed — close this tab and launch again.'
                    : 'Reviving session…'}
                </p>
              </div>
            )
          )
        )}
      </div>

      {/* exposé overview (S3): ⌘O — every session as a glanceable tile.
          Mounted at the ROOT so it truly covers the workspace: the tab
          strip and launch controls must not stay interactive underneath a
          modal (clicking them would drive invisible terminals) */}
      {overviewOpen && (
        <ExposeOverlay
          initiatives={initiatives}
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
        {KEY_HINTS.map(([keys, label]) => (
          <span key={keys} className="flex items-center gap-1">
            <kbd
              className="rounded border px-1 leading-4"
              style={{
                borderColor: 'rgba(80,230,255,0.25)',
                color: HUD.textMono,
              }}
            >
              {keys}
            </kbd>
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}
