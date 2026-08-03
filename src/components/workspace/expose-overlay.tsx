// No 'use client' directive: only imported by the client workspace surface.

/**
 * Exposé overview (ENG-015 S3): ⌃⌘2 fans every live session out as a rich
 * tile — project color, source, durable context, current state, and plan —
 * so "where is everything?" answers itself in one glance. Terminal output
 * stays in Terminal; Sessions only presents source-agnostic state truth.
 * Fully keyboard-driven: arrows move,
 * Enter/click drops into the session, Escape closes. DOM-rendered per the
 * decision `0003` hybrid rule; motion respects prefers-reduced-motion.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { HUD } from '@/components/hud';
import { FOCUS_SESSIONS_EVENT } from '@/components/nav/command-altitude-events';
import {
  attentionNeedsOperator,
  SESSION_GLYPH_LABEL,
  sessionDelegationBusy,
  sessionGlyphState,
  sessionReportedBlocked,
} from './status-glyphs';
import type { SessionAttentionSignal } from './status-glyphs';
import {
  sessionCurrentStateCopy,
  sessionDisplayCopy,
} from './session-display-copy';
import { SessionOverviewCardContent } from './session-overview-card';
import { tabIsLive } from './use-workspace-state';
import type { Project } from './use-workspace-state';
import type { PtyHarness, SessionDelegation } from '@/types/electron';
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
  /** durable Session identity — the goal subtitle's key (D21) */
  durableSessionId: string;
  tabId: string;
  dir: string;
  harness: PtyHarness;
  title: string;
  titleKind: 'default' | 'operator';
  lifecycle: string;
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
  // a ⌘T draft (D24) — no runtime yet, deliberately not 'stopped'
  draft: 'draft',
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
  engaged = {},
  delegation = {},
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
  attention: Record<string, SessionAttentionSignal>;
  /** sessions actively producing output, keyed by sessionId (D18) */
  activity?: Record<string, boolean>;
  /** sessions ever given work, keyed by sessionId (D22) */
  engaged?: Record<string, boolean>;
  /** harness-reported delegated work by sessionId (ENG-023) */
  delegation?: Record<string, SessionDelegation>;
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
            durableSessionId: t.durableSessionId,
            tabId: t.id,
            dir: g.dir,
            harness: t.harness,
            title: t.title,
            titleKind: t.titleKind,
            lifecycle: t.lifecycle,
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

  // start where the operator was — ⌃⌘2 then Enter must be a no-op return,
  // never a jump to whatever happens to be tile 0
  const [sel, setSel] = useState(() => {
    const i = items.findIndex(item =>
      activeTabId
        ? item.tabId === activeTabId
        : item.tabId === null && item.dir === activeProjectDir
    );
    return i === -1 ? 0 : i;
  });
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
          contextSummary: summaries[t.durableSessionId] ?? null,
          needsAttention: attentionNeedsOperator(
            attention[t.sessionId as string]
          ),
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
    const attentionSignal = tile.sessionId
      ? attention[tile.sessionId]
      : undefined;
    const needsYou = attentionNeedsOperator(attentionSignal);
    const working = !!(tile.sessionId && activity[tile.sessionId]);
    const fault = tile.stateLabel === 'failed';
    // Durable Session context survives process replacement. The display
    // projection is total: rejected/missing labels become "New agent", never
    // an icon-only card.
    const subtitle = summaries[tile.durableSessionId];
    const display = sessionDisplayCopy({
      harness: tile.harness,
      title: tile.title,
      titleKind: tile.titleKind,
      lifecycle: tile.lifecycle,
      summary: subtitle,
    });
    // same three-state truth as the tab strip (D22): started = main-truth
    // engaged bit, or a goal subtitle for sessions predating the channel
    // Sessions altitude answers "is this work moving?" (ENG-023), so a tile
    // with delegated children reads as working rather than finished.
    const tileDelegation = tile.sessionId
      ? delegation[tile.sessionId]
      : undefined;
    const glyphState = sessionGlyphState({
      working,
      agent: tile.harness !== 'shell',
      started: !!(tile.sessionId && engaged[tile.sessionId]) || !!subtitle,
      delegatedBusy: sessionDelegationBusy(tileDelegation),
      blocked: sessionReportedBlocked(tileDelegation),
      ownTurn: tileDelegation?.ownTurn,
    });
    const roadmap = roadmapByTab[tile.tabId];
    const current = sessionCurrentStateCopy({
      harness: tile.harness,
      live: tile.live,
      lifecycle: tile.lifecycle,
      glyphState,
      attention: attentionSignal,
    });
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
        aria-label={`${display.primary}, ${tile.projectName}${needsYou ? ', needs attention' : ''}${
          tile.live && !needsYou ? `, ${SESSION_GLYPH_LABEL[glyphState]}` : ''
        }${tile.stateLabel ? `, ${tile.stateLabel}` : ''}`}
        onClick={() => onPick(tile.dir, tile.tabId)}
        onMouseEnter={() => {
          if (mouseArmed()) setSel(index);
        }}
        onFocus={() => setSel(index)}
        className="flex h-[248px] flex-col rounded border p-3 text-left outline-none transition-[opacity,transform,border-color,box-shadow] duration-200 motion-reduce:transition-none"
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
        <SessionOverviewCardContent
          title={display.primary}
          context={display.context}
          titleIsContext={display.primaryKind === 'context'}
          color={tile.color}
          harness={tile.harness}
          glyphState={glyphState}
          attention={attentionSignal}
          delegation={tileDelegation}
          fault={fault}
          lifecycleLabel={tile.stateLabel}
          current={current}
          next={roadmap?.label ?? 'No plan reported'}
          nextProgress={roadmap?.fraction ?? null}
        />
        {roadmap && (
          <span
            data-expose-roadmap-item
            data-link-method={roadmap.inferred ? 'inferred' : 'declared'}
            className="sr-only"
          >
            {roadmap.label}
          </span>
        )}
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
            className="mb-4 flex items-baseline gap-3 font-sans text-sm"
            style={{ color: HUD.textDim }}
          >
            <h2
              className="font-display text-base font-semibold"
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
                Return to Agent and open a Project.
              </p>
            </div>
          )}
          <div className="flex flex-col gap-5">
            {projects.map(project => {
              const projectTiles = tiles.filter(
                tile => tile.dir === project.dir
              );
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
                      className="h-3.5 w-[3px] shrink-0 rounded-full"
                      style={{ background: project.color }}
                    />
                    <h3
                      className="truncate font-sans text-sm font-semibold"
                      style={{ color: HUD.text }}
                    >
                      {project.name}
                    </h3>
                    <span
                      className="font-mono text-xs tabular-nums"
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
                        aria-label={`Open ${project.name} at the Agent altitude, no Sessions yet`}
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
