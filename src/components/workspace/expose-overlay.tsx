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
import Link from 'next/link';
import { Play } from 'lucide-react';
import { WORKSPACE_HUD as HUD, withThemeAlpha } from './workspace-theme';
import { READINESS_NEUTRAL } from '@/components/readiness';
import {
  projectDeclaredLinks,
  projectRoadmapSessions,
} from './roadmap-lens-input';
import { orderTeamTabs } from './team-order';
import { useTeamOrderPreference } from './team-order-preference';
import { useFlipTiles } from './use-flip-tiles';
import { usePrefersReducedMotion } from '@/lib/motion/use-prefers-reduced-motion';
import { FOCUS_SESSIONS_EVENT } from '@/components/nav/command-altitude-events';
import {
  attentionNeedsOperator,
  delegationCopy,
  SESSION_GLYPH_LABEL,
  sessionGlyphState,
  sessionLensTurnState,
  sessionTurnFacts,
} from './status-glyphs';
import type { FleetAttentionSignals } from './status-glyphs';
import {
  sessionCurrentStateCopy,
  sessionDisplayCopy,
} from './session-display-copy';
import {
  SessionOverviewCardContent,
  type SessionConsumptionReadout,
  type SessionInitiativeReadout,
} from './session-overview-card';
import {
  GoalVisualBackdrop,
  type GoalVisualReadout,
} from './goal-visual-backdrop';
import {
  teamGridNeighbor,
  teamGridYieldsTo,
  teamPointerMoved,
  type TeamGridDirection,
  type TeamGridMeasure,
  type TeamGridPoint,
} from './team-grid-nav';
import { useGoalVisualPreference } from '@/components/goal-visuals/goal-visual-preference-provider';
import { tokens as formatTokens } from '@/components/consumption/flux';
import { tabCanResumeAsAgent, tabIsLive } from './use-workspace-state';
import type { Project } from './use-workspace-state';
import type { PtyHarness, SessionDelegation } from '@/types/electron';
import type { RoadmapItemView } from '@exawatt/ui-model';
import {
  RoadmapRail,
  ROADMAP_RAIL_FOCUS_EVENT,
  hasRoadmapRailSummon,
} from '@/components/roadmap/roadmap-rail';
import {
  useProjectRoadmap,
  type RoadmapReadSource,
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
  /** stopped AND carrying the identity to resume exactly (FIX-010) */
  canResume: boolean;
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

// Team is a comparison altitude: four tiles should fit beside the resting
// roadmap rail on a common 1512px laptop viewport without shrinking type.
const TILE_W = 272;
const TILE_H = 252;

// Stable identities for absent optional props. An inline `= {}` default is a
// FRESH object every render, and anything memoized on it re-derives per
// render — which reached the follow-active-tab effect through the S6.3 view
// order and made it yank focus back to the active tile on every re-render.
const EMPTY_MAP = Object.freeze({}) as Record<string, never>;

export function ExposeOverlay({
  projects,
  summaries,
  attention,
  activity = EMPTY_MAP,
  engaged = EMPTY_MAP,
  delegation = EMPTY_MAP,
  roadmapByTab = EMPTY_MAP,
  agentTypeByTab = EMPTY_MAP,
  initiativeByTab = EMPTY_MAP,
  consumptionByTab = {},
  goalVisuals = {},
  activeTabId,
  activeProjectDir = null,
  roadmapRead,
  onPick,
  onPickProject = () => {},
  onResumeTab,
  onSelectionChange,
  onStartRoadmapAgent = async () => false,
  onStartRoadmapRemediation = async () => false,
  onAttachRoadmapSession = () => false,
  onClose,
}: {
  projects: Project[];
  summaries: Record<string, string>;
  /** presence-only (S8 merges roadmap-derived entries) */
  attention: FleetAttentionSignals;
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
  /** tabId → declared Agent Type name (ENG-028 T1): sources that declare
   *  Types (the Demo Workspace) name the worker on the announced chip;
   *  live untyped Sessions fall back to the true "Coding" value (a chip
   *  never shows its slot's name — operator, 2026-08-03). */
  agentTypeByTab?: Record<string, string>;
  /** tabId → durable high-level goal reported by the active source. */
  initiativeByTab?: Record<string, SessionInitiativeReadout>;
  /** tabId → per-Session consumption burn (ENG-008), from the shared burn
   *  view-model. Sessions whose source reports no usage have NO entry and
   *  render no readout — absent, never zero. Live local Sessions report
   *  nothing today, so the Personal workspace passes nothing. */
  consumptionByTab?: Record<string, SessionConsumptionReadout>;
  /** durableSessionId → quiet visual identity for the accepted Session Why.
   *  Sources own generation/authorship; Team only projects the result. */
  goalVisuals?: Record<string, GoalVisualReadout>;
  /** selection starts on the session the operator came from */
  activeTabId: string | null;
  /** selects an empty Project when there is no originating Session */
  activeProjectDir?: string | null;
  /** tenant roadmap source override (ENG-027 W2): the Demo Workspace lens
   *  reads fixture markdown instead of the `roadmap:read` IPC */
  roadmapRead?: RoadmapReadSource;
  onPick: (dir: string, tabId: string) => void;
  onPickProject?: (dir: string) => void;
  /** Resume a paused Agent from here (FIX-010). Team paints stopped Agents,
   *  so withholding the verb made the altitude state a fact it could not act
   *  on; the operator had to descend to the Agent altitude to get back. */
  onResumeTab?: (dir: string, tabId: string) => void;
  /** The roving selection, published so workspace-level verbs act on what is
   *  selected HERE. Without it the resume chord targeted the active tab
   *  while the operator was looking at a different tile. */
  onSelectionChange?: (selection: { dir: string; tabId: string } | null) => void;
  onStartRoadmapAgent?: (
    dir: string,
    item: RoadmapItemView
  ) => Promise<boolean>;
  onStartRoadmapRemediation?: (dir: string) => Promise<boolean>;
  onAttachRoadmapSession?: (tabId: string, itemId: string) => boolean;
  onClose: () => void;
}) {
  const {
    enabled: goalVisualsEnabled,
    ready: goalVisualsReady,
    setEnabled: setGoalVisualsEnabled,
  } = useGoalVisualPreference();

  // View order (S6.3, FIX-008 — operator pick 2026-08-07). This supersedes
  // the earlier "tiles never reshuffle" spatial-memory rule on purpose:
  // the default is CREATION order (Chrome's model — a new Agent appends,
  // nothing on screen changes address), and the stored Active-first toggle
  // leads each Project with working Agents, live — a tile glides to its new
  // slot the moment its state changes band (FLIP below). Ordering is a
  // view; the ribbon's durable manual arrangement is never written.
  const {
    mode: orderMode,
    ready: orderReady,
    setMode: setOrderMode,
  } = useTeamOrderPreference();
  const orderSignals = useMemo(
    () => ({ activity, attention }),
    [activity, attention]
  );
  const reducedMotion = usePrefersReducedMotion();
  const viewProjects = useMemo(
    () =>
      projects.map(project => ({
        ...project,
        tabs: orderTeamTabs(project.tabs, orderMode, orderSignals),
      })),
    [orderMode, orderSignals, projects]
  );
  // one key per visual order; any band move re-keys and the tiles glide
  const registerFlipNode = useFlipTiles(
    viewProjects
      .map(project => project.tabs.map(tab => tab.id).join(','))
      .join('|'),
    // Not until the stored sort has been read: the order it settles into on
    // open is a starting point, not a re-sort to animate.
    orderReady && !reducedMotion
  );
  const tiles = useMemo<Tile[]>(
    () =>
      viewProjects.flatMap(g =>
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
            canResume: tabCanResumeAsAgent(t),
          };
        })
      ),
    [viewProjects]
  );
  const items = useMemo<SelectionItem[]>(
    () =>
      viewProjects.flatMap<SelectionItem>(project => {
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
    [tiles, viewProjects]
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
  // Chromium re-dispatches synthetic mouse events at the last known cursor
  // position whenever content moves under a STATIONARY cursor — when the
  // overview mounts, and on every arrow key that scrolls the grid. Either
  // way the tile that happens to slide under the resting pointer would steal
  // the roving selection the arrow key just set. The pointer claims the
  // selection only when it has actually MOVED (FIX-002, reopened); the rule
  // itself is pure and pinned by `teamPointerMoved`.
  const pointerAtRef = useRef<TeamGridPoint | null>(null);
  const pointerClaims = (event: React.MouseEvent) => {
    const next = { x: event.clientX, y: event.clientY };
    const moved = teamPointerMoved(pointerAtRef.current, next);
    pointerAtRef.current = next;
    return moved;
  };
  const rootRef = useRef<HTMLDivElement>(null);
  const tileRefs = useRef(new Map<string, HTMLButtonElement>());
  const selectedIndexRef = useRef(sel);
  selectedIndexRef.current = sel;

  const focusSelection = useCallback(
    (
      index = selectedIndexRef.current,
      block: ScrollLogicalPosition = 'nearest'
    ) => {
      const item = items[index];
      if (item) {
        const node = tileRefs.current.get(selectionKey(item));
        node?.focus({ preventScroll: true });
        node?.scrollIntoView?.({ block, inline: 'nearest' });
      } else {
        rootRef.current?.focus({ preventScroll: true });
      }
    },
    [items]
  );

  /**
   * Measure the tiles and ask the pure model where a direction key lands
   * (FIX-002). Geometry is read at keypress rather than tracked, because the
   * only thing that can be wrong is a stale rect: the rail docks and
   * undocks, tiles wrap on resize, and Projects come and go.
   *
   * This function MEASURES and DELEGATES; it decides nothing. A tile with no
   * node yet reports `null` — unmeasurable, not a rectangle at the viewport
   * origin — and `teamGridNeighbor` owns every case that follows, including
   * the reading-order path for a host with no layout. Movement policy that
   * lives here is policy no unit test can reach.
   */
  const nextSelection = useCallback(
    (from: number, direction: TeamGridDirection): number => {
      const measures = items.map<TeamGridMeasure>(item => {
        const node = tileRefs.current.get(selectionKey(item));
        if (!node) return null;
        const box = node.getBoundingClientRect();
        return {
          left: box.left,
          top: box.top,
          width: box.width,
          height: box.height,
        };
      });
      return teamGridNeighbor(measures, from, direction) ?? from;
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
  const roadmapSessions = useMemo(
    () =>
      projectRoadmapSessions(selectedProject?.tabs, attention, {
        activity,
        engaged,
        summaries,
        delegation,
      }),
    [selectedProject, summaries, attention, activity, delegation, engaged]
  );
  const declaredLinks = useMemo(
    () =>
      projectDeclaredLinks(selectedProject?.tabs, selectedProject?.dir ?? ''),
    [selectedProject]
  );
  const {
    view: roadmapView,
    write: writeRoadmap,
    undo: undoRoadmap,
  } = useProjectRoadmap(
    railVisible ? selectedDir : null,
    roadmapSessions,
    declaredLinks,
    roadmapRead
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
  //
  // It mirrors a CHANGE OF ACTIVE TAB, not every re-render that produced a
  // new `items` array. Keying on the array was already loose; S6.3's view
  // order made it harmful, because `items` now rebuilds whenever an Agent
  // starts or stops working — precisely while the operator is scanning —
  // and the mirror would drag the keyboard back to the active tile from
  // wherever he had arrowed to. `items` is still read, through a ref, so a
  // tab that arrives later is still found without the array's identity
  // becoming a trigger.
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const mirroredRef = useRef<string | null>(null);
  useEffect(() => {
    const target = activeTabId ?? `project:${activeProjectDir ?? ''}`;
    if (mirroredRef.current === target) return;
    const next = itemsRef.current.findIndex(item =>
      activeTabId
        ? item.tabId === activeTabId
        : item.tabId === null && item.dir === activeProjectDir
    );
    // Not laid out yet: leave the mirror unclaimed so the next render that
    // does contain it still moves the selection.
    if (next === -1) return;
    mirroredRef.current = target;
    if (next === selectedIndexRef.current) return;
    setSel(next);
    requestAnimationFrame(() => focusSelection(next));
  }, [activeProjectDir, activeTabId, focusSelection, items.length]);

  // take the keyboard away from xterm; entrance flag flips post-mount so
  // tiles transition in (staggered). When a roadmap summon is in flight the
  // rail owns first focus (S12) — the entrance must not steal it back.
  const railSummonedAtMountRef = useRef(hasRoadmapRailSummon());
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      setEntered(true);
      // Entry centers the active tile: `nearest` would leave a below-the-fold
      // tile hugging the grid's bottom edge on arrival.
      if (!railSummonedAtMountRef.current) {
        focusSelection(undefined, 'center');
      }
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
    // …and so do keys born inside anything that owns text or its own
    // activation. Without this the grid claims every key that is not an
    // arrow, so a focused field never sees `j`/`k`, Enter picks a tile
    // instead of committing, and Escape closes the altitude instead of
    // cancelling the edit (FIX-006).
    if (teamGridYieldsTo(e.target)) return;
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
    // Arrows move the grid SPATIALLY (FIX-002): Up/Down between rows,
    // Left/Right within one, measured from the tiles themselves rather than
    // from an assumed column count. Plain j/k stay the D9 list-navigation
    // mirror of down/up. Modifier combos are NOT movement: ⌘K must stay the
    // palette, ⌘J the attention jump.
    const plainKey = !e.metaKey && !e.ctrlKey && !e.altKey;
    // FIX-010 keyboard half: the Resume control was reachable by mouse only,
    // and its focus-visible styling could never fire because the button is
    // deliberately out of the tab order (the grid is one roving stop). `r`
    // acts on the SELECTED tile, which is the thing the operator is looking
    // at — the same rule Enter follows.
    if (plainKey && e.key === 'r' && onResumeTab) {
      const item = items[sel];
      const tile = item?.tabId
        ? tiles.find(candidate => candidate.tabId === item.tabId)
        : undefined;
      if (tile?.canResume) {
        e.preventDefault();
        onResumeTab(tile.dir, tile.tabId);
        return;
      }
    }
    const direction: TeamGridDirection | null =
      e.key === 'ArrowRight'
        ? 'right'
        : e.key === 'ArrowLeft'
          ? 'left'
          : e.key === 'ArrowDown' || (plainKey && e.key === 'j')
            ? 'down'
            : e.key === 'ArrowUp' || (plainKey && e.key === 'k')
              ? 'up'
              : null;
    if (direction && items.length > 0) {
      e.preventDefault();
      setSel(s => {
        const next = nextSelection(s, direction);
        if (next === s) return s;
        requestAnimationFrame(() => focusSelection(next));
        return next;
      });
    }
  };

  const selectedItem = items[sel];
  const selectedTabId = selectedItem?.tabId ?? null;
  const selectedDirForVerbs = selectedItem?.dir ?? null;
  useEffect(() => {
    onSelectionChange?.(
      selectedTabId && selectedDirForVerbs
        ? { dir: selectedDirForVerbs, tabId: selectedTabId }
        : null
    );
  }, [onSelectionChange, selectedDirForVerbs, selectedTabId]);
  // Leaving Team hands the verbs back to the Agent altitude's active tab.
  useEffect(() => () => onSelectionChange?.(null), [onSelectionChange]);

  const sessionTile = (tile: Tile) => {
    const index = items.findIndex(item => item.tabId === tile.tabId);
    const selected = index === sel;
    const attentionSignal = tile.sessionId
      ? attention[tile.sessionId]
      : undefined;
    const needsYou = attentionNeedsOperator(attentionSignal);
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
    const glyphState = sessionGlyphState(
      sessionTurnFacts(tile, { activity, engaged, summaries, delegation })
    );
    const roadmap = roadmapByTab[tile.tabId];
    const consumption = consumptionByTab[tile.tabId] ?? null;
    const initiative = initiativeByTab[tile.tabId] ?? null;
    const delegationCensus = delegationCopy(tileDelegation);
    const current = sessionCurrentStateCopy({
      harness: tile.harness,
      live: tile.live,
      lifecycle: tile.lifecycle,
      glyphState,
      attention: attentionSignal,
    });
    return (
      // FLIP wrapper (S6.3): owns POSITION only. The button keeps its own
      // entrance/selection transforms, so a glide and a hover can never
      // fight over one `transform`, and the entrance stagger's per-index
      // transition delay cannot postpone a re-sort glide.
      <div
        key={tile.tabId}
        ref={registerFlipNode(tile.tabId)}
        data-expose-tile-slot={tile.tabId}
        className="group/tile relative shrink-0"
      >
        {/* FIX-010: Team paints stopped Agents, so it owes the verb too.
            A sibling of the tile button, never nested inside it. */}
        {tile.canResume && onResumeTab && (
          <button
            type="button"
            data-expose-resume={tile.tabId}
            tabIndex={-1}
            title={`Resume ${display.primary}`}
            aria-label={`Resume ${display.primary}, ${tile.projectName}`}
            onClick={event => {
              event.stopPropagation();
              onResumeTab(tile.dir, tile.tabId);
            }}
            className={`absolute right-2 top-2 z-20 inline-flex min-h-7 items-center gap-1 rounded border px-2 font-mono text-chrome-micro outline-none transition-opacity duration-150 group-hover/tile:opacity-100 motion-reduce:transition-none ${
              selected ? 'opacity-100' : 'opacity-0'
            }`}
            style={{
              color: HUD.cyan,
              borderColor: withThemeAlpha(HUD.cyan, 0.4),
              background: HUD.bg.panelFill,
            }}
          >
            <Play className="h-3 w-3" />
            Resume
          </button>
        )}
      <button
        ref={node => {
          if (node) tileRefs.current.set(tile.tabId, node);
          else tileRefs.current.delete(tile.tabId);
        }}
        data-expose-tile
        data-expose-tab={tile.tabId}
        data-selected={selected || undefined}
        tabIndex={selected ? 0 : -1}
        // The tile subtree is presentational to AT (an aria-label'd button),
        // so the delegation census must ride the accessible name — it is the
        // only place a screen-reader user hears the team at all (ENG-023).
        aria-label={`${display.primary}, ${tile.projectName}${needsYou ? ', needs attention' : ''}${
          tile.live && !needsYou ? `, ${SESSION_GLYPH_LABEL[glyphState]}` : ''
        }${tile.stateLabel ? `, ${tile.stateLabel}` : ''}${
          delegationCensus ? `, ${delegationCensus}` : ''
        }${initiative ? `, Initiative ${initiative.name}` : ''}${
          consumption ? `, ${formatTokens(consumption.rawTokens)} tokens` : ''
        }`}
        onClick={() => onPick(tile.dir, tile.tabId)}
        onMouseMove={event => {
          if (pointerClaims(event)) setSel(index);
        }}
        onFocus={() => setSel(index)}
        className="relative isolate flex flex-col overflow-hidden rounded border p-2.5 text-left outline-none transition-[opacity,transform,border-color,box-shadow] duration-200 motion-reduce:transition-none"
        style={{
          width: TILE_W,
          height: TILE_H,
          borderColor: selected ? tile.color : withThemeAlpha(tile.color, 0.27),
          background: HUD.bg.panelFill,
          boxShadow: selected
            ? `0 0 14px ${withThemeAlpha(tile.color, 0.33)}`
            : 'none',
          opacity: entered ? (tile.live ? 1 : 0.55) : 0,
          transform: entered
            ? selected
              ? 'scale(1.02)'
              : 'none'
            : 'translateY(10px) scale(0.97)',
          transitionDelay: entered ? `${Math.min(index * 18, 300)}ms` : '0ms',
        }}
      >
        {goalVisualsEnabled && (
          <GoalVisualBackdrop
            visual={goalVisuals[tile.durableSessionId] ?? null}
            fallbackIdentity={tile.durableSessionId}
            projectColor={tile.color}
          />
        )}
        <div className="relative z-10 flex min-h-0 flex-1 flex-col">
          <SessionOverviewCardContent
            title={display.primary}
            context={display.context}
            titleIsContext={display.primaryKind === 'context'}
            color={tile.color}
            harness={tile.harness}
            glyphState={glyphState}
            attention={attentionSignal}
            delegation={tileDelegation}
            agentType={agentTypeByTab[tile.tabId] ?? null}
            initiative={initiative}
            fault={fault}
            lifecycleLabel={tile.stateLabel}
            current={current}
            next={roadmap?.label ?? 'No plan reported'}
            nextProgress={roadmap?.fraction ?? null}
            consumption={consumption}
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
        </div>
      </button>
      </div>
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
        background: withThemeAlpha(HUD.bg.void, 0.84),
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
            {/* Decision 0023: the middle altitude is named Team everywhere —
                menus, ⌘K, window title. The on-surface title must match. */}
            <h2
              className="font-display text-base font-semibold"
              style={{ color: HUD.text }}
            >
              Team
            </h2>
            <span>arrows or J/K move · enter opens · esc returns</span>
            {/* Sort (S6.3, FIX-008): the operator's vocabulary — two named
                sorts, Started (the stored default: Chrome's model, oldest
                first, a new Agent appends) and Activity (most recent
                activity leads, live). One compact control, chrome-quiet
                until Activity is engaged. */}
            <div
              role="radiogroup"
              aria-label="Sort Agents"
              data-team-order-control
              className="ml-auto inline-flex h-7 shrink-0 items-center gap-0.5 rounded border px-0.5 font-mono text-chrome-label"
              style={{ borderColor: HUD.strokeFaint }}
              onKeyDown={event => {
                // these keys belong to the control, not the roving Team
                // grid; Escape still bubbles to the altitude-level return
                if (event.key !== 'Escape') event.stopPropagation();
              }}
            >
              {(
                [
                  ['started', 'Started'],
                  ['activity', 'Activity'],
                ] as const
              ).map(([value, label]) => {
                const selected = orderMode === value;
                return (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    data-team-order-mode={value}
                    onClick={() => setOrderMode(value)}
                    className="inline-flex h-6 items-center rounded-sm px-2 outline-none transition-colors duration-200 hover:bg-hud-stroke-faint focus-visible:ring-1 focus-visible:ring-hud-cyan motion-reduce:transition-none"
                    style={{
                      color: selected ? HUD.cyan : HUD.textDim,
                      background: selected
                        ? withThemeAlpha(HUD.cyan, 0.09)
                        : 'transparent',
                    }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={goalVisualsEnabled}
              aria-label="Agent tile backgrounds"
              data-team-goal-visual-toggle
              disabled={!goalVisualsReady}
              onClick={() => void setGoalVisualsEnabled(!goalVisualsEnabled)}
              onKeyDown={event => {
                // Enter/Space belong to this switch, not the roving Team grid.
                // Escape still bubbles to the altitude-level return handler.
                if (event.key !== 'Escape') event.stopPropagation();
              }}
              className="inline-flex h-7 shrink-0 items-center gap-2 rounded px-2 font-mono text-chrome-label outline-none transition-colors duration-200 hover:bg-hud-stroke-faint focus-visible:ring-1 focus-visible:ring-hud-cyan disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none"
              style={{ color: HUD.textDim }}
            >
              <span>Backgrounds</span>
              <span
                aria-hidden="true"
                className="relative h-4 w-7 rounded-full border transition-colors duration-200 motion-reduce:transition-none"
                style={{
                  borderColor: goalVisualsEnabled ? HUD.cyan : HUD.stroke,
                  background: goalVisualsEnabled
                    ? withThemeAlpha(HUD.cyan, 0.32)
                    : HUD.bg.panelFill,
                }}
              >
                <span
                  className="absolute left-0 top-0.5 h-2.5 w-2.5 rounded-full transition-transform duration-200 motion-reduce:transition-none"
                  style={{
                    background: goalVisualsEnabled ? HUD.cyan : HUD.textDim,
                    transform: `translateX(${goalVisualsEnabled ? 14 : 2}px)`,
                  }}
                />
              </span>
            </button>
            {/* Coordination preview's contextual anchor (ENG-026 N4): the
                Team altitude is where "how do these Agents hand off?" is
                asked, so the entry point lives here — real navigation with
                the muted Coming soon note (the ⌘K preview-row pattern). */}
            <Link
              href="/coordination"
              data-coordination-anchor
              className="inline-flex items-baseline gap-1.5 font-mono text-chrome-label outline-none transition-colors hover:text-hud-text focus-visible:text-hud-text"
              style={{ color: HUD.textDim }}
            >
              Coordination
              <span
                className="text-chrome-micro"
                style={{ color: READINESS_NEUTRAL }}
              >
                Coming soon
              </span>
            </Link>
          </div>
          {projects.length === 0 && (
            <div
              className="flex min-h-48 max-w-lg flex-col justify-center gap-2 border-y py-8"
              style={{ borderColor: HUD.strokeFaint }}
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
          <div className="flex flex-col gap-4">
            {viewProjects.map(project => {
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
                  // Altitude-handoff capture hook (ENG-004 V3.0): identity
                  // and screen position carry to the Fleet board; content
                  // never does.
                  data-handoff-card=""
                  data-handoff-label={project.name}
                  data-handoff-color={project.color}
                  aria-label={`${project.name}, ${projectTiles.length} Sessions`}
                >
                  <div
                    className="mb-2 flex items-center gap-2 border-b pb-2"
                    style={{
                      borderColor: withThemeAlpha(project.color, 0.2),
                    }}
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
                  <div className="flex flex-wrap gap-2.5">
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
                        onMouseMove={event => {
                          if (pointerClaims(event)) setSel(emptyIndex);
                        }}
                        onFocus={() => setSel(emptyIndex)}
                        className="flex min-h-28 flex-col justify-center rounded border p-2.5 text-left outline-none transition-[opacity,transform,border-color,box-shadow] duration-200 motion-reduce:transition-none"
                        style={{
                          width: TILE_W,
                          borderColor: emptySelected
                            ? project.color
                            : withThemeAlpha(project.color, 0.27),
                          background: HUD.bg.panelFill,
                          boxShadow: emptySelected
                            ? `0 0 14px ${withThemeAlpha(project.color, 0.27)}`
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
                          className="mt-1 font-mono text-chrome-micro"
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
          onStartAgent={item =>
            selectedDir
              ? onStartRoadmapAgent(selectedDir, item)
              : Promise.resolve(false)
          }
          onStartRemediation={() =>
            selectedDir
              ? onStartRoadmapRemediation(selectedDir)
              : Promise.resolve(false)
          }
          onAttachSession={(tabId, itemId) =>
            onAttachRoadmapSession(tabId, itemId)
          }
          onWrite={writeRoadmap}
          onUndo={undoRoadmap}
          overlay={!railDocks}
          permanent
          onExitFocus={exitRailFocus}
        />
      )}
    </div>
  );
}
