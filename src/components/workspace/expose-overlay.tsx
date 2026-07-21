// No 'use client' directive: only imported by the client workspace surface.

/**
 * Exposé overview (ENG-015 S3): ⌘⇧2 fans every live session out as a rich
 * tile — project color, harness mark, title, micro-context, needs-you
 * pulse, and the last lines of scrollback — so "where is everything?"
 * answers itself in one glance. Fully keyboard-driven: arrows move,
 * Enter/click drops into the session, Escape closes. DOM-rendered per the
 * decision `0003` hybrid rule; motion respects prefers-reduced-motion.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { HUD } from '@/components/hud';
import { FOCUS_SESSIONS_EVENT } from '@/components/nav/command-altitude-events';
import { HarnessGlyph } from './harness-icons';
import { isDefaultHarnessTitle } from './harnesses';
import { previewLines } from './scrollback-preview';
import { tabIsLive } from './use-workspace-state';
import type { Project } from './use-workspace-state';
import type { PtyHarness } from '@/types/electron';
import {
  RoadmapRail,
  ROADMAP_RAIL_FOCUS_EVENT,
  hasRoadmapRailSummon,
} from '@/components/roadmap/roadmap-rail';
import {
  useProjectRoadmap,
  type RoadmapSessionDescriptor,
} from '@/components/roadmap/use-project-roadmap';

interface Tile {
  /** null when the tab has no process (restored, not resumed) */
  sessionId: string | null;
  tabId: string;
  dir: string;
  harness: PtyHarness;
  title: string;
  projectName: string;
  color: string;
  /** running/resumed process behind the tab */
  live: boolean;
  /** short state word for non-live tabs ("stopped", "interrupted", …) */
  stateLabel: string | null;
}

interface EmptyProjectItem {
  sessionId: null;
  tabId: null;
  dir: string;
  projectName: string;
  color: string;
}

type SelectionItem = Tile | EmptyProjectItem;

function selectionKey(item: SelectionItem): string {
  return item.tabId ?? `project:${item.dir}`;
}

/** ENG-018 lifecycle → tile state word (overview shows EVERY tab, live or
 *  not — a stopped agent is still a session the operator owns) */
const TILE_STATE_LABEL: Record<string, string> = {
  'stopped-clean': 'stopped',
  interrupted: 'interrupted',
  exited: 'exited',
  resuming: 'resuming…',
  failed: 'failed',
};

const TILE_W = 300; // px — column math for ↑/↓ derives from this

export function ExposeOverlay({
  projects,
  summaries,
  attention,
  activity = {},
  roadmapByTab = {},
  activeTabId,
  activeProjectDir = null,
  onPick,
  onPickProject = () => {},
  onClose,
}: {
  projects: Project[];
  summaries: Record<string, string>;
  /** presence-only (S8 merges roadmap-derived entries) */
  attention: Record<string, { since: number }>;
  /** sessions actively producing output, keyed by sessionId (D18) */
  activity?: Record<string, boolean>;
  /** tabId → linked roadmap item (ENG-017 S9 mirror): the exposé is an
   *  AGENT-FIRST view, so each tile says what its agent is executing */
  roadmapByTab?: Record<
    string,
    { label: string; fraction: string | null; inferred: boolean }
  >;
  /** selection starts on the session the operator came from */
  activeTabId: string | null;
  /** selects an empty Project when there is no originating Session */
  activeProjectDir?: string | null;
  onPick: (dir: string, tabId: string) => void;
  onPickProject?: (dir: string) => void;
  onClose: () => void;
}) {
  // stable order = model order (spatial memory: tiles never reshuffle)
  const tiles = useMemo<Tile[]>(
    () =>
      projects.flatMap(g =>
        g.tabs.map(t => {
          const live = tabIsLive(t) && !!t.sessionId && t.exitCode === null;
          return {
            sessionId: t.sessionId,
            tabId: t.id,
            dir: g.dir,
            harness: t.harness,
            title: t.title,
            projectName: g.name,
            color: g.color,
            live,
            stateLabel: live
              ? null
              : (TILE_STATE_LABEL[t.lifecycle] ??
                (t.exitCode !== null ? 'exited' : 'stopped')),
          };
        })
      ),
    [projects]
  );
  const items = useMemo<SelectionItem[]>(
    () =>
      projects.flatMap<SelectionItem>(project => {
        const projectTiles = tiles.filter(tile => tile.dir === project.dir);
        return projectTiles.length > 0
          ? projectTiles
          : [
              {
                sessionId: null,
                tabId: null,
                dir: project.dir,
                projectName: project.name,
                color: project.color,
              } satisfies EmptyProjectItem,
            ];
      }),
    [projects, tiles]
  );

  // start where the operator was — ⌘⇧2 then Enter must be a no-op return,
  // never a jump to whatever happens to be tile 0
  const [sel, setSel] = useState(() => {
    const i = items.findIndex(item =>
      activeTabId
        ? item.tabId === activeTabId
        : item.tabId === null && item.dir === activeProjectDir
    );
    return i === -1 ? 0 : i;
  });
  const [previews, setPreviews] = useState<Record<string, string[]>>({});
  const [entered, setEntered] = useState(false);
  // Chromium re-dispatches synthetic mouse events when content appears under
  // a STATIONARY cursor — without this arm window, wherever the mouse
  // happened to rest would steal the roving selection the moment the
  // overview (or a re-scoped rail) mounted. Selection follows the mouse only
  // after the entrance settles.
  const mouseArmAtRef = useRef(
    (typeof performance !== 'undefined' ? performance.now() : 0) + 400
  );
  const mouseArmed = () =>
    typeof performance === 'undefined' ||
    performance.now() > mouseArmAtRef.current;
  const rootRef = useRef<HTMLDivElement>(null);
  const tileRefs = useRef(new Map<string, HTMLButtonElement>());
  const selectedIndexRef = useRef(sel);
  selectedIndexRef.current = sel;

  const focusSelection = useCallback(
    (index = selectedIndexRef.current) => {
      const item = items[index];
      if (item) {
        const node = tileRefs.current.get(selectionKey(item));
        node?.focus({ preventScroll: true });
        node?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
      } else {
        rootRef.current?.focus({ preventScroll: true });
      }
    },
    [items]
  );

  // ── Roadmap home (ENG-017 S12) ───────────────────────────────────────
  // Sessions is the zoomed-out altitude, so the Project roadmap lives HERE:
  // a permanent rail scoped to the SELECTED Project — roving across tiles
  // re-scopes the plan. Docked beside the grid when the window affords it;
  // summoned as a drawer (⌘B) when it doesn't.
  const [railDocks, setRailDocks] = useState(true);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return; // jsdom
    const mq = window.matchMedia('(min-width: 1100px)');
    const apply = () => setRailDocks(mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);
  const [railSummoned, setRailSummoned] = useState(() =>
    hasRoadmapRailSummon()
  );
  useEffect(() => {
    const summon = () => setRailSummoned(true);
    window.addEventListener(ROADMAP_RAIL_FOCUS_EVENT, summon);
    return () => window.removeEventListener(ROADMAP_RAIL_FOCUS_EVENT, summon);
  }, []);
  const railVisible = projects.length > 0 && (railDocks || railSummoned);

  const selectedDir = items[sel]?.dir ?? activeProjectDir ?? null;
  const selectedProject = projects.find(p => p.dir === selectedDir) ?? null;
  const roadmapSessions = useMemo<RoadmapSessionDescriptor[]>(
    () =>
      (selectedProject?.tabs ?? [])
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
    [selectedProject, summaries, attention]
  );
  const declaredLinks = useMemo(
    () =>
      (selectedProject?.tabs ?? [])
        .filter(t => t.roadmapItemId && t.sessionId && tabIsLive(t))
        .map(t => ({
          sessionId: t.sessionId as string,
          tabId: t.id,
          projectDir: selectedProject?.dir ?? '',
          itemId: t.roadmapItemId as string,
          method: 'declared' as const,
          confidence: 'high' as const,
          evidence: [
            { kind: 'declared' as const, excerpt: 'declared at launch' },
          ],
          evaluatedAt: 0,
        })),
    [selectedProject]
  );
  const { view: roadmapView } = useProjectRoadmap(
    railVisible ? selectedDir : null,
    roadmapSessions,
    declaredLinks
  );
  const exitRailFocus = useCallback(() => {
    if (!railDocks) setRailSummoned(false);
    focusSelection();
  }, [railDocks, focusSelection]);

  // tiles can shrink while open (a session exits) — selection stays in range.
  // Refocus only when the clamp actually MOVES the selection: this effect
  // also fires on mount, where an unconditional focus stole the keyboard
  // from a summoned roadmap rail (S12).
  useEffect(() => {
    setSel(s => {
      const next = Math.min(s, Math.max(0, items.length - 1));
      if (next !== s) requestAnimationFrame(() => focusSelection(next));
      return next;
    });
  }, [focusSelection, items.length]);

  // The fixed tab-ring shortcuts remain live at Sessions altitude. Mirror an
  // active-tab change back into the overview's roving selection so ⌘⇧[/]
  // visibly moves here instead of only changing the inert underlay.
  useEffect(() => {
    const next = items.findIndex(item =>
      activeTabId
        ? item.tabId === activeTabId
        : item.tabId === null && item.dir === activeProjectDir
    );
    if (next === -1 || next === selectedIndexRef.current) return;
    setSel(next);
    requestAnimationFrame(() => focusSelection(next));
  }, [activeProjectDir, activeTabId, focusSelection, items]);

  // fetch scrollback for tiles we haven't covered yet (tiles can also GROW
  // while open, e.g. a tab finishing auto-revive)
  const fetchedRef = useRef(new Set<string>());
  const unmountedRef = useRef(false);
  useEffect(() => {
    unmountedRef.current = false; // strict-mode remount resets the latch
    return () => {
      unmountedRef.current = true;
    };
  }, []);
  useEffect(() => {
    const api = window.electron?.pty;
    if (!api) return;
    const missing = tiles.filter(
      (t): t is Tile & { sessionId: string } =>
        !!t.sessionId && !fetchedRef.current.has(t.sessionId)
    );
    if (missing.length === 0) return;
    for (const t of missing) fetchedRef.current.add(t.sessionId);
    void (async () => {
      const entries = await Promise.all(
        missing.map(async t => {
          const buf = await api.buffer(t.sessionId).catch(() => '');
          return [t.sessionId, previewLines(buf, 5, 90)] as const;
        })
      );
      // results are keyed by sessionId, so they stay valid across tile
      // re-renders — a per-effect cancel here silently dropped every batch
      // whose fetch outlived one workspace re-render, leaving tiles on "…"
      // forever (sessions were already marked fetched). Guard only unmount.
      if (!unmountedRef.current) {
        setPreviews(prev => ({ ...prev, ...Object.fromEntries(entries) }));
      }
    })();
  }, [tiles]);

  // take the keyboard away from xterm; entrance flag flips post-mount so
  // tiles transition in (staggered). When a roadmap summon is in flight the
  // rail owns first focus (S12) — the entrance must not steal it back.
  const railSummonedAtMountRef = useRef(hasRoadmapRailSummon());
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      setEntered(true);
      if (!railSummonedAtMountRef.current) focusSelection();
    });
    return () => cancelAnimationFrame(raf);
  }, [focusSelection]);

  useEffect(() => {
    const focus = () => focusSelection();
    window.addEventListener(FOCUS_SESSIONS_EVENT, focus);
    return () => window.removeEventListener(FOCUS_SESSIONS_EVENT, focus);
  }, [focusSelection]);

  useEffect(() => {
    const closeFromShellChrome = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.key !== 'Escape') return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (rootRef.current?.contains(target)) return;
      if (
        target.closest('[role="dialog"], [cmdk-root], .xterm-helper-textarea')
      ) {
        return;
      }
      event.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', closeFromShellChrome, true);
    return () =>
      window.removeEventListener('keydown', closeFromShellChrome, true);
  }, [onClose]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    // keys born inside the roadmap rail belong to it (it stops propagation
    // for everything it handles; the rest must not move tile selection)
    if (
      e.target instanceof Element &&
      e.target.closest('[data-roadmap-rail]')
    ) {
      return;
    }
    if (e.key === 'Escape' || (e.metaKey && e.key.toLowerCase() === 'o')) {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === 'Enter') {
      const item = items[sel];
      if (item) {
        e.preventDefault();
        if (item.tabId) onPick(item.dir, item.tabId);
        else onPickProject(item.dir);
      }
      return;
    }
    // arrows move the grid selection; plain j/k mirror down/up (D9 — the
    // app's list-navigation vocabulary works here too). Modifier combos are
    // NOT movement: ⌘K must stay the palette, ⌘J the attention jump.
    const plainKey = !e.metaKey && !e.ctrlKey && !e.altKey;
    const delta =
      e.key === 'ArrowRight' ||
      e.key === 'ArrowDown' ||
      (plainKey && e.key === 'j')
        ? 1
        : e.key === 'ArrowLeft' ||
            e.key === 'ArrowUp' ||
            (plainKey && e.key === 'k')
          ? -1
          : 0;
    if (delta !== 0 && items.length > 0) {
      e.preventDefault();
      setSel(s => {
        const next = Math.min(items.length - 1, Math.max(0, s + delta));
        requestAnimationFrame(() => focusSelection(next));
        return next;
      });
    }
  };

  const sessionTile = (tile: Tile) => {
    const index = items.findIndex(item => item.tabId === tile.tabId);
    const selected = index === sel;
    const needsYou = !!(tile.sessionId && attention[tile.sessionId]);
    const working = !!(tile.sessionId && activity[tile.sessionId]);
    const subtitle = tile.sessionId ? summaries[tile.sessionId] : undefined;
    return (
      <button
        key={tile.tabId}
        ref={node => {
          if (node) tileRefs.current.set(tile.tabId, node);
          else tileRefs.current.delete(tile.tabId);
        }}
        data-expose-tile
        data-expose-tab={tile.tabId}
        data-selected={selected || undefined}
        tabIndex={selected ? 0 : -1}
        aria-label={`${tile.title}, ${tile.projectName}${needsYou ? ', needs attention' : ''}${
          tile.live && !needsYou ? (working ? ', working' : ', quiet') : ''
        }${tile.stateLabel ? `, ${tile.stateLabel}` : ''}`}
        onClick={() => onPick(tile.dir, tile.tabId)}
        onMouseEnter={() => {
          if (mouseArmed()) setSel(index);
        }}
        onFocus={() => setSel(index)}
        className="flex flex-col gap-1.5 rounded border p-3 text-left outline-none transition-[opacity,transform,border-color,box-shadow] duration-200 motion-reduce:transition-none"
        style={{
          width: TILE_W,
          borderColor: selected ? tile.color : `${tile.color}44`,
          background: 'rgba(7,12,20,0.92)',
          boxShadow: selected ? `0 0 14px ${tile.color}55` : 'none',
          opacity: entered ? (tile.live ? 1 : 0.55) : 0,
          transform: entered
            ? selected
              ? 'scale(1.02)'
              : 'none'
            : 'translateY(10px) scale(0.97)',
          transitionDelay: entered ? `${Math.min(index * 18, 300)}ms` : '0ms',
        }}
      >
        <div className="flex w-full items-center gap-1.5 font-mono text-xs">
          <span
            className="inline-block h-2 w-2 shrink-0 rotate-45"
            style={{
              background: tile.color,
              boxShadow: `0 0 5px ${tile.color}`,
            }}
          />
          {tile.harness !== 'shell' && (
            <span style={{ color: tile.color }}>
              <HarnessGlyph harness={tile.harness} size={11} />
            </span>
          )}
          {/* an unrenamed harness title duplicates the glyph — with a goal
              subtitle below it, the tile header keeps only the glyph (D18
              follow-up); the accessible name retains the full title */}
          {!(subtitle && isDefaultHarnessTitle(tile.harness, tile.title)) && (
            <span className="truncate" style={{ color: HUD.text }}>
              {tile.title}
            </span>
          )}
          {tile.stateLabel && (
            <span
              data-expose-state={tile.stateLabel}
              className="ml-auto shrink-0 pl-1.5 font-mono text-[10px]"
              style={{ color: HUD.textDim }}
            >
              {tile.stateLabel}
            </span>
          )}
          {roadmapByTab[tile.tabId] && (
            <span
              data-expose-roadmap-item
              title={
                roadmapByTab[tile.tabId].inferred
                  ? 'inferred link'
                  : 'declared at launch'
              }
              className="max-w-[45%] shrink truncate pl-1.5 font-mono text-[10px]"
              style={{ color: HUD.textMono }}
            >
              {roadmapByTab[tile.tabId].inferred ? '▹' : '▸'}{' '}
              {roadmapByTab[tile.tabId].label}
              {roadmapByTab[tile.tabId].fraction
                ? ` ${roadmapByTab[tile.tabId].fraction}`
                : ''}
            </span>
          )}
          {needsYou ? (
            <span className="relative ml-1 inline-flex h-1.5 w-1.5 shrink-0">
              <span
                className="absolute inline-flex h-full w-full animate-ping rounded-full motion-reduce:animate-none"
                style={{ background: HUD.amber, opacity: 0.6 }}
              />
              <span
                className="relative inline-flex h-1.5 w-1.5 rounded-full"
                style={{ background: HUD.amber }}
              />
            </span>
          ) : tile.live ? (
            working ? (
              <span
                data-status="working"
                title="working — output streaming"
                className="ml-1 inline-flex h-1.5 w-1.5 shrink-0 rounded-full motion-safe:animate-pulse"
                style={{ background: HUD.cyan2, boxShadow: `0 0 4px ${HUD.cyan2}` }}
              />
            ) : (
              <span
                data-status="quiet"
                title="quiet — waiting or between turns"
                className="ml-1 inline-flex h-1.5 w-1.5 shrink-0 rounded-full border"
                style={{ borderColor: HUD.idle }}
              />
            )
          ) : null}
        </div>
        {subtitle && (
          <div
            className="line-clamp-2 min-h-10 w-full text-sm leading-5"
            style={{ color: `${tile.color}B0` }}
          >
            {subtitle}
          </div>
        )}
        <div
          className="w-full whitespace-pre font-mono text-[9px] leading-[1.5]"
          style={{ color: HUD.textDim, minHeight: 54, overflow: 'hidden' }}
        >
          {(tile.sessionId ? previews[tile.sessionId] : undefined)?.join(
            '\n'
          ) ?? (tile.live ? '…' : 'process ended — enter opens the tab')}
        </div>
      </button>
    );
  };

  return (
    <div
      ref={rootRef}
      role="region"
      aria-label="Session overview"
      data-expose
      tabIndex={-1}
      onKeyDown={onKeyDown}
      onMouseDown={event => {
        if (event.target === event.currentTarget) onClose();
      }}
      className="absolute inset-0 z-20 flex overflow-hidden outline-none transition-opacity duration-200 [transition-timing-function:cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none"
      style={{
        background: 'rgba(4,6,11,0.84)',
        backdropFilter: 'blur(6px)',
        opacity: entered ? 1 : 0,
      }}
    >
      <div
        className="min-w-0 flex-1 overflow-y-auto"
        onMouseDown={event => {
          if (event.target === event.currentTarget) onClose();
        }}
      >
      <div className="px-6 pb-6 pt-5">
        <div
          className="mb-4 flex items-baseline gap-3 font-mono text-xs"
          style={{ color: HUD.textDim }}
        >
          <h2
            className="font-display text-sm font-semibold"
            style={{ color: HUD.text }}
          >
            Projects &amp; Sessions
          </h2>
          <span>arrows or J/K move · enter opens · esc returns</span>
        </div>
        {projects.length === 0 && (
          <div
            className="flex min-h-48 max-w-lg flex-col justify-center gap-2 border-y py-8"
            style={{ borderColor: 'rgba(80,230,255,0.12)' }}
          >
            <p
              className="font-display text-base font-semibold"
              style={{ color: HUD.text }}
            >
              No Projects open
            </p>
            <p className="font-mono text-xs" style={{ color: HUD.textDim }}>
              Return to Terminal and open a Project.
            </p>
          </div>
        )}
        <div className="flex flex-col gap-5">
          {projects.map(project => {
            const projectTiles = tiles.filter(tile => tile.dir === project.dir);
            const emptyIndex = items.findIndex(
              item => item.tabId === null && item.dir === project.dir
            );
            const emptySelected = emptyIndex === sel;
            return (
              <section
                key={project.dir}
                data-expose-project={project.dir}
                aria-label={`${project.name}, ${projectTiles.length} Sessions`}
              >
                <div
                  className="mb-2 flex items-center gap-2 border-b pb-2"
                  style={{ borderColor: `${project.color}33` }}
                >
                  <span
                    className="h-2 w-2 shrink-0 rotate-45"
                    style={{ background: project.color }}
                  />
                  <h3
                    className="truncate font-display text-xs font-semibold"
                    style={{ color: HUD.text }}
                  >
                    {project.name}
                  </h3>
                  <span
                    className="font-mono text-[10px] tabular-nums"
                    style={{ color: HUD.textDim }}
                  >
                    {projectTiles.length}{' '}
                    {projectTiles.length === 1 ? 'Session' : 'Sessions'}
                  </span>
                </div>
                <div className="flex flex-wrap gap-3">
                  {projectTiles.length > 0 ? (
                    projectTiles.map(sessionTile)
                  ) : (
                    <button
                      ref={node => {
                        const key = `project:${project.dir}`;
                        if (node) tileRefs.current.set(key, node);
                        else tileRefs.current.delete(key);
                      }}
                      type="button"
                      data-expose-empty-project={project.dir}
                      data-selected={emptySelected || undefined}
                      tabIndex={emptySelected ? 0 : -1}
                      aria-label={`Open ${project.name} in Terminal, no Sessions yet`}
                      onClick={() => onPickProject(project.dir)}
                      onMouseEnter={() => {
                        if (mouseArmed()) setSel(emptyIndex);
                      }}
                      onFocus={() => setSel(emptyIndex)}
                      className="flex min-h-32 flex-col justify-center rounded border p-3 text-left outline-none transition-[opacity,transform,border-color,box-shadow] duration-200 motion-reduce:transition-none"
                      style={{
                        width: TILE_W,
                        borderColor: emptySelected
                          ? project.color
                          : `${project.color}44`,
                        background: 'rgba(7,12,20,0.94)',
                        boxShadow: emptySelected
                          ? `0 0 14px ${project.color}44`
                          : 'none',
                        opacity: entered ? 1 : 0,
                        transform: entered
                          ? emptySelected
                            ? 'scale(1.02)'
                            : 'none'
                          : 'translateY(10px) scale(0.97)',
                      }}
                    >
                      <span
                        className="font-display text-sm font-semibold"
                        style={{ color: HUD.text }}
                      >
                        No Sessions yet
                      </span>
                      <span
                        className="mt-1 font-mono text-[10px]"
                        style={{ color: project.color }}
                      >
                        Open in Terminal
                      </span>
                    </button>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      </div>
      </div>
      {railVisible && (
        <RoadmapRail
          view={roadmapView}
          projectDir={selectedDir}
          projectName={selectedProject?.name ?? null}
          projectColor={selectedProject?.color ?? null}
          mode="open"
          onModeChange={() => exitRailFocus()}
          onSelectSession={tabId => {
            const dir = projects.find(p =>
              p.tabs.some(t => t.id === tabId)
            )?.dir;
            if (dir) onPick(dir, tabId);
          }}
          overlay={!railDocks}
          permanent
          onExitFocus={exitRailFocus}
        />
      )}
    </div>
  );
}
