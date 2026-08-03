// No 'use client' directive: only imported by the client workspace surface.

/**
 * Elastic Project / Initiative ribbon.
 *
 * Projects keep manual order; selected and explicitly disclosed Projects
 * expose their Initiative-shaped Session tabs as independent layout atoms.
 * The pure layout module owns admission and target bounds, the presence module
 * owns interruption-safe entry/exit, and this component owns interaction.
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
import { HUD } from '@/components/hud';
import { ContextLabelFeedback } from '@/components/feedback/context-label-feedback';
import { usePrefersReducedMotion } from '@/lib/motion/use-prefers-reduced-motion';
import type { SessionDelegation } from '@/types/electron';
import { HarnessGlyph } from './harness-icons';
import {
  layoutProjectRibbon,
  orderProjectsForRibbon,
  RIBBON_ROW_GAP,
  RIBBON_ROW_HEIGHT,
  ribbonHeightForRows,
  stableRibbonRows,
  type RibbonTarget,
} from './project-ribbon-layout';
import {
  DRAG_THRESHOLD_PX,
  dropIndexForPointer,
  placementForOrder,
  reorderTokensForProjectDrag,
  reorderTokensForTabDrag,
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
import {
  EDIT_ACTIVE_PROJECT_EVENT,
  FOCUS_ACTIVE_TERMINAL_EVENT,
  OPEN_OVERVIEW_EVENT,
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
 * Ribbon token order and admission priority (D42). Every Project's tabs are
 * ALWAYS tokens — inactive Projects' tabs condense to glyph chips instead of
 * unmounting, so per-Agent state, tab count, and ordinal-hint anchors survive
 * collapse. Admission: the active Project's own work outranks every inactive
 * Project's chrome, so your own next tab can never be invisible while another
 * Project's chrome is.
 *
 *   0 active Project header
 *   1 active tab
 *   2 active Project's remaining tabs
 *   3 inactive Project headers with fault / needs-you
 *   4 other inactive Project headers
 *   5 inactive tabs that need the operator
 *   6 other inactive tabs
 */
export function buildRibbonTokens({
  orderedProjects,
  projects,
  activeDir,
  projectSignals,
  attention,
  reserveDeadExpansion = false,
}: {
  orderedProjects: readonly Project[];
  projects: readonly Project[];
  activeDir: string | null;
  projectSignals: ReadonlyMap<string, string>;
  attention: Record<string, SessionAttentionSignal>;
  /** Height-model only: treat every dead tab of the ACTIVE Project as
   *  uncollapsed, so no `activeTabId` choice inside that Project can need
   *  more rows than the variant reserved (a tab click is a pure selection
   *  change and must never resize the terminal). */
  reserveDeadExpansion?: boolean;
}): RibbonToken[] {
  const next: RibbonToken[] = [];
  orderedProjects.forEach(project => {
    const sourceProjectIndex = projects.findIndex(
      candidate => candidate.dir === project.dir
    );
    const activeProject = project.dir === activeDir;
    const signal = projectSignals.get(project.dir) ?? 'quiet';
    next.push({
      key: `project:${project.dir}`,
      kind: 'project',
      project,
      sourceProjectIndex,
      priority: activeProject
        ? 0
        : signal === 'fault' || signal === 'needs-you'
          ? 3
          : 4,
    });
    const condensed = !activeProject && project.ribbonExpanded !== true;
    project.tabs.forEach(tab => {
      const needsYou =
        !!tab.sessionId && attentionNeedsOperator(attention[tab.sessionId]);
      const selected = activeProject && tab.id === project.activeTabId;
      next.push({
        key: `tab:${tab.id}`,
        kind: 'tab',
        project,
        tab,
        condensed,
        // mirrors the render-time dead-chip condition exactly: the height
        // model must know this width differs between selection states
        titleCollapsed:
          !condensed &&
          !tabIsLive(tab) &&
          tab.lifecycle !== 'draft' &&
          !selected &&
          !(reserveDeadExpansion && activeProject),
        priority: selected ? 1 : activeProject ? 2 : needsYou ? 5 : 6,
      });
    });
  });
  return next;
}

/**
 * A token's rendered width depends on more than its identity: condensed
 * chips, dead collapsed-title chips, and full tabs are three different
 * widths for the same tab. Measurements are cached PER PRESENTATION so the
 * height model's inputs cannot flip between measured and estimated when the
 * selection changes (that flip was itself a height-instability source).
 */
export function ribbonTokenPresentation(token: RibbonToken): string {
  return token.kind === 'tab'
    ? `${token.condensed === true}|${token.titleCollapsed === true}`
    : 'project';
}

const FALLBACK_RIBBON_WIDTH = 900;
const EMPTY_SET: ReadonlySet<string> = new Set();
const EMPTY_ACTIVITY: Record<string, boolean> = {};
const EMPTY_DELEGATION: Record<string, SessionDelegation> = {};

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
  onToggleProjectExpanded,
  feedbackEnabled = false,
  onRateContext,
  exitingProjectDirs,
  dormantProjectDirs,
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
  onNewAgent?: (dir: string) => void;
  onCloseProject?: (dir: string) => void;
  onRevealPath?: (cwd: string) => void;
  onSelectProject: (index: number) => void;
  onSelectTab: (dir: string, tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onRenameTab: (tabId: string, title: string) => void;
  onRenameProject: (dir: string, name: string) => void;
  onSetProjectColor: (dir: string, color: string) => void;
  onToggleProjectExpanded?: (dir: string) => void;
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
  const itemNodesRef = useRef(new Map<string, HTMLDivElement>());
  const lastTargetsRef = useRef(new Map<string, RibbonTarget>());
  const [containerWidth, setContainerWidth] = useState(FALLBACK_RIBBON_WIDTH);
  /** key → presentation → measured width (see ribbonTokenPresentation) */
  const [itemWidths, setItemWidths] = useState<
    Record<string, Record<string, number>>
  >({});
  const presentationByKeyRef = useRef(new Map<string, string>());
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
    layout: ReturnType<typeof layoutProjectRibbon>;
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
    () =>
      buildRibbonTokens({
        orderedProjects,
        projects,
        activeDir,
        projectSignals,
        attention,
      }),
    [activeDir, attention, orderedProjects, projectSignals, projects]
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
  // Which presentation each rendered node currently wears — the measurement
  // path files widths under this so no presentation's cache is poisoned by
  // another's DOM size.
  presentationByKeyRef.current = new Map(
    presentTokens.map(entry => [
      entry.token.key,
      ribbonTokenPresentation(entry.token),
    ])
  );
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
  const layout = useMemo(
    () =>
      layoutProjectRibbon(
        layoutEntries.map(entry => ({
          id: entry.token.key,
          width:
            itemWidths[entry.token.key]?.[
              ribbonTokenPresentation(entry.token)
            ] ?? estimateRibbonTokenWidth(entry.token),
          priority: entry.token.priority,
          parentId:
            entry.token.kind === 'tab'
              ? `project:${entry.token.project.dir}`
              : undefined,
          groupId: entry.token.project.dir,
        })),
        containerWidth
      ),
    [containerWidth, itemWidths, layoutEntries]
  );

  // The strip's outer height is SELECTION-INVARIANT (D42): reserve the rows
  // the tallest hypothetical selection needs, so switching Projects or tabs
  // can never resize the terminal below. Each variant reads its OWN
  // presentation's cached measurement (falling back to the estimate), so the
  // width inputs do not change with the current selection; and dead tabs of
  // the hypothetically active Project are reserved uncollapsed so no
  // activeTabId choice can exceed the reservation.
  const stableRows = useMemo(() => {
    const liveProjects = projects.filter(
      project => !exiting.has(project.dir)
    );
    const variants = liveProjects.map(candidate => {
      // Selecting a dormant Project un-dorms it (it returns to its manual
      // slot), and packing is order-sensitive — each hypothetical must
      // model the order its own selection would produce.
      const dormantForVariant = dormant.has(candidate.dir)
        ? new Set([...dormant].filter(dir => dir !== candidate.dir))
        : dormant;
      return buildRibbonTokens({
        orderedProjects: orderProjectsForRibbon(
          liveProjects,
          dormantForVariant
        ),
        projects,
        activeDir: candidate.dir,
        projectSignals,
        attention,
        reserveDeadExpansion: true,
      }).map(token => ({
        id: token.key,
        width:
          itemWidths[token.key]?.[ribbonTokenPresentation(token)] ??
          estimateRibbonTokenWidth(token),
        priority: token.priority,
        parentId:
          token.kind === 'tab' ? `project:${token.project.dir}` : undefined,
        groupId: token.project.dir,
      }));
    });
    return stableRibbonRows(variants, containerWidth);
  }, [
    attention,
    containerWidth,
    dormant,
    exiting,
    itemWidths,
    projectSignals,
    projects,
  ]);
  const stripRows = Math.max(stableRows, layout.rows);
  const stripHeight = ribbonHeightForRows(stripRows);

  useLayoutEffect(() => {
    for (const [key, target] of layout.targets) {
      lastTargetsRef.current.set(key, target);
    }
  }, [layout]);

  // Measurements and last-known bounds intentionally outlive removal for the
  // exit animation, but not forever. Long-running workspaces can churn through
  // thousands of Sessions; prune both caches once presence has released them.
  useEffect(() => {
    const presentKeys = new Set(presentTokens.map(entry => entry.token.key));
    for (const key of lastTargetsRef.current.keys()) {
      if (!presentKeys.has(key)) lastTargetsRef.current.delete(key);
    }
    setItemWidths(current => {
      const entries = Object.entries(current).filter(([key]) =>
        presentKeys.has(key)
      );
      return entries.length === Object.keys(current).length
        ? current
        : Object.fromEntries(entries);
    });
  }, [presentTokens]);

  const measure = useCallback(() => {
    const width = containerRef.current?.clientWidth ?? 0;
    if (width > 0)
      setContainerWidth(current => (current === width ? current : width));
    const measured: Record<string, [string, number]> = {};
    for (const [key, node] of itemNodesRef.current) {
      const presentation = presentationByKeyRef.current.get(key);
      if (!presentation) continue;
      const itemWidth = Math.ceil(node.offsetWidth);
      if (itemWidth > 0) measured[key] = [presentation, itemWidth];
    }
    if (Object.keys(measured).length > 0) {
      setItemWidths(current => {
        const changed = Object.entries(measured).some(
          ([key, [presentation, value]]) =>
            current[key]?.[presentation] !== value
        );
        if (!changed) return current;
        const next = { ...current };
        for (const [key, [presentation, value]] of Object.entries(measured)) {
          next[key] = { ...next[key], [presentation]: value };
        }
        return next;
      });
    }
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
      const rect = containerRef.current?.getBoundingClientRect();
      const node = itemNodesRef.current.get(params.key);
      if (!rect || !node) return;
      const nodeRect = node.getBoundingClientRect();
      const gesturePointerId = event.pointerId;
      const start = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
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
        const bounds = containerRef.current?.getBoundingClientRect();
        if (!active || !bounds) return;
        const x = moveEvent.clientX - bounds.left;
        const y = moveEvent.clientY - bounds.top;
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
          index = dropIndexForPointer(
            centers,
            { x, y },
            RIBBON_ROW_HEIGHT + RIBBON_ROW_GAP
          );
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
    const logicallyCurrent =
      currentKeys.has(entry.token.key) && !projectExiting;
    const visible =
      (logicallyCurrent || held) && layout.visibleIds.has(entry.token.key);
    const target = layout.targets.get(entry.token.key) ??
      lastTargetsRef.current.get(entry.token.key) ?? {
        id: entry.token.key,
        x: 0,
        y: 0,
        row: 0,
        width:
          itemWidths[entry.token.key]?.[
            ribbonTokenPresentation(entry.token)
          ] ?? estimateRibbonTokenWidth(entry.token),
      };
    const leaving = entry.phase === 'exiting' || projectExiting;
    // The dragged chip tracks the pointer 1:1 — no transition, elevated,
    // slightly lifted. Siblings keep the shared eased re-targeting.
    if (pointerDrag?.engaged && pointerDrag.key === entry.token.key) {
      const dragX = Math.max(
        -8,
        Math.min(pointerDrag.x - pointerDrag.grabDX, containerWidth - 24)
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
        transformOrigin: 'left center',
        transform: `translate3d(${dragX}px, ${dragY}px, 0) scale(1.03)`,
        opacity: 1,
        pointerEvents: 'none',
        zIndex: 30,
        cursor: 'grabbing',
        boxShadow: '0 6px 18px rgba(0,0,0,0.5)',
        transitionProperty: 'none',
        willChange: 'transform',
      };
    }
    return {
      position: 'absolute',
      left: 0,
      top: 0,
      transformOrigin: 'left center',
      transform: ribbonTargetTransform(
        target,
        leaving ? 0 : entry.phase === 'entering' ? 0.96 : 1
      ),
      opacity: visible && !leaving && entry.phase !== 'entering' ? 1 : 0,
      pointerEvents: visible && !leaving ? 'auto' : 'none',
      zIndex: leaving ? 0 : 1,
      transitionProperty: 'transform, opacity, filter',
      transitionDuration: reducedMotion
        ? '0ms'
        : `${RIBBON_MOTION_MS}ms, ${RIBBON_EXIT_MS}ms, 100ms`,
      transitionTimingFunction:
        'cubic-bezier(0.25, 1, 0.5, 1), ease-out, ease-out',
      willChange: reducedMotion ? undefined : 'transform, opacity',
    };
  };

  const hiddenCurrentCount = tokens.filter(
    token =>
      !exiting.has(token.project.dir) && !layout.visibleIds.has(token.key)
  ).length;

  return (
    <div
      ref={containerRef}
      data-workspace-tab-strip
      data-ordinal-hints={ordinalHints ?? undefined}
      data-ribbon-rows={layout.rows}
      data-ribbon-stable-rows={stripRows}
      data-ribbon-hidden={hiddenCurrentCount || undefined}
      className="relative min-w-0 overflow-hidden"
      style={{
        // Never a height transition (D42): height moves only on data changes
        // and SNAPS, so the terminal below absorbs exactly one resize per
        // real change and zero per Project switch.
        height: stripHeight,
        minHeight: projects.length > 0 ? RIBBON_ROW_HEIGHT : 0,
      }}
      onPointerLeave={() => releaseHeldClose()}
    >
      {presentTokens.map(entry => {
        const token = entry.token;
        const project = token.project;
        const color = project.color;
        const groupActive = project.dir === activeDir;
        // A floating chip crosses siblings; its resting translucent wash
        // would overprint their text into mush — go opaque while lifted.
        const draggingSelf =
          pointerDrag?.engaged === true && pointerDrag.key === token.key;
        const projectExiting = exiting.has(project.dir);
        const visible =
          !projectExiting &&
          layout.visibleIds.has(token.key) &&
          entry.phase !== 'exiting';

        if (token.kind === 'project') {
          const expanded = groupActive || project.ribbonExpanded === true;
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
            ...(onToggleProjectExpanded && project.tabs.length > 0
              ? [
                  {
                    label:
                      project.ribbonExpanded === true
                        ? 'Collapse when inactive'
                        : 'Keep expanded',
                    onSelect: () => onToggleProjectExpanded(project.dir),
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
          return (
            <div
              ref={node => setItemNode(token.key, node)}
              key={token.key}
              data-ribbon-item="project"
              data-ribbon-key={token.key}
              data-project={project.name}
              data-project-dir={project.dir}
              data-active-project={groupActive || undefined}
              data-ribbon-expanded={expanded}
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
              className="group/project flex h-7 w-max origin-left items-center overflow-hidden rounded-md border"
              style={{
                ...itemStyle(entry, projectExiting),
                borderColor: groupActive
                  ? `${color}76`
                  : dormantProject
                    ? 'rgba(138,160,190,0.09)'
                    : 'rgba(138,160,190,0.15)',
                background: draggingSelf
                  ? HUD.bg.panelFill
                  : groupActive
                    ? `${color}12`
                    : dormantProject
                      ? 'rgba(138,160,190,0.018)'
                      : 'rgba(138,160,190,0.035)',
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
                  sourceOrdinal <= 9 ? ` · ⌘⌥${sourceOrdinal} selects` : ''
                } · ${PROJECT_RIBBON_SIGNAL_COPY[signal]}`}
                className="relative flex h-full cursor-pointer items-center gap-1.5 px-2 font-mono text-chrome-label font-medium outline-none transition-[filter,transform] duration-100 hover:brightness-150 active:scale-[0.97] motion-reduce:transition-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-hud-cyan"
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
                    className="max-w-36 truncate whitespace-nowrap"
                  >
                    {project.name}
                  </span>
                )}
                <ProjectRibbonSignalMark signal={signal} />
                <span
                  aria-hidden
                  className="text-[9px]"
                  style={{ opacity: dormantProject ? 0.6 : 0 }}
                >
                  ○
                </span>
              </EditableChrome>
              {onToggleProjectExpanded && (
                <button
                  type="button"
                  data-ribbon-passive
                  disabled={project.tabs.length === 0}
                  aria-hidden={project.tabs.length === 0 || undefined}
                  tabIndex={visible && project.tabs.length > 0 ? 0 : -1}
                  aria-label={
                    project.ribbonExpanded === true
                      ? `Collapse ${project.name} when inactive`
                      : `Keep ${project.name} expanded when inactive`
                  }
                  title={
                    project.tabs.length === 0
                      ? undefined
                      : project.ribbonExpanded === true
                        ? 'Collapse when inactive'
                        : 'Keep expanded when inactive'
                  }
                  onClick={event => {
                    event.stopPropagation();
                    onToggleProjectExpanded(project.dir);
                  }}
                  className={`mr-0.5 grid size-6 place-items-center rounded outline-none opacity-45 transition-opacity hover:bg-white/8 hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-1 focus-visible:ring-hud-cyan ${
                    project.tabs.length === 0 ? 'invisible' : ''
                  }`}
                  style={{ color }}
                >
                  <span aria-hidden className="text-[9px] leading-none">
                    {project.ribbonExpanded === true ? '◆' : '◇'}
                  </span>
                </button>
              )}
            </div>
          );
        }

        const tab = token.tab;
        const condensed = token.condensed === true;
        const on = groupActive && tab.id === project.activeTabId;
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
            className="group/tab flex h-7 w-max origin-left items-center overflow-hidden rounded-md border"
            style={{
              ...itemStyle(entry, projectExiting),
              borderColor: on ? `${color}9c` : 'rgba(138,160,190,0.17)',
              borderBottomColor: on ? color : `${color}38`,
              background: draggingSelf
                ? HUD.bg.panelFill
                : on
                  ? `${color}15`
                  : 'rgba(138,160,190,0.035)',
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
              className={`relative flex h-full min-w-0 cursor-pointer items-center font-mono text-chrome-title font-medium outline-none transition-transform duration-100 active:scale-[0.98] motion-reduce:transition-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-hud-cyan ${
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
              {tab.harness !== 'shell' && !isDraft && (
                <span
                  className={`shrink-0 ${condensed ? 'opacity-55' : ''}`}
                  style={{ color }}
                >
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
                <span className="block max-w-52 overflow-hidden whitespace-nowrap font-sans leading-tight">
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
                  className="shrink-0 border border-white/10 px-1 py-0.5 text-chrome-meta font-medium leading-none"
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
              <span data-ribbon-passive className="contents">
                <ContextLabelFeedback
                  label={summary}
                  enabled={feedbackEnabled}
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
              </span>
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
                className="mr-0.5 grid size-6 shrink-0 cursor-pointer place-items-center rounded font-mono text-chrome-label font-normal opacity-45 outline-none transition-[opacity,background-color] duration-100 group-hover/tab:opacity-100 hover:bg-white/8 hover:!opacity-100 focus-visible:opacity-100 motion-reduce:transition-none focus-visible:ring-1 focus-visible:ring-hud-cyan"
                style={{ color: HUD.textDim }}
              >
                ×
              </button>
            )}
          </div>
        );
      })}

      {layout.overflowTarget && hiddenCurrentCount > 0 && (
        <button
          type="button"
          data-ribbon-overflow={hiddenCurrentCount}
          aria-label={`Open overview for ${hiddenCurrentCount} more ${
            hiddenCurrentCount === 1 ? 'item' : 'items'
          }`}
          title={`${hiddenCurrentCount} more Projects or Initiatives · open overview`}
          onClick={() =>
            window.dispatchEvent(new CustomEvent(OPEN_OVERVIEW_EVENT))
          }
          className="absolute left-0 top-0 z-[2] grid h-7 cursor-pointer place-items-center rounded-md border px-2 font-mono text-chrome-label outline-none transition-[transform,background-color] hover:bg-white/10 focus-visible:ring-1 focus-visible:ring-hud-cyan"
          style={{
            minWidth: layout.overflowTarget.width,
            transform: ribbonTargetTransform(layout.overflowTarget),
            color: HUD.textMono,
            borderColor: 'rgba(138,160,190,0.2)',
            background: 'rgba(138,160,190,0.055)',
            transitionDuration: reducedMotion ? '0ms' : `${RIBBON_MOTION_MS}ms`,
            transitionTimingFunction: 'cubic-bezier(0.25, 1, 0.5, 1)',
          }}
        >
          +{hiddenCurrentCount}
        </button>
      )}

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
