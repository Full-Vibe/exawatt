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
 * The tab strip is TRANSITIONAL — the end state is sessions as visual
 * entities on the ENG-004 world map (see docs/product/operator-workflow.md).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { TerminalPane, TERMINAL_FONT } from './terminal-pane';
import { TabStrip } from './tab-strip';
import { IgniteControls } from './ignite-controls';
import { useWorkspaceState, REVIVE_FAILED } from './use-workspace-state';
import { useWorkspaceShortcuts } from './use-workspace-shortcuts';
import { HUD } from '@/components/hud';

// derive the spawn-size estimate from the terminal's own font config —
// new sessions spawn at (approximately) their final size so TUIs never
// init at 80 cols; the pane's post-attach wiggle-resync covers any drift
const CELL_W = TERMINAL_FONT.cellWidthEstimate;
const CELL_H = TERMINAL_FONT.size * TERMINAL_FONT.lineHeight;

export function WorkspaceClient() {
  // SSR renders neither branch; the electron check runs after mount so the
  // server and client HTML always match (hydration safety)
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const inElectron = mounted && !!window.electron?.pty;

  const panesRef = useRef<HTMLDivElement>(null);
  const getInitialSize = useCallback(() => {
    const el = panesRef.current;
    if (!el || el.offsetWidth === 0 || el.offsetHeight === 0) return null;
    return {
      cols: Math.min(500, Math.max(20, Math.floor(el.offsetWidth / CELL_W))),
      rows: Math.min(200, Math.max(10, Math.floor(el.offsetHeight / CELL_H))),
    };
  }, []);

  const {
    initiatives,
    activeInitiative,
    activeTab,
    lastUsedDir,
    error,
    setError,
    ignite,
    closeTab,
    selectInitiative,
    selectTab,
    cycleTab,
  } = useWorkspaceState({ getInitialSize });

  const shortcutActions = useMemo(
    () => ({
      igniteShell: () => {
        const dir = activeInitiative?.dir ?? lastUsedDir;
        if (!dir) {
          setError('Project directory is required — pick where this session lives.');
          return false;
        }
        void ignite({ harness: 'shell', dir });
        return true;
      },
      closeActive: () => {
        if (!activeTab) return false;
        void closeTab(activeTab.id);
        return true;
      },
      selectIndex: selectInitiative,
      cycle: cycleTab,
    }),
    [activeInitiative, activeTab, lastUsedDir, ignite, closeTab, selectInitiative, cycleTab, setError]
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
          <p className="font-display text-lg font-semibold" style={{ color: HUD.text }}>
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

  const allTabs = initiatives.flatMap((g) =>
    g.tabs.map((t) => ({ tab: t, dir: g.dir }))
  );

  return (
    <div className="flex h-full flex-col" style={{ background: HUD.bg.void }}>
      {/* initiative groups + tabs + ignite controls */}
      <div
        className="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2"
        style={{ borderColor: 'rgba(80,230,255,0.15)', background: HUD.bg.deep }}
      >
        <TabStrip
          initiatives={initiatives}
          activeDir={activeInitiative?.dir ?? null}
          onSelectInitiative={selectInitiative}
          onSelectTab={selectTab}
          onCloseTab={(id) => void closeTab(id)}
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
          initiative switches); exactly one is visible */}
      <div ref={panesRef} className="relative min-h-0 flex-1">
        {allTabs.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <p className="font-mono text-sm" style={{ color: HUD.textDim }}>
              Pick a project directory and ignite an agent — ⌘T for a shell.
            </p>
          </div>
        ) : (
          allTabs.map(({ tab }) =>
            tab.sessionId ? (
              <TerminalPane
                key={tab.sessionId}
                sessionId={tab.sessionId}
                active={tab.id === activeTab?.id}
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
                    ? 'Revive failed — close this tab and ignite again.'
                    : 'Reviving session…'}
                </p>
              </div>
            )
          )
        )}
      </div>
    </div>
  );
}
