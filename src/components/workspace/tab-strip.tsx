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
import { HUD } from '@/components/hud';
import { ContextLabelFeedback } from '@/components/feedback/context-label-feedback';
import { usePrefersReducedMotion } from '@/lib/motion/use-prefers-reduced-motion';
import type { SessionDelegation } from '@/types/electron';
import { HarnessGlyph } from './harness-icons';
import {
  layoutProjectRibbon,
  orderProjectsForRibbon,
  RIBBON_ROW_HEIGHT,
  type RibbonTarget,
} from './project-ribbon-layout';
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
  type SessionAttentionSignal,
} from './status-glyphs';
import { useOrdinalHints } from './use-ordinal-hints';
import { tabIsLive, type Project } from './use-workspace-state';

interface Editing {
  kind: 'group' | 'tab';
  id: string;
  value: string;
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
  const [itemWidths, setItemWidths] = useState<Record<string, number>>({});
  const [heldCloseKeys, setHeldCloseKeys] = useState<Set<string>>(
    () => new Set()
  );
  const heldCloseTimers = useRef(
    new Map<string, ReturnType<typeof setTimeout>>()
  );
  const [drag, setDrag] = useState<{
    kind: 'tab' | 'project';
    id: string;
    dir: string;
  } | null>(null);
  const [hint, setHint] = useState<{
    key: string;
    place: 'before' | 'after';
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
  const tokens = useMemo<RibbonToken[]>(() => {
    const next: RibbonToken[] = [];
    orderedProjects.forEach(project => {
      const sourceProjectIndex = projects.findIndex(
        candidate => candidate.dir === project.dir
      );
      const activeProject = project.dir === activeDir;
      const projectSignal = projectSignals.get(project.dir) ?? 'quiet';
      next.push({
        key: `project:${project.dir}`,
        kind: 'project',
        project,
        sourceProjectIndex,
        priority: activeProject
          ? 0
          : projectSignal === 'fault' || projectSignal === 'needs-you'
            ? 2
            : 3,
      });
      if (activeProject || project.ribbonExpanded === true) {
        project.tabs.forEach(tab =>
          next.push({
            key: `tab:${tab.id}`,
            kind: 'tab',
            project,
            tab,
            priority:
              activeProject && tab.id === project.activeTabId
                ? 1
                : activeProject
                  ? 4
                  : 5,
          })
        );
      }
    });
    return next;
  }, [activeDir, orderedProjects, projectSignals, projects]);
  const presentTokens = useRibbonPresence(tokens, heldCloseKeys);
  const currentKeys = useMemo(
    () => new Set(tokens.map(token => token.key)),
    [tokens]
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
            itemWidths[entry.token.key] ??
            estimateRibbonTokenWidth(entry.token),
          priority: entry.token.priority,
        })),
        containerWidth
      ),
    [containerWidth, itemWidths, layoutEntries]
  );

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
    const measured: Record<string, number> = {};
    for (const [key, node] of itemNodesRef.current) {
      const itemWidth = Math.ceil(node.offsetWidth);
      if (itemWidth > 0) measured[key] = itemWidth;
    }
    if (Object.keys(measured).length > 0) {
      setItemWidths(current => {
        const changed = Object.entries(measured).some(
          ([key, value]) => current[key] !== value
        );
        return changed ? { ...current, ...measured } : current;
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

  const endDrag = () => {
    setDrag(null);
    setHint(null);
  };
  const dropPlace = (event: React.DragEvent): 'before' | 'after' => {
    const rect = event.currentTarget.getBoundingClientRect();
    return event.clientX < rect.left + rect.width / 2 ? 'before' : 'after';
  };
  const hintShadow = (key: string, color: string): string | undefined =>
    hint?.key === key
      ? hint.place === 'before'
        ? `inset 3px 0 0 0 ${color}`
        : `inset -3px 0 0 0 ${color}`
      : undefined;

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
          itemWidths[entry.token.key] ?? estimateRibbonTokenWidth(entry.token),
      };
    const leaving = entry.phase === 'exiting' || projectExiting;
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
      data-ribbon-hidden={hiddenCurrentCount || undefined}
      className="relative min-w-0 overflow-hidden"
      style={{
        height: layout.height,
        minHeight: projects.length > 0 ? RIBBON_ROW_HEIGHT : 0,
        transition: reducedMotion
          ? 'none'
          : `height ${RIBBON_MOTION_MS}ms cubic-bezier(0.25, 1, 0.5, 1)`,
      }}
      onPointerLeave={() => releaseHeldClose()}
    >
      {presentTokens.map(entry => {
        const token = entry.token;
        const project = token.project;
        const color = project.color;
        const groupActive = project.dir === activeDir;
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
              draggable={!editing && !projectExiting}
              onDragStart={event => {
                event.dataTransfer.effectAllowed = 'move';
                setDrag({
                  kind: 'project',
                  id: project.dir,
                  dir: project.dir,
                });
              }}
              onDragEnd={endDrag}
              onDragOver={event => {
                if (drag?.kind !== 'project' || drag.id === project.dir) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = 'move';
                setHint({ key: `p:${project.dir}`, place: dropPlace(event) });
              }}
              onDragLeave={() =>
                setHint(current =>
                  current?.key === `p:${project.dir}` ? null : current
                )
              }
              onDrop={event => {
                if (drag?.kind !== 'project' || drag.id === project.dir) return;
                event.preventDefault();
                onReorderProject?.(drag.id, project.dir, dropPlace(event));
                endDrag();
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
                background: groupActive
                  ? `${color}12`
                  : dormantProject
                    ? 'rgba(138,160,190,0.018)'
                    : 'rgba(138,160,190,0.035)',
                boxShadow: hintShadow(`p:${project.dir}`, color),
                filter:
                  drag?.kind === 'project' && drag.id === project.dir
                    ? 'opacity(.5)'
                    : dormantProject
                      ? 'opacity(.62)'
                      : undefined,
              }}
            >
              <EditableChrome
                data-project-chrome
                editing={
                  editing?.kind === 'group' && editing.id === project.dir
                }
                aria-label={project.name}
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
            data-durable-session-id={tab.durableSessionId}
            data-active={on || undefined}
            data-close-stabilized={heldCloseKeys.has(token.key) || undefined}
            inert={!visible}
            aria-hidden={!visible || undefined}
            draggable={!editing}
            onDragStart={event => {
              event.stopPropagation();
              event.dataTransfer.effectAllowed = 'move';
              setDrag({ kind: 'tab', id: tab.id, dir: project.dir });
            }}
            onDragEnd={event => {
              event.stopPropagation();
              endDrag();
            }}
            onDragOver={event => {
              if (
                drag?.kind !== 'tab' ||
                drag.dir !== project.dir ||
                drag.id === tab.id
              ) {
                return;
              }
              event.preventDefault();
              event.stopPropagation();
              event.dataTransfer.dropEffect = 'move';
              setHint({ key: `t:${tab.id}`, place: dropPlace(event) });
            }}
            onDragLeave={() =>
              setHint(current =>
                current?.key === `t:${tab.id}` ? null : current
              )
            }
            onDrop={event => {
              if (
                drag?.kind !== 'tab' ||
                drag.dir !== project.dir ||
                drag.id === tab.id
              ) {
                return;
              }
              event.preventDefault();
              event.stopPropagation();
              onReorderTab?.(drag.id, tab.id, dropPlace(event));
              endDrag();
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
              boxShadow: hintShadow(`t:${tab.id}`, color),
              borderColor: on ? `${color}9c` : 'rgba(138,160,190,0.17)',
              borderBottomColor: on ? color : `${color}38`,
              background: on ? `${color}15` : 'rgba(138,160,190,0.035)',
              filter:
                drag?.kind === 'tab' && drag.id === tab.id
                  ? 'opacity(.5)'
                  : dead
                    ? 'opacity(.74)'
                    : undefined,
            }}
          >
            <EditableChrome
              data-tab-chrome
              editing={editing?.kind === 'tab' && editing.id === tab.id}
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
              title={`${tab.cwd}${summary ? `\n${summary}` : ''}${
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
              className="relative flex h-full min-w-0 cursor-pointer items-center gap-1.5 px-2 font-mono text-chrome-title font-medium outline-none transition-transform duration-100 active:scale-[0.98] motion-reduce:transition-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-hud-cyan"
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
              {!dead && !isDraft && (
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
              ) : (
                <span
                  data-condensed={(dead && !isDraft && !on) || undefined}
                  className={`block overflow-hidden whitespace-nowrap font-sans leading-tight transition-[max-width,opacity] duration-200 motion-reduce:transition-none ${
                    dead && !isDraft && !on
                      ? 'max-w-0 opacity-0 group-hover/tab:max-w-52 group-hover/tab:opacity-100 group-focus-within/tab:max-w-52 group-focus-within/tab:opacity-100'
                      : 'max-w-52'
                  }`}
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
              {dead && !isDraft && (
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
            {summary && isAgent && !isDraft && onRateContext && (
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
            )}
            <button
              type="button"
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
