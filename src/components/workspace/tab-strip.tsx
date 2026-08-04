// No 'use client' directive: only imported by the client workspace surface.

/**
 * Project / Initiative ribbon — one row (ENG-016 D45).
 *
 * Projects keep manual order. Exactly three presentations exist and the
 * layout engine picks them: the active Project is `open` (tabs with
 * titles, Chrome-shrunk to fit), every other Project is `mini` (glyph
 * chips), and a Project that still cannot fit `folded` (one container chip
 * carrying its count). Nothing is ever evicted; when even folding is not
 * enough the row scrolls. The pure layout module owns widths and target
 * bounds, the presence module owns interruption-safe entry/exit, and this
 * component owns interaction.
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { useRouter } from 'next/navigation';
import {
  WORKSPACE_HUD as HUD,
  withThemeAlpha,
} from './workspace-theme';
import { ContextLabelFeedback } from '@/components/feedback/context-label-feedback';
import { usePrefersReducedMotion } from '@/lib/motion/use-prefers-reduced-motion';
import type { SessionDelegation } from '@/types/electron';
import type { AgentSourceId } from './agent-sources';
import { HarnessGlyph } from './harness-icons';
import {
  DEFAULT_RIBBON_POLICY,
  layoutRibbonRow,
  orderProjectsForRibbon,
  type ProjectPresentation,
  RIBBON_ROW_HEIGHT,
  ribbonHeightForRows,
  type RibbonLayoutPolicy,
  type RibbonProjectInput,
  type RibbonTarget,
} from './project-ribbon-layout';
import { naturalContentWidth } from './natural-width';
import {
  DRAG_THRESHOLD_PX,
  dropIndexForPointer,
  placementForOrder,
  reorderTokensForProjectDrag,
  reorderTokensForTabDrag,
  ribbonContentX,
  slotCenter,
} from './ribbon-reorder';
import {
  ColorSwatches,
  EditableChrome,
  isContextMenuKey,
  keyboardMenuPoint,
  type MenuCloseFocus,
  OrdinalKeycap,
  RenameInput,
  StripContextMenu,
  type StripMenuItem,
} from './project-ribbon-menu';
import {
  CONDENSED_TAB_WIDTH,
  estimateRibbonTokenWidth,
  POINTER_CLOSE_STABILIZE_MS,
  type PresentRibbonToken,
  RIBBON_EXIT_MS,
  RIBBON_MOTION_MS,
  ribbonTargetTransform,
  type RibbonToken,
  useRibbonPresence,
} from './project-ribbon-motion';
import {
  deriveProjectRibbonSignal,
  PROJECT_RIBBON_SIGNAL_COPY,
  ProjectRibbonSignalMark,
} from './project-ribbon-signal';
import { sessionDisplayCopy } from './session-display-copy';
import { tabCanClone } from './session-clone';
import {
  EDIT_ACTIVE_PROJECT_EVENT,
  FOCUS_ACTIVE_TERMINAL_EVENT,
  RENAME_ACTIVE_EVENT,
} from './session-jump';
import { tabIsPinnable } from './split-layout';
import {
  attentionNeedsOperator,
  DelegationDots,
  SESSION_GLYPH_COPY,
  SESSION_GLYPH_LABEL,
  SessionStatusGlyph,
  sessionDelegationBusy,
  sessionGlyphState,
  sessionReportedBlocked,
  type SessionAttentionSignal,
} from './status-glyphs';
import { useOrdinalHints } from './use-ordinal-hints';
import { tabIsLive, type Project } from './use-workspace-state';

interface Editing {
  kind: 'group' | 'tab';
  id: string;
  value: string;
}

/**
 * Ribbon tokens: every Project header and every tab, in display order.
 *
 * Tokens carry identity and order only. How wide a tab is drawn — full,
 * glyph chip, or not at all because its Project folded — is decided by the
 * layout engine (D45) and read back at render time, so paint truth and
 * width truth cannot disagree. Admission priority is gone with the two-row
 * budget: nothing is evicted any more.
 */
export function buildRibbonTokens({
  orderedProjects,
  projects,
}: {
  orderedProjects: readonly Project[];
  projects: readonly Project[];
}): RibbonToken[] {
  const next: RibbonToken[] = [];
  orderedProjects.forEach(project => {
    const sourceProjectIndex = projects.findIndex(
      candidate => candidate.dir === project.dir
    );
    next.push({
      key: `project:${project.dir}`,
      kind: 'project',
      project,
      sourceProjectIndex,
    });
    project.tabs.forEach(tab => {
      next.push({ key: `tab:${tab.id}`, kind: 'tab', project, tab });
    });
  });
  return next;
}

const FALLBACK_RIBBON_WIDTH = 900;
const EMPTY_SET: ReadonlySet<string> = new Set();
const EMPTY_ACTIVITY: Record<string, boolean> = {};
const EMPTY_DELEGATION: Record<string, SessionDelegation> = {};
const EMPTY_CLONE_TARGETS: readonly CloneSessionTarget[] = [];

export interface CloneSessionTarget {
  id: AgentSourceId;
  label: string;
}

export function TabStrip({
  projects,
  activeDir,
  pinnedTabId,
  summaries,
  attention,
  activity = EMPTY_ACTIVITY,
  engaged = EMPTY_ACTIVITY,
  delegation = EMPTY_DELEGATION,
  onTogglePinTab,
  onResumeTab,
  cloneTargets = EMPTY_CLONE_TARGETS,
  onCloneTab,
  onNewAgent,
  onCloseProject,
  onRevealPath,
  onReorderTab,
  onReorderProject,
  onSelectProject,
  onSelectTab,
  onCloseTab,
  onRenameTab,
  onRenameProject,
  onSetProjectColor,
  feedbackEnabled = false,
  onRateContext,
  exitingProjectDirs,
  dormantProjectDirs,
  layoutPolicy = DEFAULT_RIBBON_POLICY,
}: {
  projects: Project[];
  activeDir: string | null;
  pinnedTabId: string | null;
  summaries: Record<string, string>;
  attention: Record<string, SessionAttentionSignal>;
  activity?: Record<string, boolean>;
  engaged?: Record<string, boolean>;
  delegation?: Record<string, SessionDelegation>;
  onTogglePinTab?: (tabId: string) => void;
  onResumeTab?: (tabId: string) => void;
  cloneTargets?: readonly CloneSessionTarget[];
  onCloneTab?: (tabId: string, target: AgentSourceId) => void;
  onNewAgent?: (dir: string) => void;
  onCloseProject?: (dir: string) => void;
  onRevealPath?: (cwd: string) => void;
  onSelectProject: (index: number) => void;
  onSelectTab: (dir: string, tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onRenameTab: (tabId: string, title: string) => void;
  onRenameProject: (dir: string, name: string) => void;
  onSetProjectColor: (dir: string, color: string) => void;
  feedbackEnabled?: boolean;
  onRateContext?: (input: {
    durableSessionId: string;
    label: string;
    sentiment: -1 | 1;
    betterLabel?: string | null;
    projectName: string;
  }) => Promise<boolean>;
  onReorderTab?: (
    tabId: string,
    targetTabId: string,
    place: 'before' | 'after'
  ) => void;
  onReorderProject?: (
    dir: string,
    targetDir: string,
    place: 'before' | 'after'
  ) => void;
  exitingProjectDirs?: ReadonlySet<string>;
  dormantProjectDirs?: ReadonlySet<string>;
  /** Overrides the layout dial. Production uses the default; the ribbon lab
   *  drives it live so the tuning can be felt before it is chosen. */
  layoutPolicy?: RibbonLayoutPolicy;
}) {
  const reducedMotion = usePrefersReducedMotion();
  const router = useRouter();
  const ordinalHints = useOrdinalHints();
  const [editing, setEditing] = useState<Editing | null>(null);
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    color: string;
    label: string;
    items: StripMenuItem[];
    target: { kind: 'project' | 'tab'; id: string };
  } | null>(null);
  const menuTriggerRef = useRef<HTMLElement | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [scrollEdges, setScrollEdges] = useState({
    left: false,
    right: false,
  });
  const itemNodesRef = useRef(new Map<string, HTMLDivElement>());
  const lastTargetsRef = useRef(new Map<string, RibbonTarget>());
  const [containerWidth, setContainerWidth] = useState(FALLBACK_RIBBON_WIDTH);
  /** Project dir → measured natural header width. Only headers are
   *  measured now: tab chips are either a fixed glyph width or a width the
   *  engine assigns, so nothing else can feed its own output back in. */
  const [headerWidths, setHeaderWidths] = useState<Record<string, number>>({});
  const [heldCloseKeys, setHeldCloseKeys] = useState<Set<string>>(
    () => new Set()
  );
  const heldCloseTimers = useRef(
    new Map<string, ReturnType<typeof setTimeout>>()
  );
  // Pointer-based rearrangement (D42): the real chip follows the pointer
  // while siblings re-target live; HTML5 DnD (ghost image, inset drop line)
  // is gone. `engaged` flips once the pointer crosses the drag threshold so
  // plain clicks never enter drag mode.
  const [pointerDrag, setPointerDrag] = useState<{
    kind: 'tab' | 'project';
    key: string;
    id: string;
    dir: string;
    engaged: boolean;
    startX: number;
    startY: number;
    grabDX: number;
    grabDY: number;
    x: number;
    y: number;
    index: number;
  } | null>(null);
  const pointerDragRef = useRef<typeof pointerDrag>(null);
  const justDraggedRef = useRef(false);
  const activeGestureCleanupRef = useRef<(() => void) | null>(null);
  const dragGeometryRef = useRef<{
    tokens: RibbonToken[];
    orderedTokens: RibbonToken[];
    layout: ReturnType<typeof layoutRibbonRow>;
    dormant: ReadonlySet<string>;
  } | null>(null);

  const dormant = dormantProjectDirs ?? EMPTY_SET;
  const exiting = exitingProjectDirs ?? EMPTY_SET;
  const orderedProjects = useMemo(
    () => orderProjectsForRibbon(projects, dormant),
    [dormant, projects]
  );
  const projectSignals = useMemo(
    () =>
      new Map(
        projects.map(project => [
          project.dir,
          deriveProjectRibbonSignal({
            project,
            summaries,
            attention,
            activity,
            engaged,
            delegation,
          }),
        ])
      ),
    [activity, attention, delegation, engaged, projects, summaries]
  );
  const tokens = useMemo<RibbonToken[]>(
    () => buildRibbonTokens({ orderedProjects, projects }),
    [orderedProjects, projects]
  );
  // While a drag is engaged, the strip renders the HYPOTHETICAL order so
  // siblings make room live; commit happens only on release.
  const orderedTokens = useMemo(() => {
    if (!pointerDrag?.engaged) return tokens;
    return pointerDrag.kind === 'tab'
      ? reorderTokensForTabDrag(tokens, pointerDrag.key, pointerDrag.index)
      : reorderTokensForProjectDrag(tokens, pointerDrag.id, pointerDrag.index);
  }, [pointerDrag, tokens]);
  const presentTokens = useRibbonPresence(orderedTokens, heldCloseKeys);
  const currentKeys = useMemo(
    () => new Set(orderedTokens.map(token => token.key)),
    [orderedTokens]
  );

  const layoutEntries = useMemo(
    () =>
      presentTokens.filter(entry => {
        if (exiting.has(entry.token.project.dir)) return false;
        return entry.phase !== 'exiting' || heldCloseKeys.has(entry.token.key);
      }),
    [exiting, heldCloseKeys, presentTokens]
  );
  // One row, laid out from the Projects in their current (possibly
  // drag-hypothetical) order. The engine decides each Project's
  // presentation; rendering reads that rather than deciding for itself, so
  // width truth and paint truth cannot disagree.
  const layout = useMemo(() => {
    type Block = Omit<RibbonProjectInput, 'tabs'> & {
      tabs: Array<RibbonProjectInput['tabs'][number]>;
    };
    const blocks: Block[] = [];
    for (const entry of layoutEntries) {
      const token = entry.token;
      if (token.kind === 'project') {
        blocks.push({
          dir: token.project.dir,
          headerWidth:
            headerWidths[token.project.dir] ?? estimateRibbonTokenWidth(token),
          // the same chip plus a count badge
          // folded chips add the status dot and the count to the name
          foldedWidth:
            (headerWidths[token.project.dir] ??
              estimateRibbonTokenWidth(token)) + 34,
          tabs: [],
          active: token.project.dir === activeDir,
        });
        continue;
      }
      const block = blocks.at(-1);
      if (!block || block.dir !== token.project.dir) continue;
      const visibleLabel = sessionDisplayCopy({
        harness: token.tab.harness,
        title: token.tab.title,
        titleKind: token.tab.titleKind,
        lifecycle: token.tab.lifecycle,
        summary: summaries[token.tab.durableSessionId],
      }).primary;
      block.tabs.push({
        id: token.tab.id,
        openWidth: estimateRibbonTokenWidth(token, visibleLabel),
        miniWidth: CONDENSED_TAB_WIDTH,
      });
    }
    return layoutRibbonRow(blocks, containerWidth, layoutPolicy);
  }, [
    activeDir,
    containerWidth,
    headerWidths,
    layoutEntries,
    layoutPolicy,
    summaries,
  ]);
  const presentationFor = useCallback(
    (dir: string): ProjectPresentation =>
      layout.presentation.get(dir) ?? (dir === activeDir ? 'open' : 'mini'),
    [activeDir, layout]
  );

  // Height is constant by construction now (D45): one row cannot vary, so
  // the terminal below never resizes on a selection change and the whole
  // hypothetical-variant machinery D42 needed is gone.
  const stripHeight = ribbonHeightForRows(layout.rows);

  useLayoutEffect(() => {
    for (const [key, target] of layout.targets) {
      lastTargetsRef.current.set(key, target);
    }
  }, [layout]);

  // Last-known bounds intentionally outlive removal for the exit animation,
  // but not forever. Long-running workspaces churn through thousands of
  // Sessions; prune once presence has released them.
  useEffect(() => {
    const presentKeys = new Set(presentTokens.map(entry => entry.token.key));
    for (const key of lastTargetsRef.current.keys()) {
      if (!presentKeys.has(key)) lastTargetsRef.current.delete(key);
    }
  }, [presentTokens]);

  // Only Project headers are measured, and only through
  // `naturalContentWidth`, which builds a width from parts that are
  // content-sized by construction — see that module for why reading the
  // chip's own box here is a closed loop rather than a measurement. A
  // folded header renders a count too, so it is skipped: its width is
  // derived from the header's.
  const measure = useCallback(() => {
    const width = containerRef.current?.clientWidth ?? 0;
    if (width > 0)
      setContainerWidth(current => (current === width ? current : width));
    const container = containerRef.current;
    if (!container) return;
    const measured: Record<string, number> = {};
    for (const node of container.querySelectorAll<HTMLElement>(
      '[data-ribbon-item="project"]:not([data-project-folded]) [data-project-chrome]'
    )) {
      const dir = node
        .closest('[data-ribbon-item="project"]')
        ?.getAttribute('data-project-dir');
      if (!dir) continue;
      const natural = naturalContentWidth(
        node,
        node.querySelector<HTMLElement>('[data-project-label]'),
        2 // the chip's borders sit outside the chrome
      );
      if (natural !== null) measured[dir] = natural;
    }
    if (Object.keys(measured).length === 0) return;
    setHeaderWidths(current => {
      const changed = Object.entries(measured).some(
        ([dir, value]) => current[dir] !== value
      );
      return changed ? { ...current, ...measured } : current;
    });
  }, []);

  useLayoutEffect(() => {
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    if (containerRef.current) observer.observe(containerRef.current);
    for (const node of itemNodesRef.current.values()) observer.observe(node);
    return () => observer.disconnect();
  }, [measure, presentTokens]);

  const setItemNode = useCallback(
    (key: string, node: HTMLDivElement | null) => {
      if (node) itemNodesRef.current.set(key, node);
      else itemNodesRef.current.delete(key);
    },
    []
  );

  const syncScrollEdges = useCallback(() => {
    const node = scrollerRef.current;
    if (!node) return;
    const left = node.scrollLeft > 2;
    const right = node.scrollLeft + node.clientWidth < node.scrollWidth - 2;
    setScrollEdges(current =>
      current.left === left && current.right === right
        ? current
        : { left, right }
    );
  }, []);

  // Keep the active Project reachable without hunting: when the row scrolls,
  // bring the selection into view. Instant under Reduced Motion.
  useEffect(() => {
    const node = scrollerRef.current;
    if (!node || !activeDir) return;
    // Never scroll under a drag: the layout recomputes on every pointer
    // move, and auto-scrolling then would fight the hand holding the chip.
    if (pointerDragRef.current?.engaged) return;
    const target = layout.targets.get(`project:${activeDir}`);
    if (!target) return;
    const activeProject = projects.find(item => item.dir === activeDir);
    const activeTabTarget = activeProject?.activeTabId
      ? layout.targets.get(`tab:${activeProject.activeTabId}`)
      : undefined;
    const from = target.x;
    const to = (activeTabTarget ?? target).x + (activeTabTarget ?? target).width;
    const viewLeft = node.scrollLeft;
    const viewRight = viewLeft + node.clientWidth;
    let next = viewLeft;
    if (from < viewLeft + 12) next = Math.max(0, from - 12);
    else if (to > viewRight - 12) next = to - node.clientWidth + 12;
    if (next === viewLeft) return;
    // jsdom (and any host without smooth scrolling) has no scrollTo
    if (typeof node.scrollTo === 'function') {
      node.scrollTo({ left: next, behavior: reducedMotion ? 'auto' : 'smooth' });
    } else {
      node.scrollLeft = next;
    }
  }, [activeDir, layout, projects, reducedMotion]);

  useEffect(syncScrollEdges, [syncScrollEdges, layout, containerWidth]);

  const releaseHeldClose = useCallback((key?: string) => {
    if (key) {
      const timer = heldCloseTimers.current.get(key);
      if (timer) clearTimeout(timer);
      heldCloseTimers.current.delete(key);
      setHeldCloseKeys(current => {
        if (!current.has(key)) return current;
        const next = new Set(current);
        next.delete(key);
        return next;
      });
      return;
    }
    for (const timer of heldCloseTimers.current.values()) clearTimeout(timer);
    heldCloseTimers.current.clear();
    setHeldCloseKeys(current => (current.size === 0 ? current : new Set()));
  }, []);

  const armPointerClose = useCallback(
    (key: string) => {
      setHeldCloseKeys(current => new Set(current).add(key));
      const prior = heldCloseTimers.current.get(key);
      if (prior) clearTimeout(prior);
      heldCloseTimers.current.set(
        key,
        setTimeout(() => releaseHeldClose(key), POINTER_CLOSE_STABILIZE_MS)
      );
    },
    [releaseHeldClose]
  );

  useEffect(
    () => () => {
      for (const timer of heldCloseTimers.current.values()) clearTimeout(timer);
    },
    []
  );

  const openMenu = useCallback(
    ({
      trigger,
      x,
      y,
      color,
      label,
      items,
      target,
    }: {
      trigger: HTMLElement;
      x: number;
      y: number;
      color: string;
      label: string;
      items: StripMenuItem[];
      target: { kind: 'project' | 'tab'; id: string };
    }) => {
      menuTriggerRef.current = trigger;
      setMenu({ x, y, color, label, items, target });
    },
    []
  );
  const closeMenu = useCallback((focus: MenuCloseFocus = 'none') => {
    const trigger = menuTriggerRef.current;
    menuTriggerRef.current = null;
    setMenu(null);
    if (focus === 'none' || !trigger) return;
    queueMicrotask(() => {
      if (focus === 'trigger') {
        if (trigger.isConnected) trigger.focus();
        return;
      }
      const candidates = Array.from(
        document.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      ).filter(
        element =>
          element.isConnected &&
          !element.closest('[data-strip-menu]') &&
          !element.closest('[inert]')
      );
      const index = candidates.indexOf(trigger);
      const target = candidates[index + (focus === 'next' ? 1 : -1)];
      (target ?? (trigger.isConnected ? trigger : null))?.focus();
    });
  }, []);

  useEffect(() => {
    if (!menu) return;
    const exists =
      menu.target.kind === 'project'
        ? projects.some(
            project =>
              project.dir === menu.target.id && !exiting.has(project.dir)
          )
        : projects.some(project =>
            project.tabs.some(tab => tab.id === menu.target.id)
          );
    if (!exists) closeMenu('none');
  }, [closeMenu, exiting, menu, projects]);

  const activeRef = useRef({ projects, activeDir });
  activeRef.current = { projects, activeDir };
  useEffect(() => {
    const renameActive = () => {
      const group = activeRef.current.projects.find(
        project => project.dir === activeRef.current.activeDir
      );
      const tab = group?.tabs.find(
        candidate => candidate.id === group.activeTabId
      );
      if (tab) setEditing({ kind: 'tab', id: tab.id, value: tab.title });
    };
    const editProject = () => {
      const group = activeRef.current.projects.find(
        project => project.dir === activeRef.current.activeDir
      );
      if (group)
        setEditing({ kind: 'group', id: group.dir, value: group.name });
    };
    window.addEventListener(RENAME_ACTIVE_EVENT, renameActive);
    window.addEventListener(EDIT_ACTIVE_PROJECT_EVENT, editProject);
    return () => {
      window.removeEventListener(RENAME_ACTIVE_EVENT, renameActive);
      window.removeEventListener(EDIT_ACTIVE_PROJECT_EVENT, editProject);
    };
  }, []);

  const settleEditing = () => {
    setEditing(null);
    window.dispatchEvent(new CustomEvent(FOCUS_ACTIVE_TERMINAL_EVENT));
  };
  const commitEditing = () => {
    if (!editing) return;
    if (editing.kind === 'group') onRenameProject(editing.id, editing.value);
    else onRenameTab(editing.id, editing.value);
    settleEditing();
  };

  const ordinalByTabId = useMemo(() => {
    const ordinals = new Map<string, number>();
    const tabs = projects.flatMap(project => project.tabs);
    tabs.slice(0, 8).forEach((tab, index) => ordinals.set(tab.id, index + 1));
    if (tabs.length >= 9) ordinals.set(tabs[tabs.length - 1].id, 9);
    return ordinals;
  }, [projects]);

  dragGeometryRef.current = { tokens, orderedTokens, layout, dormant };

  const endPointerDrag = useCallback(
    (commit: boolean) => {
      const current = pointerDragRef.current;
      pointerDragRef.current = null;
      document.body.style.userSelect = '';
      if (current?.engaged) {
        // The release click must not select whatever chip sits under the
        // pointer. The UA dispatches that click in the same input task as
        // pointerup — BEFORE any queued timeout, but AFTER microtasks — so
        // a macrotask clear covers the click and still resets promptly when
        // no click follows (release outside the press target).
        justDraggedRef.current = true;
        setTimeout(() => {
          justDraggedRef.current = false;
        }, 0);
        const geometry = dragGeometryRef.current;
        if (commit && geometry) {
          if (current.kind === 'tab') {
            const ids = (list: RibbonToken[]) =>
              list
                .filter(
                  token =>
                    token.kind === 'tab' && token.project.dir === current.dir
                )
                .map(token => (token.kind === 'tab' ? token.tab.id : ''));
            const placement = placementForOrder(
              ids(geometry.tokens),
              ids(geometry.orderedTokens),
              current.id
            );
            if (placement) {
              onReorderTab?.(current.id, placement.targetId, placement.place);
            }
          } else {
            // Dormant chips are auto-partitioned to the tail; preview and
            // commit must both speak the LIVE projection or they disagree
            // the moment the ribbon re-partitions the committed order.
            const dirs = (list: RibbonToken[]) =>
              list
                .filter(
                  token =>
                    token.kind === 'project' &&
                    !geometry.dormant.has(token.project.dir)
                )
                .map(token => token.project.dir);
            const placement = placementForOrder(
              dirs(geometry.tokens),
              dirs(geometry.orderedTokens),
              current.id
            );
            if (placement) {
              onReorderProject?.(
                current.id,
                placement.targetId,
                placement.place
              );
            }
          }
        }
      }
      setPointerDrag(null);
    },
    [onReorderProject, onReorderTab]
  );

  const beginPointerDrag = useCallback(
    (
      event: React.PointerEvent,
      params: { kind: 'tab' | 'project'; key: string; id: string; dir: string }
    ) => {
      if (event.button !== 0 || editing || pointerDragRef.current) return;
      if ((event.target as HTMLElement).closest('[data-ribbon-passive]')) {
        return;
      }
      // A dormant chip's tail position is automatic, not manual order —
      // there is nothing meaningful to drag it against.
      if (params.kind === 'project' && dormant.has(params.dir)) return;
      // Defensive: tear down any zombie gesture (its pointerup never
      // arrived) before arming a new one, so listener sets cannot stack.
      activeGestureCleanupRef.current?.();
      const scroller = scrollerRef.current;
      const node = itemNodesRef.current.get(params.key);
      if (!scroller || !node) return;
      const nodeRect = node.getBoundingClientRect();
      const gesturePointerId = event.pointerId;
      const start = {
        x: ribbonContentX(event.clientX, scroller),
        y: event.clientY - scroller.getBoundingClientRect().top,
      };
      const candidate = {
        ...params,
        engaged: false,
        startX: start.x,
        startY: start.y,
        grabDX: event.clientX - nodeRect.left,
        grabDY: event.clientY - nodeRect.top,
        x: start.x,
        y: start.y,
        index: 0,
      };
      pointerDragRef.current = candidate;
      setPointerDrag(candidate);
      // Escape reverts the visuals immediately but the gesture stays armed
      // until the REAL release, so the release click is still suppressed.
      let canceled = false;

      const suppressReleaseClick = () => {
        // The UA dispatches the post-release click in the same input task
        // as pointerup — before any queued timeout, after microtasks — so
        // a macrotask clear covers the click and still resets promptly
        // when no click follows.
        justDraggedRef.current = true;
        setTimeout(() => {
          justDraggedRef.current = false;
        }, 0);
      };
      const onMove = (moveEvent: PointerEvent) => {
        if (moveEvent.pointerId !== gesturePointerId) return;
        const active = pointerDragRef.current;
        const liveScroller = scrollerRef.current;
        if (!active || !liveScroller) return;
        const x = ribbonContentX(moveEvent.clientX, liveScroller);
        const y =
          moveEvent.clientY - liveScroller.getBoundingClientRect().top;
        let engaged = active.engaged;
        if (!engaged) {
          if (
            Math.hypot(x - active.startX, y - active.startY) <
            DRAG_THRESHOLD_PX
          ) {
            pointerDragRef.current = { ...active, x, y };
            return;
          }
          engaged = true;
          document.body.style.userSelect = 'none';
        }
        const geometry = dragGeometryRef.current;
        let index = active.index;
        if (geometry) {
          const siblings =
            active.kind === 'tab'
              ? geometry.orderedTokens.filter(
                  token =>
                    token.kind === 'tab' &&
                    token.project.dir === active.dir &&
                    token.key !== active.key
                )
              : geometry.orderedTokens.filter(
                  token =>
                    token.kind === 'project' &&
                    token.key !== active.key &&
                    !geometry.dormant.has(token.project.dir)
                );
          const centers = siblings
            .map(token => geometry.layout.targets.get(token.key))
            .filter((target): target is RibbonTarget => !!target)
            .map(slotCenter);
          index = dropIndexForPointer(centers, x);
        }
        const next = { ...active, engaged, x, y, index };
        pointerDragRef.current = next;
        setPointerDrag(next);
      };
      const onKey = (keyEvent: KeyboardEvent) => {
        if (keyEvent.key === 'Escape' && pointerDragRef.current?.engaged) {
          keyEvent.stopPropagation();
          canceled = true;
          pointerDragRef.current = null;
          document.body.style.userSelect = '';
          setPointerDrag(null);
        }
      };
      const onUp = (upEvent: PointerEvent) => {
        if (upEvent.pointerId !== gesturePointerId) return;
        cleanup();
        if (canceled) {
          suppressReleaseClick();
          return;
        }
        endPointerDrag(true);
      };
      const onCancel = (cancelEvent: PointerEvent) => {
        if (cancelEvent.pointerId !== gesturePointerId) return;
        cleanup();
        if (!canceled) endPointerDrag(false);
      };
      const cleanup = () => {
        // Only release the slot if it is still OURS — an Escape-canceled
        // gesture's late pointerup must not clobber a newer gesture's
        // cleanup registration.
        if (activeGestureCleanupRef.current === cleanup) {
          activeGestureCleanupRef.current = null;
        }
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onCancel);
        window.removeEventListener('keydown', onKey, true);
      };
      activeGestureCleanupRef.current = cleanup;
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onCancel);
      window.addEventListener('keydown', onKey, true);
    },
    [dormant, editing, endPointerDrag]
  );

  // Unmounting mid-gesture must release the window listeners and the
  // user-select lock without committing anything through stale closures.
  useEffect(
    () => () => {
      activeGestureCleanupRef.current?.();
      pointerDragRef.current = null;
      document.body.style.userSelect = '';
    },
    []
  );

  const itemStyle = (
    entry: PresentRibbonToken,
    projectExiting: boolean
  ): CSSProperties => {
    const held = heldCloseKeys.has(entry.token.key);
    // Nothing is evicted any more, so presence alone decides visibility.
    const visible =
      (currentKeys.has(entry.token.key) && !projectExiting) || held;
    const target = layout.targets.get(entry.token.key) ??
      lastTargetsRef.current.get(entry.token.key) ?? {
        id: entry.token.key,
        x: 0,
        y: 0,
        row: 0,
        width: estimateRibbonTokenWidth(entry.token),
      };
    const leaving = entry.phase === 'exiting' || projectExiting;
    // The dragged chip tracks the pointer 1:1 — no transition, elevated,
    // slightly lifted. Siblings keep the shared eased re-targeting.
    if (pointerDrag?.engaged && pointerDrag.key === entry.token.key) {
      const dragX = Math.max(
        -8,
        Math.min(
          pointerDrag.x - pointerDrag.grabDX,
          Math.max(layout.contentWidth, containerWidth) - 24
        )
      );
      const dragY = Math.max(
        -4,
        Math.min(
          pointerDrag.y - pointerDrag.grabDY,
          stripHeight - RIBBON_ROW_HEIGHT + 4
        )
      );
      return {
        position: 'absolute',
        left: 0,
        top: 0,
        width: target.width,
        transformOrigin: 'left center',
        transform: `translate3d(${dragX}px, ${dragY}px, 0) scale(1.03)`,
        opacity: 1,
        pointerEvents: 'none',
        zIndex: 30,
        cursor: 'grabbing',
        boxShadow: `0 6px 18px ${withThemeAlpha(HUD.bg.void, 0.5)}`,
        transitionProperty: 'none',
        willChange: 'transform',
      };
    }
    return {
      position: 'absolute',
      left: 0,
      top: 0,
      // Width SNAPS while position tweens (D45). The operator ranked chips
      // stretching as one of the three motions that read as "flying"; a chip
      // that takes its new width immediately and then slides reads as
      // movement, which is the part he wants kept. A LEAVING item is the
      // exception: closing a Project is a data change, and its right-to-left
      // retraction (D37) is the one scale the ribbon still animates.
      width: target.width,
      transformOrigin: 'left center',
      transform: ribbonTargetTransform(target, leaving ? 0 : 1),
      opacity: visible && !leaving ? 1 : 0,
      pointerEvents: visible && !leaving ? 'auto' : 'none',
      zIndex: leaving ? 0 : 1,
      transitionProperty: 'transform, opacity',
      transitionDuration: reducedMotion
        ? '0ms'
        : `${RIBBON_MOTION_MS}ms, ${RIBBON_EXIT_MS}ms`,
      transitionTimingFunction: 'cubic-bezier(0.25, 1, 0.5, 1), ease-out',
      willChange: reducedMotion ? undefined : 'transform, opacity',
    };
  };

  // Mask color is alpha-only compositing syntax, not presentation paint.
  const fadeMask = layout.scrollable
    ? `linear-gradient(to right, transparent 0, #000 ${
        scrollEdges.left ? '28px' : '0'
      }, #000 calc(100% - ${
        scrollEdges.right ? '28px' : '0px'
      }), transparent 100%)`
    : undefined;

  return (
    <div
      ref={containerRef}
      data-workspace-tab-strip
      data-ordinal-hints={ordinalHints ?? undefined}
      data-ribbon-rows={layout.rows}
      data-ribbon-scrollable={layout.scrollable || undefined}
      className="relative min-w-0"
      style={{
        // One row: height is constant by construction (D45), so the
        // terminal below can never be resized by anything the ribbon does.
        height: stripHeight,
        minHeight: projects.length > 0 ? RIBBON_ROW_HEIGHT : 0,
      }}
      onPointerLeave={() => releaseHeldClose()}
    >
      <div
        ref={scrollerRef}
        data-ribbon-scroller
        className="relative h-full w-full overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        onScroll={syncScrollEdges}
        style={{
          // Edge fades stand in for the scrollbar: they say "there is more
          // this way" without spending a row on chrome, and only on the side
          // that actually has more. The mask lives HERE, not on the strip:
          // a mask paints its whole subtree, so on the outer element it
          // sliced the fixed-position context menu down to a sliver.
          maskImage: fadeMask,
          WebkitMaskImage: fadeMask,
        }}
      >
        <div
          className="relative h-full"
          style={{ width: Math.max(layout.contentWidth, containerWidth) }}
        >
      {presentTokens.map(entry => {
        const token = entry.token;
        const project = token.project;
        const color = project.color;
        const groupActive = project.dir === activeDir;
        const mode = presentationFor(project.dir);
        const folded = mode === 'folded';
        // A floating chip crosses siblings; its resting translucent wash
        // would overprint their text into mush — go opaque while lifted.
        const draggingSelf =
          pointerDrag?.engaged === true && pointerDrag.key === token.key;
        const projectExiting = exiting.has(project.dir);
        const visible = !projectExiting && entry.phase !== 'exiting';

        // A folded Project draws one counted container; its tabs are not
        // rendered at all, and the count is what keeps the work visible.
        if (token.kind === 'tab' && folded) return null;

        if (token.kind === 'project') {
          const dormantProject = dormant.has(project.dir);
          const signal = projectSignals.get(project.dir) ?? 'quiet';
          const projectMenuItems: StripMenuItem[] = [
            ...(onNewAgent
              ? [
                  {
                    label: 'New agent',
                    focusAfterSelect: 'none' as const,
                    onSelect: () => onNewAgent(project.dir),
                  },
                ]
              : []),
            {
              label: 'Rename / color…',
              focusAfterSelect: 'none',
              onSelect: () =>
                setEditing({
                  kind: 'group',
                  id: project.dir,
                  value: project.name,
                }),
            },
            ...(onRevealPath
              ? [
                  {
                    label: 'Reveal in Finder',
                    onSelect: () => onRevealPath(project.dir),
                  },
                ]
              : []),
            ...(onCloseProject
              ? [
                  {
                    label: 'Close project',
                    danger: true,
                    focusAfterSelect: 'none' as const,
                    onSelect: () => onCloseProject(project.dir),
                  },
                ]
              : []),
          ];
          const openProjectMenu = (
            trigger: HTMLElement,
            point: { x: number; y: number }
          ) =>
            openMenu({
              trigger,
              ...point,
              color,
              label: `${project.name} Project actions`,
              items: projectMenuItems,
              target: { kind: 'project', id: project.dir },
            });
          const sourceOrdinal = token.sourceProjectIndex + 1;
          // A folded Project's tabs have no chip of their own, so while ⌘ is
          // held its container carries their ordinals — the span if it holds
          // several, the single digit if it holds one. Without this, `⌘3`
          // still selects a Session that nothing on screen can point at.
          const foldedOrdinals = folded
            ? project.tabs
                .map(item => ordinalByTabId.get(item.id))
                .filter((value): value is number => value !== undefined)
                .sort((a, b) => a - b)
            : [];
          const foldedOrdinalHint =
            ordinalHints === 'tabs' && foldedOrdinals.length > 0
              ? foldedOrdinals.length === 1
                ? `${foldedOrdinals[0]}`
                : `${foldedOrdinals[0]}–${foldedOrdinals.at(-1)}`
              : null;
          return (
            <div
              ref={node => setItemNode(token.key, node)}
              key={token.key}
              data-ribbon-item="project"
              data-ribbon-key={token.key}
              data-project={project.name}
              data-project-dir={project.dir}
              data-active-project={groupActive || undefined}
              data-project-mode={mode}
              data-project-folded={folded || undefined}
              data-project-dormant={dormantProject || undefined}
              data-project-exiting={projectExiting || undefined}
              data-close-stabilized={heldCloseKeys.has(token.key) || undefined}
              inert={!visible}
              aria-hidden={!visible || undefined}
              onPointerDown={event => {
                if (projectExiting || !onReorderProject) return;
                beginPointerDrag(event, {
                  kind: 'project',
                  key: token.key,
                  id: project.dir,
                  dir: project.dir,
                });
              }}
              onClickCapture={event => {
                if (justDraggedRef.current) {
                  event.preventDefault();
                  event.stopPropagation();
                }
              }}
              onContextMenu={event => {
                event.preventDefault();
                const trigger = event.currentTarget.querySelector<HTMLElement>(
                  '[data-project-chrome]'
                );
                if (trigger) {
                  openProjectMenu(trigger, {
                    x: event.clientX,
                    y: event.clientY,
                  });
                }
              }}
              className="group/project flex h-7 origin-left items-center overflow-hidden rounded-md border"
              style={{
                ...itemStyle(entry, projectExiting),
                borderColor: groupActive
                  ? withThemeAlpha(color, 0.46)
                  : dormantProject
                    ? withThemeAlpha(HUD.textDim, 0.09)
                    : withThemeAlpha(HUD.textDim, 0.15),
                background: draggingSelf
                  ? HUD.bg.panelFill
                  : groupActive
                    ? withThemeAlpha(color, 0.07)
                    : dormantProject
                      ? withThemeAlpha(HUD.textDim, 0.018)
                      : withThemeAlpha(HUD.textDim, 0.035),
                filter: dormantProject ? 'opacity(.62)' : undefined,
              }}
            >
              <EditableChrome
                data-project-chrome
                editing={
                  editing?.kind === 'group' && editing.id === project.dir
                }
                aria-label={project.name}
                aria-current={groupActive ? 'true' : undefined}
                tabIndex={visible ? 0 : -1}
                onClick={() => onSelectProject(token.sourceProjectIndex)}
                onDoubleClick={() =>
                  setEditing({
                    kind: 'group',
                    id: project.dir,
                    value: project.name,
                  })
                }
                onKeyDown={event => {
                  if (!isContextMenuKey(event)) return;
                  event.preventDefault();
                  event.stopPropagation();
                  openProjectMenu(
                    event.currentTarget,
                    keyboardMenuPoint(event.currentTarget)
                  );
                }}
                title={`${project.dir}${
                  folded ? `\n${project.tabs.length} Sessions — select to open` : ''
                }${
                  sourceOrdinal <= 9 ? ` · ⌘⌥${sourceOrdinal} selects` : ''
                } · ${PROJECT_RIBBON_SIGNAL_COPY[signal]}`}
                className="relative flex h-full w-full cursor-pointer items-center gap-1 px-1.5 font-mono text-chrome-label font-medium outline-none transition-[filter,transform] duration-100 hover:brightness-150 active:scale-[0.97] motion-reduce:transition-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-hud-cyan"
                style={{ color: groupActive ? color : HUD.textDim }}
              >
                <span
                  aria-hidden
                  className="inline-block h-3.5 w-[3px] shrink-0 rounded-full"
                  style={{ background: color, boxShadow: `0 0 4px ${color}66` }}
                />
                {ordinalHints === 'projects' && sourceOrdinal <= 9 && (
                  <span
                    data-project-ordinal={sourceOrdinal}
                    className="contents"
                  >
                    <OrdinalKeycap value={sourceOrdinal} color={color} />
                  </span>
                )}
                {editing?.kind === 'group' && editing.id === project.dir ? (
                  <>
                    <RenameInput
                      value={editing.value}
                      color={color}
                      onChange={value => setEditing({ ...editing, value })}
                      onCommit={commitEditing}
                      onCancel={settleEditing}
                    />
                    <ColorSwatches
                      current={color}
                      onPick={next => onSetProjectColor(project.dir, next)}
                    />
                  </>
                ) : (
                  <span
                    data-project-label
                    className="min-w-0 shrink truncate whitespace-nowrap text-left"
                  >
                    {project.name}
                  </span>
                )}
                {/* The Project dot summarises its Agents, so it earns its
                    place only when those Agents are not on screen — a
                    folded Project, whose chips are not drawn. Otherwise it
                    repeats the chips beside it. An empty Project has no
                    Agents to summarise, and rendering an always-quiet mark
                    there would also mean the header CHANGED WIDTH the
                    moment its last tab closed, breaking the pointer-close
                    stability window that keeps close targets under the
                    cursor. */}
                {folded && <ProjectRibbonSignalMark signal={signal} />}
                {/* A folded Project is a container holding children: the
                    count is what keeps that work visible when its chips
                    cannot be drawn. */}
                {folded && (
                  <span
                    data-project-folded-count={project.tabs.length}
                    data-project-folded-ordinals={
                      foldedOrdinalHint ?? undefined
                    }
                    aria-label={
                      foldedOrdinalHint
                        ? `${project.tabs.length} Sessions, ⌘${foldedOrdinalHint}`
                        : `${project.tabs.length} Sessions`
                    }
                    className={`shrink-0 rounded-sm px-1 font-mono text-chrome-meta leading-none ${
                      foldedOrdinalHint ? 'border' : ''
                    }`}
                    style={{
                      color,
                      // A count and a keycap must not look alike: a folded
                      // one-Session Project would otherwise show a bare "1"
                      // under ⌘ that reads as ordinal 1, which belongs to a
                      // different Project. Ordinals wear the keycap chrome.
                      background: foldedOrdinalHint
                        ? HUD.bg.panelFill
                        : withThemeAlpha(color, 0.12),
                      borderColor: foldedOrdinalHint
                        ? withThemeAlpha(color, 0.33)
                        : undefined,
                    }}
                  >
                    {/* Hold ⌘ and a folded Project shows WHICH ordinals it
                        holds instead of how many: the tabs themselves have
                        no chip to hang a keycap on, and a reachable command
                        with no visible hint is the D44 failure in miniature. */}
                    {foldedOrdinalHint ?? project.tabs.length}
                  </span>
                )}
                {dormantProject && (
                  <span aria-hidden className="shrink-0 text-[9px] opacity-60">
                    ○
                  </span>
                )}
              </EditableChrome>
            </div>
          );
        }

        const tab = token.tab;
        const condensed = mode === 'mini';
        const on = groupActive && tab.id === project.activeTabId;
        // Chrome's rule: once tabs are shrunk, only the tab you are on
        // keeps a permanent close button — the rest reveal it on hover, so
        // ~24px goes back to the title instead of to chrome you are not
        // using. The reveal is absolutely positioned, so it costs no reflow.
        const tabWidth = layout.targets.get(token.key)?.width ?? 0;
        const tightTab = !condensed && tabWidth > 0 && tabWidth < 168;
        const floatingClose = tightTab && !on;
        const dead = !tabIsLive(tab);
        const summary = summaries[tab.durableSessionId];
        const attentionSignal =
          !dead && tab.sessionId ? attention[tab.sessionId] : undefined;
        const needsYou = attentionNeedsOperator(attentionSignal);
        const working = !dead && !!(tab.sessionId && activity[tab.sessionId]);
        const isAgent = tab.harness !== 'shell';
        const isDraft = tab.lifecycle === 'draft';
        const fault = tab.lifecycle === 'failed';
        const started =
          !!(tab.sessionId && engaged[tab.sessionId]) || !!summary;
        const tabDelegation = tab.sessionId
          ? delegation[tab.sessionId]
          : undefined;
        const glyphState = sessionGlyphState({
          working,
          agent: isAgent,
          started,
          delegatedBusy: sessionDelegationBusy(tabDelegation),
          blocked: sessionReportedBlocked(tabDelegation),
          ownTurn: tabDelegation?.ownTurn,
        });
        const display = sessionDisplayCopy({
          harness: tab.harness,
          title: tab.title,
          titleKind: tab.titleKind,
          lifecycle: tab.lifecycle,
          summary,
        });
        const ordinal = ordinalByTabId.get(tab.id);
        const stoppedStatus =
          tab.lifecycle === 'interrupted'
            ? 'Interrupted'
            : tab.lifecycle === 'failed'
              ? 'Failed'
              : tab.lifecycle === 'exited'
                ? 'Exited'
                : 'Stopped';
        const tabMenuItems: StripMenuItem[] = isDraft
          ? [
              {
                label: 'Discard',
                danger: true,
                onSelect: () => onCloseTab(tab.id),
              },
            ]
          : [
              ...(dead &&
              onResumeTab &&
              (tab.harnessSessionId || tab.harness === 'shell')
                ? [
                    {
                      label:
                        tab.harness === 'shell'
                          ? 'Start New Shell'
                          : 'Resume This Agent',
                      onSelect: () => onResumeTab(tab.id),
                    },
                  ]
                : []),
              {
                label: 'Rename…',
                focusAfterSelect: 'none',
                onSelect: () =>
                  setEditing({ kind: 'tab', id: tab.id, value: tab.title }),
              },
              ...(onCloneTab &&
              cloneTargets.length > 0 &&
              tabCanClone(tab, {
                engaged: !!(tab.sessionId && engaged[tab.sessionId]),
                contextSummary: summary,
              })
                ? [
                    {
                      label: 'Clone to…',
                      children: cloneTargets.map(target => ({
                        label: target.label,
                        onSelect: () => onCloneTab(tab.id, target.id),
                      })),
                    },
                  ]
                : []),
              ...(tabIsPinnable(tab) && onTogglePinTab
                ? [
                    {
                      label:
                        tab.id === pinnedTabId
                          ? 'Unpin from split'
                          : 'Pin in split',
                      onSelect: () => onTogglePinTab(tab.id),
                    },
                  ]
                : []),
              ...(onRevealPath
                ? [
                    {
                      label: 'Reveal in Finder',
                      onSelect: () => onRevealPath(tab.cwd),
                    },
                  ]
                : []),
              // ENG-026 N3 / ENG-033: the per-Agent Push to cloud control,
              // announced where it will really live, with the Cloud preview
              // surface's contextual entry point beside it (the ⌘K
              // preview-row pattern: real navigation, muted Coming soon).
              ...(tab.harness !== 'shell'
                ? [
                    {
                      label: 'Push to cloud',
                      announcedComing:
                        'run this Agent on an Exawatt-hosted plan (Cloud)',
                    },
                    {
                      label: 'Cloud',
                      note: 'Coming soon',
                      onSelect: () => router.push('/cloud'),
                    },
                  ]
                : []),
              {
                label: 'Close',
                danger: true,
                focusAfterSelect: 'none',
                onSelect: () => onCloseTab(tab.id),
              },
            ];
        const openTabMenu = (
          trigger: HTMLElement,
          point: { x: number; y: number }
        ) =>
          openMenu({
            trigger,
            ...point,
            color,
            label: `${display.primary} Session actions`,
            items: tabMenuItems,
            target: { kind: 'tab', id: tab.id },
          });

        return (
          <div
            ref={node => setItemNode(token.key, node)}
            key={token.key}
            data-ribbon-item="initiative"
            data-ribbon-key={token.key}
            data-project-parent={project.dir}
            data-tab-id={tab.id}
            data-tab-harness={tab.harness}
            data-tab-condensed={condensed || undefined}
            data-durable-session-id={tab.durableSessionId}
            data-active={on || undefined}
            data-close-stabilized={heldCloseKeys.has(token.key) || undefined}
            inert={!visible}
            aria-hidden={!visible || undefined}
            onPointerDown={event => {
              if (!onReorderTab) return;
              event.stopPropagation();
              beginPointerDrag(event, {
                kind: 'tab',
                key: token.key,
                id: tab.id,
                dir: project.dir,
              });
            }}
            onClickCapture={event => {
              if (justDraggedRef.current) {
                event.preventDefault();
                event.stopPropagation();
              }
            }}
            onContextMenu={event => {
              event.preventDefault();
              event.stopPropagation();
              const trigger =
                event.currentTarget.querySelector<HTMLElement>(
                  '[data-tab-chrome]'
                );
              if (trigger) {
                openTabMenu(trigger, { x: event.clientX, y: event.clientY });
              }
            }}
            className="group/tab relative flex h-7 w-max origin-left items-center overflow-hidden rounded-md border"
            style={{
              ...itemStyle(entry, projectExiting),
              borderColor: on
                ? withThemeAlpha(color, 0.61)
                : withThemeAlpha(HUD.textDim, 0.17),
              borderBottomColor: on
                ? color
                : withThemeAlpha(color, 0.22),
              background: draggingSelf
                ? HUD.bg.panelFill
                : on
                  ? withThemeAlpha(color, 0.08)
                  : withThemeAlpha(HUD.textDim, 0.035),
              filter: dead ? 'opacity(.74)' : undefined,
            }}
          >
            <EditableChrome
              data-tab-chrome
              editing={editing?.kind === 'tab' && editing.id === tab.id}
              aria-current={on ? 'true' : undefined}
              tabIndex={visible ? 0 : -1}
              onClick={() => onSelectTab(project.dir, tab.id)}
              onDoubleClick={() =>
                setEditing({ kind: 'tab', id: tab.id, value: tab.title })
              }
              onKeyDown={event => {
                if (!isContextMenuKey(event)) return;
                event.preventDefault();
                event.stopPropagation();
                openTabMenu(
                  event.currentTarget,
                  keyboardMenuPoint(event.currentTarget)
                );
              }}
              aria-label={`${display.primary}${
                display.context ? ` — ${display.context}` : ''
              } — ${
                dead
                  ? stoppedStatus.toLowerCase()
                  : needsYou
                    ? 'needs your attention'
                    : SESSION_GLYPH_LABEL[glyphState]
              }`}
              title={`${condensed ? `${display.primary}\n` : ''}${tab.cwd}${
                summary ? `\n${summary}` : ''
              }${
                needsYou ? '\nneeds your attention (⌘J jumps here)' : ''
              }${
                !dead && !needsYou ? `\n${SESSION_GLYPH_COPY[glyphState]}` : ''
              }${dead ? `\n${tab.resumeState.replace('-', ' ')}` : ''}${
                ordinal ? `\n⌘${ordinal} selects` : ''
              }\n${
                isDraft
                  ? '⏎ starts · ⌘W discards'
                  : '⌘W closes — kept in Recently closed'
              }\ndouble-click to rename`}
              className={`relative flex h-full min-w-0 flex-1 cursor-pointer items-center overflow-hidden font-mono text-chrome-title font-medium outline-none transition-transform duration-100 active:scale-[0.98] motion-reduce:transition-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-hud-cyan ${
                condensed ? 'gap-1 px-1.5' : 'gap-1.5 px-2'
              }`}
              style={{ color: on ? HUD.text : HUD.textDim }}
            >
              {ordinal !== undefined && ordinalHints === 'tabs' && (
                <span data-tab-ordinal={ordinal} className="contents">
                  <OrdinalKeycap value={ordinal} color={color} />
                </span>
              )}
              {!dead || isDraft || fault ? (
                <SessionStatusGlyph
                  state={isDraft ? 'fresh' : glyphState}
                  attention={attentionSignal}
                  delegation={tabDelegation}
                  fault={fault}
                />
              ) : null}
              {!dead && !isDraft && !condensed && (
                <DelegationDots color={color} delegation={tabDelegation} />
              )}
              {tab.id === pinnedTabId && (
                <span
                  data-pinned
                  title="Pinned in split view (⌘D unpins)"
                  className="text-[10px] leading-none"
                  style={{ color }}
                >
                  ◧
                </span>
              )}
              {/* A glyph chip carries ONE mark: what this Agent is doing.
                  The source swirl beside it read as noise at 40px and cost
                  the width that decides when Projects fold — Claude vs
                  Codex stays legible on the Project you are in, in the
                  tooltip, and in ⌘K (operator, 2026-08-03). */}
              {tab.harness !== 'shell' && !isDraft && !tightTab && !condensed && (
                <span className="shrink-0" style={{ color }}>
                  <HarnessGlyph harness={tab.harness} size={11} />
                </span>
              )}
              {editing?.kind === 'tab' && editing.id === tab.id ? (
                <>
                  <RenameInput
                    value={editing.value}
                    color={color}
                    onChange={value => setEditing({ ...editing, value })}
                    onCommit={commitEditing}
                    onCancel={settleEditing}
                  />
                  <ColorSwatches
                    current={color}
                    onPick={next => onSetProjectColor(project.dir, next)}
                  />
                </>
              ) : condensed || (dead && !isDraft && !on) ? null : (
                // A stopped unselected chip drops its title entirely (D42
                // review round, amends the D23 hover-unfurl): a reveal that
                // grows the chip feeds the width model and shifts layout —
                // identity lives in the tooltip and aria-label, exactly as
                // on condensed chips.
                <span
                  data-tab-label
                  className="block min-w-0 flex-1 truncate font-sans leading-tight"
                >
                  <span
                    data-subtitle={
                      display.primaryKind === 'context' || undefined
                    }
                  >
                    {display.primary}
                  </span>
                </span>
              )}
              {dead && !isDraft && condensed && (
                <span
                  aria-hidden
                  className="text-[9px] leading-none"
                  style={{
                    color:
                      tab.lifecycle === 'interrupted'
                        ? HUD.amber
                        : tab.lifecycle === 'failed'
                          ? HUD.red
                          : HUD.textDim,
                  }}
                >
                  ○
                </span>
              )}
              {dead && !isDraft && !condensed && (
                <span
                  aria-label={stoppedStatus}
                  className="shrink-0 border border-hud-stroke-faint px-1 py-0.5 text-chrome-meta font-medium leading-none"
                  style={{
                    color:
                      tab.lifecycle === 'interrupted'
                        ? HUD.amber
                        : tab.lifecycle === 'failed'
                          ? HUD.red
                          : HUD.textDim,
                  }}
                >
                  {stoppedStatus}
                </span>
              )}
            </EditableChrome>
            {summary && isAgent && !isDraft && !condensed && onRateContext && (
              <div
                data-ribbon-passive
                data-tab-feedback-overlay
                className="pointer-events-none absolute inset-y-0 right-7 z-10 flex items-center pl-2 opacity-0 transition-opacity duration-100 group-hover/tab:pointer-events-auto group-hover/tab:opacity-100 group-focus-within/tab:pointer-events-auto group-focus-within/tab:opacity-100 motion-reduce:transition-none"
                style={{
                  background: on
                    ? withThemeAlpha(color, 0.15)
                    : HUD.bg.panelFill,
                  boxShadow: `-10px 0 8px -4px ${
                    on ? withThemeAlpha(color, 0.15) : HUD.bg.panelFill
                  }`,
                }}
              >
                <ContextLabelFeedback
                  label={summary}
                  enabled={feedbackEnabled}
                  alwaysVisible
                  onRate={(sentiment, betterLabel) =>
                    onRateContext({
                      durableSessionId: tab.durableSessionId,
                      label: summary,
                      sentiment,
                      betterLabel,
                      projectName: project.name,
                    })
                  }
                />
              </div>
            )}
            {!condensed && (
              <button
                type="button"
                data-ribbon-passive
                tabIndex={visible ? 0 : -1}
                onPointerDown={event => {
                  if (event.button === 0) armPointerClose(token.key);
                }}
                onClick={() => onCloseTab(tab.id)}
                aria-label={`Close ${display.primary}`}
                title={
                  isDraft
                    ? 'Discard (⌘W)'
                    : 'Close — kept in Recently closed for 14 days (⌘W)'
                }
                className={`grid size-5 shrink-0 cursor-pointer place-items-center rounded font-mono text-chrome-label font-normal outline-none transition-[opacity,background-color] duration-100 hover:bg-hud-fill-hi hover:!opacity-100 focus-visible:opacity-100 motion-reduce:transition-none focus-visible:ring-1 focus-visible:ring-hud-cyan ${
                  floatingClose
                    ? 'absolute inset-y-0 right-1 my-auto opacity-0 group-hover/tab:opacity-100 group-focus-within/tab:opacity-100'
                    : 'mr-1 opacity-45 group-hover/tab:opacity-100'
                }`}
                style={{
                  color: HUD.textDim,
                  // A revealed floating close sits over the title's tail;
                  // the chip-coloured backdrop keeps both readable.
                  ...(floatingClose
                    ? {
                        background: on
                          ? withThemeAlpha(color, 0.15)
                          : HUD.bg.panelFill,
                        boxShadow: `-8px 0 8px -4px ${
                          on
                            ? withThemeAlpha(color, 0.15)
                            : HUD.bg.panelFill
                        }`,
                      }
                    : {}),
                }}
              >
                ×
              </button>
            )}
          </div>
        );
      })}
        </div>
      </div>

      {menu && (
        <StripContextMenu
          key={`${menu.target.kind}:${menu.target.id}`}
          {...menu}
          onClose={closeMenu}
        />
      )}
    </div>
  );
}
