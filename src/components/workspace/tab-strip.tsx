// No 'use client' directive: only imported by the client workspace surface.

/**
 * Grouped tab strip (ENG-002 W0.2–W0.4): projects are visual clusters —
 * a numbered, project-colored group chip (⌘⌥1..9 target) followed by its
 * tabs, all sharing the project color. W0.4: double-click a group or tab
 * name to rename it (persists with the layout), and agent tabs carry an
 * auto-summarized micro-context subtitle ("what was I working on here?").
 * One of two first-class regimes (the other: sessions as entities on the
 * ENG-004 world map) — parallel skins over the same session system.
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { HUD } from '@/components/hud';
import { PROJECT_PALETTE } from './project-colors';
import { HarnessGlyph } from './harness-icons';
import { tabIsPinnable } from './split-layout';
import { useOrdinalHints } from './use-ordinal-hints';
import { tabIsLive } from './use-workspace-state';
import {
  RENAME_ACTIVE_EVENT,
  EDIT_ACTIVE_PROJECT_EVENT,
  FOCUS_ACTIVE_TERMINAL_EVENT,
} from './session-jump';
import {
  attentionNeedsOperator,
  SESSION_GLYPH_COPY,
  SESSION_GLYPH_LABEL,
  SessionStatusGlyph,
  sessionGlyphState,
} from './status-glyphs';
import type { SessionAttentionSignal } from './status-glyphs';
import type { Project } from './use-workspace-state';
import { ContextLabelFeedback } from '@/components/feedback/context-label-feedback';
import { SessionGoalSummary } from './session-goal-summary';

/** Shortcut-ordinal keycap (D21): revealed only while the chord's modifiers
 *  are held, styled as a key so it reads as "press this", never as data.
 *  OVERLAYS its anchor (D24): revealing a hint must never shift layout —
 *  the keycap materializes over the chip's left edge instead of inserting
 *  into the row. */
function OrdinalKeycap({ value, color }: { value: number; color: string }) {
  return (
    <span
      className="pointer-events-none absolute left-1 top-1/2 z-10 inline-flex h-3.5 min-w-3.5 -translate-y-1/2 items-center justify-center rounded-sm border px-0.5 font-mono text-chrome-micro leading-none motion-safe:animate-in motion-safe:fade-in motion-safe:duration-100"
      style={{
        color,
        borderColor: `${color}55`,
        background: 'rgba(8,13,22,0.92)',
      }}
    >
      {value}
    </span>
  );
}

interface Editing {
  kind: 'group' | 'tab';
  id: string;
  value: string;
}

function RenameInput({
  value,
  color,
  onChange,
  onCommit,
  onCancel,
}: {
  value: string;
  color: string;
  onChange: (v: string) => void;
  onCommit: () => void;
  onCancel: () => void;
}) {
  // Escape unmounts the focused input, and the browser fires blur on
  // removal — without this flag that blur would COMMIT the abandoned edit
  const settled = useRef(false);
  return (
    <input
      value={value}
      autoFocus
      aria-label="Rename"
      // rename semantics: the old name arrives selected, so typing replaces
      // it — without this, ⌘E + typing APPENDS ("Shellbeta scratch")
      onFocus={e => e.currentTarget.select()}
      onChange={e => onChange(e.target.value)}
      onBlur={() => {
        if (!settled.current) onCommit();
      }}
      onKeyDown={e => {
        e.stopPropagation();
        if (e.key === 'Enter') {
          settled.current = true;
          onCommit();
        }
        if (e.key === 'Escape') {
          settled.current = true;
          onCancel();
        }
      }}
      onClick={e => e.stopPropagation()}
      className="w-28 bg-transparent font-mono text-chrome-title font-medium outline-none"
      style={{ color, borderBottom: `1px solid ${color}99` }}
    />
  );
}

/** elegant inline palette: appears with the rename editor; mousedown (not
 *  click) so choosing a color never blurs/commits the text edit */
function ColorSwatches({
  current,
  onPick,
}: {
  current: string;
  onPick: (color: string) => void;
}) {
  return (
    <span className="ml-1.5 inline-flex items-center gap-1">
      {PROJECT_PALETTE.map(c => (
        <button
          key={c}
          aria-label={`Set project color ${c}`}
          onMouseDown={e => {
            e.preventDefault();
            e.stopPropagation();
            onPick(c);
          }}
          className="h-3 w-3 rounded-full transition-transform hover:scale-125"
          style={{
            background: c,
            boxShadow:
              c === current ? `0 0 0 1.5px #fff, 0 0 6px ${c}` : 'none',
          }}
        />
      ))}
    </span>
  );
}

/** Group pill / tab chrome. While its rename editor is open it renders as a
 *  `div`: the editor's input and swatch buttons must not be interactive
 *  elements nested inside a `<button>` (invalid HTML — React hydration
 *  warning, found by the spine eval's renderer error capture). */
function EditableChrome({
  editing,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { editing: boolean }) {
  return editing ? (
    <div {...(props as React.HTMLAttributes<HTMLDivElement>)} />
  ) : (
    <button type="button" {...props} />
  );
}

function isContextMenuKey(event: React.KeyboardEvent): boolean {
  return event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey);
}

function keyboardMenuPoint(element: HTMLElement): { x: number; y: number } {
  const rect = element.getBoundingClientRect();
  return { x: rect.left + Math.min(24, rect.width / 2), y: rect.bottom + 2 };
}

/** right-click menu (D27): HUD-styled, keyboard-navigable (↑↓ ⏎ esc);
 *  every item is an existing verb — the menu is discovery, not new power */
export interface StripMenuItem {
  label: string;
  onSelect: () => void;
  /** the destructive item sits last and reads in the project color */
  danger?: boolean;
}

function StripContextMenu({
  x,
  y,
  color,
  label,
  items,
  onClose,
}: {
  x: number;
  y: number;
  color: string;
  label: string;
  items: StripMenuItem[];
  onClose: (restoreFocus?: boolean) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  // a right-click near the window edge must not spill the menu off-screen
  const [pos, setPos] = useState({ x, y });
  useLayoutEffect(() => {
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect) return;
    setPos({
      x: Math.min(x, Math.max(4, window.innerWidth - rect.width - 4)),
      y: Math.min(y, Math.max(4, window.innerHeight - rect.height - 4)),
    });
  }, [x, y]);
  useEffect(() => {
    rootRef.current?.querySelector('button')?.focus();
    const away = (event: MouseEvent) => {
      if (!(event.target instanceof Node)) return;
      if (!rootRef.current?.contains(event.target)) onClose(false);
    };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [onClose]);
  return (
    <div
      ref={rootRef}
      data-strip-menu
      role="menu"
      aria-label={label}
      className="fixed z-50 flex min-w-44 flex-col rounded border py-1 shadow-2xl motion-safe:animate-in motion-safe:fade-in motion-safe:duration-100"
      style={{
        left: pos.x,
        top: pos.y,
        borderColor: `${color}44`,
        background: HUD.bg.panelFill,
        boxShadow: `0 12px 32px rgba(0,0,0,0.55), 0 0 10px ${color}22`,
      }}
      onKeyDown={e => {
        e.stopPropagation();
        if (e.key === 'Escape') {
          e.preventDefault();
          onClose(true);
          return;
        }
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          const buttons = Array.from(
            rootRef.current?.querySelectorAll('button') ?? []
          );
          const index = buttons.indexOf(
            document.activeElement as HTMLButtonElement
          );
          const step = e.key === 'ArrowDown' ? 1 : buttons.length - 1;
          buttons[(index + step) % buttons.length]?.focus();
        }
      }}
    >
      {items.map(item => (
        <button
          key={item.label}
          type="button"
          role="menuitem"
          onClick={() => {
            onClose(false);
            item.onSelect();
          }}
          className="cursor-pointer px-3 py-1.5 text-left font-mono text-chrome-label outline-none transition-[background-color] duration-75 hover:bg-white/10 focus-visible:bg-white/10"
          style={{ color: item.danger ? color : HUD.text }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

export function TabStrip({
  projects,
  activeDir,
  pinnedTabId,
  summaries,
  attention,
  activity = {},
  engaged = {},
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
  feedbackEnabled = false,
  onRateContext,
  exitingProjectDirs,
}: {
  projects: Project[];
  activeDir: string | null;
  /** tab pinned in the split view (S2); null = no split */
  pinnedTabId: string | null;
  /** goal subtitles keyed by durableSessionId (D21) — stopped tabs keep
   *  theirs, so a restored tab still says what it was driving toward */
  summaries: Record<string, string>;
  /** needs-operator flags keyed by sessionId (S1; S8 adds
   *  roadmap-derived entries — only presence and recency matter here) */
  attention: Record<string, SessionAttentionSignal>;
  /** sessions actively producing output, keyed by sessionId (D18) */
  activity?: Record<string, boolean>;
  /** sessions ever given work, keyed by sessionId (D22) */
  engaged?: Record<string, boolean>;
  /** context-menu verbs (D27) — all optional; items appear when wired */
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
  feedbackEnabled?: boolean;
  onRateContext?: (input: {
    durableSessionId: string;
    label: string;
    sentiment: -1 | 1;
    betterLabel?: string | null;
    projectName: string;
  }) => Promise<boolean>;
  /** drag arrangement (D20): drop a tab beside a same-Project sibling */
  onReorderTab?: (
    tabId: string,
    targetTabId: string,
    place: 'before' | 'after'
  ) => void;
  /** drag arrangement (D20): drop a Project group beside another */
  onReorderProject?: (
    dir: string,
    targetDir: string,
    place: 'before' | 'after'
  ) => void;
  /** Projects retract right-to-left before leaving the open workspace. */
  exitingProjectDirs?: ReadonlySet<string>;
}) {
  const [editing, setEditing] = useState<Editing | null>(null);
  // right-click menu (D27)
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    color: string;
    label: string;
    items: StripMenuItem[];
  } | null>(null);
  const menuTriggerRef = useRef<HTMLElement | null>(null);
  const openMenu = useCallback(
    ({
      trigger,
      x,
      y,
      color,
      label,
      items,
    }: {
      trigger: HTMLElement;
      x: number;
      y: number;
      color: string;
      label: string;
      items: StripMenuItem[];
    }) => {
      menuTriggerRef.current = trigger;
      setMenu({ x, y, color, label, items });
    },
    []
  );
  const closeMenu = useCallback((restoreFocus = false) => {
    const trigger = menuTriggerRef.current;
    menuTriggerRef.current = null;
    setMenu(null);
    if (restoreFocus && trigger) {
      queueMicrotask(() => {
        if (trigger.isConnected) trigger.focus();
      });
    }
  }, []);
  // D21: ordinals are shortcut hints — the strip rests clean; holding ⌘
  // reveals tab keycaps, ⌘⌥ reveals Project keycaps
  const ordinalHints = useOrdinalHints();

  // ⌘E edits the active tab; the palette's Project verb opens the same
  // Project name/color editor exposed by its context menu.
  const activeRef = useRef({ projects, activeDir });
  activeRef.current = { projects, activeDir };
  useEffect(() => {
    const onRenameActive = () => {
      const { projects: gs, activeDir: ad } = activeRef.current;
      const g = gs.find(x => x.dir === ad);
      const tab = g?.tabs.find(t => t.id === g.activeTabId);
      if (tab) setEditing({ kind: 'tab', id: tab.id, value: tab.title });
    };
    const onEditProject = () => {
      const { projects: gs, activeDir: ad } = activeRef.current;
      const group = gs.find(project => project.dir === ad);
      if (group) {
        setEditing({ kind: 'group', id: group.dir, value: group.name });
      }
    };
    window.addEventListener(RENAME_ACTIVE_EVENT, onRenameActive);
    window.addEventListener(EDIT_ACTIVE_PROJECT_EVENT, onEditProject);
    return () => {
      window.removeEventListener(RENAME_ACTIVE_EVENT, onRenameActive);
      window.removeEventListener(EDIT_ACTIVE_PROJECT_EVENT, onEditProject);
    };
  }, []);

  /** editor closed (commit or cancel) — hand the keyboard back to the
   *  active terminal so the all-keyboard flow keeps flowing */
  const settle = () => {
    setEditing(null);
    window.dispatchEvent(new CustomEvent(FOCUS_ACTIVE_TERMINAL_EVENT));
  };

  const commit = () => {
    if (!editing) return;
    if (editing.kind === 'group') onRenameProject(editing.id, editing.value);
    else onRenameTab(editing.id, editing.value);
    settle();
  };

  // global ring ordinals (⌘digit targets): ⌘1–8 are positional and ⌘9 is
  // the LAST tab, like Chrome (D27) — with more than nine tabs the last
  // tab wears the 9 keycap. Computed always, revealed while ⌘ held (D21).
  const ordinalByTabId = new Map<string, number>();
  {
    const allTabs = projects.flatMap(g => g.tabs);
    allTabs.slice(0, 8).forEach((t, i) => ordinalByTabId.set(t.id, i + 1));
    if (allTabs.length >= 9) {
      ordinalByTabId.set(allTabs[allTabs.length - 1].id, 9);
    }
  }

  // ── Drag arrangement (D20): order is an interface. Tabs move within
  // their Project (grouping is directory truth); Project groups move
  // globally. Keyboard equivalents: ⌘⌥[/] and ⌘⌥⇧[/].
  const [drag, setDrag] = useState<{
    kind: 'tab' | 'project';
    id: string;
    dir: string;
  } | null>(null);
  const [hint, setHint] = useState<{
    key: string;
    place: 'before' | 'after';
  } | null>(null);
  const endDrag = () => {
    setDrag(null);
    setHint(null);
  };
  const dropPlace = (e: React.DragEvent): 'before' | 'after' => {
    const rect = e.currentTarget.getBoundingClientRect();
    return e.clientX < rect.left + rect.width / 2 ? 'before' : 'after';
  };
  const hintShadow = (key: string, color: string): string | undefined =>
    hint?.key === key
      ? hint.place === 'before'
        ? `inset 3px 0 0 0 ${color}`
        : `inset -3px 0 0 0 ${color}`
      : undefined;

  return (
    <div
      data-workspace-tab-strip
      data-ordinal-hints={ordinalHints ?? undefined}
      className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5"
    >
      {projects.map((g, gi) => {
        const color = g.color;
        const groupActive = g.dir === activeDir;
        const projectExiting = exitingProjectDirs?.has(g.dir) ?? false;
        const projectMenuItems: StripMenuItem[] = [
          ...(onNewAgent
            ? [
                {
                  label: 'New agent',
                  onSelect: () => onNewAgent(g.dir),
                },
              ]
            : []),
          {
            label: 'Rename / color…',
            onSelect: () =>
              setEditing({ kind: 'group', id: g.dir, value: g.name }),
          },
          ...(onRevealPath
            ? [
                {
                  label: 'Reveal in Finder',
                  onSelect: () => onRevealPath(g.dir),
                },
              ]
            : []),
          ...(onCloseProject
            ? [
                {
                  label: 'Close project',
                  danger: true,
                  onSelect: () => onCloseProject(g.dir),
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
            label: `${g.name} Project actions`,
            items: projectMenuItems,
          });
        return (
          <div
            key={g.dir}
            data-project={g.name}
            data-active-project={groupActive || undefined}
            data-project-exiting={projectExiting || undefined}
            draggable={!editing && !projectExiting}
            onDragStart={e => {
              // a drag born on a tab wrapper is the TAB's drag
              if (
                e.target instanceof Element &&
                e.target.closest('[data-tab-id]')
              ) {
                return;
              }
              e.dataTransfer.effectAllowed = 'move';
              setDrag({ kind: 'project', id: g.dir, dir: g.dir });
            }}
            onDragEnd={endDrag}
            onContextMenu={e => {
              e.preventDefault();
              const trigger = e.currentTarget.querySelector<HTMLElement>(
                '[data-project-chrome]'
              );
              if (trigger) {
                openProjectMenu(trigger, { x: e.clientX, y: e.clientY });
              }
            }}
            onDragOver={e => {
              if (drag?.kind !== 'project' || drag.id === g.dir) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              setHint({ key: `p:${g.dir}`, place: dropPlace(e) });
            }}
            onDragLeave={() =>
              setHint(h => (h?.key === `p:${g.dir}` ? null : h))
            }
            onDrop={e => {
              if (drag?.kind !== 'project' || drag.id === g.dir) return;
              e.preventDefault();
              onReorderProject?.(drag.id, g.dir, dropPlace(e));
              endDrag();
            }}
            className={`flex origin-left items-center gap-1 rounded border px-1 py-0.5 transition-[transform,opacity,filter] duration-[240ms] [transition-timing-function:cubic-bezier(0.25,1,0.5,1)] motion-reduce:transition-none ${
              projectExiting ? 'pointer-events-none scale-x-0' : ''
            }`}
            style={{
              boxShadow: hintShadow(`p:${g.dir}`, color),
              opacity: projectExiting
                ? 0
                : drag?.kind === 'project' && drag.id === g.dir
                  ? 0.5
                  : 1,
              borderColor: groupActive
                ? `${color}66`
                : 'rgba(138,160,190,0.12)',
              background: groupActive ? `${color}0d` : 'transparent',
            }}
          >
            <EditableChrome
              data-project-chrome
              editing={editing?.kind === 'group' && editing.id === g.dir}
              onClick={() => onSelectProject(gi)}
              onDoubleClick={() =>
                setEditing({ kind: 'group', id: g.dir, value: g.name })
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
              title={`${g.dir}${
                gi < 9 ? ` · ⌘⌥${gi + 1} selects` : ''
              } · double-click to rename`}
              className="relative flex cursor-pointer items-center gap-1.5 rounded px-1.5 py-0.5 font-mono text-chrome-label font-medium outline-none transition-[filter,transform] duration-100 hover:brightness-150 active:scale-95 motion-reduce:transition-none focus-visible:ring-1 focus-visible:ring-hud-cyan"
              style={{ color: groupActive ? color : HUD.textDim }}
            >
              <span
                aria-hidden
                className="inline-block h-3.5 w-[3px] shrink-0 rounded-full"
                style={{ background: color, boxShadow: `0 0 4px ${color}88` }}
              />
              {ordinalHints === 'projects' && gi < 9 && (
                <span data-project-ordinal={gi + 1} className="contents">
                  <OrdinalKeycap value={gi + 1} color={color} />
                </span>
              )}
              {editing?.kind === 'group' && editing.id === g.dir ? (
                <>
                  <RenameInput
                    value={editing.value}
                    color={color}
                    onChange={v => setEditing({ ...editing, value: v })}
                    onCommit={commit}
                    onCancel={settle}
                  />
                  <ColorSwatches
                    current={color}
                    onPick={c => onSetProjectColor(g.dir, c)}
                  />
                </>
              ) : (
                <span data-project-label>{g.name}</span>
              )}
            </EditableChrome>
            {g.tabs.map(t => {
              const on = groupActive && t.id === g.activeTabId;
              const dead = !tabIsLive(t);
              const summary = summaries[t.durableSessionId];
              const attentionSignal =
                !dead && t.sessionId ? attention[t.sessionId] : undefined;
              const needsYou = attentionNeedsOperator(attentionSignal);
              const working = !dead && !!(t.sessionId && activity[t.sessionId]);
              const isAgent = t.harness !== 'shell';
              // ⌘T draft (D24): a new-tab chip — no process, no badge,
              // fresh ring, discarded without ceremony
              const isDraft = t.lifecycle === 'draft';
              const fault = t.lifecycle === 'failed';
              // started: main-truth engaged bit; a goal subtitle also
              // implies it (covers sessions predating the engaged channel)
              const started =
                !!(t.sessionId && engaged[t.sessionId]) || !!summary;
              const glyphState = sessionGlyphState({
                working,
                agent: isAgent,
                started,
              });
              // Catalog labels describe a conversation in the browser; they
              // are not tab names. The harness glyph owns default identity,
              // while only an explicit rename earns primary title copy.
              // Drafts and shells keep their labels because neither has the
              // normal live-Agent identity treatment.
              const showTitle =
                isDraft || !isAgent || t.titleKind === 'operator';
              const ordinal = ordinalByTabId.get(t.id);
              const stoppedStatus =
                t.lifecycle === 'interrupted'
                  ? 'Interrupted'
                  : t.lifecycle === 'failed'
                    ? 'Failed'
                    : t.lifecycle === 'exited'
                      ? 'Exited'
                      : 'Stopped';
              const tabMenuItems: StripMenuItem[] = isDraft
                ? [
                    {
                      label: 'Discard',
                      danger: true,
                      onSelect: () => onCloseTab(t.id),
                    },
                  ]
                : [
                    ...(dead &&
                    onResumeTab &&
                    (t.harnessSessionId || t.harness === 'shell')
                      ? [
                          {
                            label:
                              t.harness === 'shell'
                                ? 'Start New Shell'
                                : 'Resume This Agent',
                            onSelect: () => onResumeTab(t.id),
                          },
                        ]
                      : []),
                    {
                      label: 'Rename…',
                      onSelect: () =>
                        setEditing({
                          kind: 'tab',
                          id: t.id,
                          value: t.title,
                        }),
                    },
                    // D26 doctrine: stopped tabs pin fine (the split shows
                    // retained history); only drafts have nothing to watch.
                    ...(tabIsPinnable(t) && onTogglePinTab
                      ? [
                          {
                            label:
                              t.id === pinnedTabId
                                ? 'Unpin from split'
                                : 'Pin in split',
                            onSelect: () => onTogglePinTab(t.id),
                          },
                        ]
                      : []),
                    ...(onRevealPath
                      ? [
                          {
                            label: 'Reveal in Finder',
                            onSelect: () => onRevealPath(t.cwd),
                          },
                        ]
                      : []),
                    {
                      label: 'Close',
                      danger: true,
                      onSelect: () => onCloseTab(t.id),
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
                  label: `${t.title} Session actions`,
                  items: tabMenuItems,
                });
              return (
                <div
                  key={t.id}
                  data-tab-id={t.id}
                  data-active={on || undefined}
                  draggable={!editing}
                  onDragStart={e => {
                    e.stopPropagation();
                    e.dataTransfer.effectAllowed = 'move';
                    setDrag({ kind: 'tab', id: t.id, dir: g.dir });
                  }}
                  onDragEnd={e => {
                    e.stopPropagation();
                    endDrag();
                  }}
                  onContextMenu={e => {
                    e.preventDefault();
                    e.stopPropagation();
                    const trigger =
                      e.currentTarget.querySelector<HTMLElement>(
                        '[data-tab-chrome]'
                      );
                    if (trigger) {
                      openTabMenu(trigger, { x: e.clientX, y: e.clientY });
                    }
                  }}
                  onDragOver={e => {
                    if (
                      drag?.kind !== 'tab' ||
                      drag.dir !== g.dir ||
                      drag.id === t.id
                    ) {
                      return;
                    }
                    e.preventDefault();
                    e.stopPropagation();
                    e.dataTransfer.dropEffect = 'move';
                    setHint({ key: `t:${t.id}`, place: dropPlace(e) });
                  }}
                  onDragLeave={() =>
                    setHint(h => (h?.key === `t:${t.id}` ? null : h))
                  }
                  onDrop={e => {
                    if (
                      drag?.kind !== 'tab' ||
                      drag.dir !== g.dir ||
                      drag.id === t.id
                    ) {
                      return;
                    }
                    e.preventDefault();
                    e.stopPropagation();
                    onReorderTab?.(drag.id, t.id, dropPlace(e));
                    endDrag();
                  }}
                  className="group/tab relative flex items-center overflow-hidden rounded border transition-[border-color,background-color,filter] duration-150 hover:brightness-125 motion-reduce:transition-none"
                  style={{
                    boxShadow: hintShadow(`t:${t.id}`, color),
                    borderColor: on ? `${color}99` : 'rgba(138,160,190,0.18)',
                    background: on ? `${color}14` : 'rgba(138,160,190,0.04)',
                    opacity:
                      drag?.kind === 'tab' && drag.id === t.id
                        ? 0.5
                        : dead
                          ? 0.72
                          : 1,
                  }}
                >
                  <EditableChrome
                    data-tab-chrome
                    editing={editing?.kind === 'tab' && editing.id === t.id}
                    onClick={() => onSelectTab(g.dir, t.id)}
                    onDoubleClick={() =>
                      setEditing({ kind: 'tab', id: t.id, value: t.title })
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
                    // a glyph-only tab (hidden default title) would otherwise
                    // take its accessible name from the tooltip — give it a
                    // real one: harness, goal, state (D22)
                    aria-label={
                      showTitle
                        ? undefined
                        : `${t.title}${summary ? ` — ${summary}` : ''} — ${
                            dead
                              ? stoppedStatus.toLowerCase()
                              : needsYou
                                ? 'needs your attention'
                                : SESSION_GLYPH_LABEL[glyphState]
                          }`
                    }
                    className="flex cursor-pointer items-center gap-1.5 px-2 py-1 font-mono text-chrome-title font-medium outline-none transition-transform duration-100 active:scale-[0.97] motion-reduce:transition-none focus-visible:ring-1 focus-visible:ring-hud-cyan"
                    style={{ color: on ? HUD.text : HUD.textDim }}
                    title={`${t.cwd}${summary ? `\n${summary}` : ''}${
                      needsYou ? '\nneeds your attention (⌘J jumps here)' : ''
                    }${
                      !dead && !needsYou
                        ? `\n${SESSION_GLYPH_COPY[glyphState]}`
                        : ''
                    }${
                      dead ? `\n${t.resumeState.replace('-', ' ')}` : ''
                    }${ordinal ? `\n⌘${ordinal} selects` : ''}\n${
                      isDraft
                        ? '⏎ starts · ⌘W discards'
                        : '⌘W closes — kept in Recently closed'
                    }\ndouble-click to rename`}
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
                        fault={fault}
                      />
                    ) : null}
                    {t.id === pinnedTabId && (
                      <span
                        data-pinned
                        title="Pinned in split view (⌘D unpins)"
                        className="text-[10px] leading-none"
                        style={{ color }}
                      >
                        ◧
                      </span>
                    )}
                    {t.harness !== 'shell' && !isDraft && (
                      <span style={{ color }}>
                        <HarnessGlyph harness={t.harness} size={11} />
                      </span>
                    )}
                    {editing?.kind === 'tab' && editing.id === t.id ? (
                      <>
                        <RenameInput
                          value={editing.value}
                          color={color}
                          onChange={v => setEditing({ ...editing, value: v })}
                          onCommit={commit}
                          onCancel={settle}
                        />
                        <ColorSwatches
                          current={color}
                          onPick={c => onSetProjectColor(g.dir, c)}
                        />
                      </>
                    ) : showTitle || summary ? (
                      // stopped tabs condense to a frozen chip (D23):
                      // the text folds away until hover/focus unfurls it —
                      // light collapse, never auto-close (operator design
                      // pass). Active stopped tabs stay unfurled: their
                      // restore panel is on screen.
                      <span
                        data-condensed={(dead && !isDraft && !on) || undefined}
                        className={`flex flex-col items-start overflow-hidden transition-[max-width,opacity] duration-200 motion-reduce:transition-none ${
                          dead && !isDraft && !on
                            ? 'max-w-0 opacity-0 group-hover/tab:max-w-60 group-hover/tab:opacity-100 group-focus-within/tab:max-w-60 group-focus-within/tab:opacity-100'
                            : 'max-w-60'
                        }`}
                      >
                        {showTitle && (
                          <span className="whitespace-nowrap leading-tight">
                            {t.title}
                          </span>
                        )}
                        {/* the goal is durable (D21): stopped tabs keep it */}
                        {summary && (
                          <SessionGoalSummary
                            summary={summary}
                            color={color}
                            className="max-w-56"
                          />
                        )}
                      </span>
                    ) : null}
                    {dead && !isDraft && (
                      <span
                        aria-label={stoppedStatus}
                        className="border border-white/10 px-1 py-0.5 text-chrome-meta font-medium leading-none"
                        style={{
                          color:
                            t.lifecycle === 'interrupted'
                              ? HUD.amber
                              : t.lifecycle === 'failed'
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
                          durableSessionId: t.durableSessionId,
                          label: summary,
                          sentiment,
                          betterLabel,
                          projectName: g.name,
                        })
                      }
                    />
                  )}
                  <button
                    onClick={() => onCloseTab(t.id)}
                    // ⌘W closes, like Chrome (D24): started live agents
                    // get one native confirm; drafts and fresh tabs discard
                    aria-label={`Close ${t.title}`}
                    title={
                      isDraft
                        ? 'Discard (⌘W)'
                        : 'Close — kept in Recently closed for 14 days (⌘W)'
                    }
                    className="cursor-pointer px-1 py-0.5 font-mono text-chrome-label font-normal opacity-50 outline-none transition-opacity duration-100 group-hover/tab:opacity-100 hover:!opacity-100 focus-visible:opacity-100 motion-reduce:transition-none focus-visible:ring-1 focus-visible:ring-hud-cyan"
                    style={{ color: HUD.textDim }}
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>
        );
      })}
      {menu && <StripContextMenu {...menu} onClose={closeMenu} />}
    </div>
  );
}
