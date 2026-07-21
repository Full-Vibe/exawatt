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
import { useEffect, useRef, useState } from 'react';
import { HUD } from '@/components/hud';
import { PROJECT_PALETTE } from './project-colors';
import { HarnessGlyph } from './harness-icons';
import { isDefaultHarnessTitle } from './harnesses';
import { useOrdinalHints } from './use-ordinal-hints';
import { tabIsLive } from './use-workspace-state';
import {
  RENAME_ACTIVE_EVENT,
  FOCUS_ACTIVE_TERMINAL_EVENT,
} from './session-jump';
import {
  AttentionDot,
  SESSION_GLYPH_COPY,
  SESSION_GLYPH_LABEL,
  SessionStatusGlyph,
  sessionGlyphState,
} from './status-glyphs';
import type { Project } from './use-workspace-state';

/** Shortcut-ordinal keycap (D21): revealed only while the chord's modifiers
 *  are held, styled as a key so it reads as "press this", never as data. */
function OrdinalKeycap({ value, color }: { value: number; color: string }) {
  return (
    <span
      className="inline-flex h-3.5 min-w-3.5 shrink-0 items-center justify-center rounded-sm border px-0.5 font-mono text-[9px] leading-none"
      style={{
        color,
        borderColor: `${color}55`,
        background: 'rgba(8,13,22,0.85)',
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
      className="w-28 bg-transparent font-mono text-xs outline-none"
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

export function TabStrip({
  projects,
  activeDir,
  pinnedTabId,
  summaries,
  attention,
  activity = {},
  engaged = {},
  onReorderTab,
  onReorderProject,
  onSelectProject,
  onSelectTab,
  onCloseTab,
  onRenameTab,
  onRenameProject,
  onSetProjectColor,
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
  attention: Record<string, { since: number }>;
  /** sessions actively producing output, keyed by sessionId (D18) */
  activity?: Record<string, boolean>;
  /** sessions ever given work, keyed by sessionId (D22) */
  engaged?: Record<string, boolean>;
  onSelectProject: (index: number) => void;
  onSelectTab: (dir: string, tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onRenameTab: (tabId: string, title: string) => void;
  onRenameProject: (dir: string, name: string) => void;
  onSetProjectColor: (dir: string, color: string) => void;
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
}) {
  const [editing, setEditing] = useState<Editing | null>(null);
  // D21: ordinals are shortcut hints — the strip rests clean; holding ⌘
  // reveals tab keycaps, ⌘⌥ reveals Project keycaps
  const ordinalHints = useOrdinalHints();

  // ⌘E (S2): open the inline rename editor for the ACTIVE tab — the event
  // comes from the workspace key layer; a ref carries the latest props into
  // the stable listener
  const activeRef = useRef({ projects, activeDir });
  activeRef.current = { projects, activeDir };
  useEffect(() => {
    const onRenameActive = () => {
      const { projects: gs, activeDir: ad } = activeRef.current;
      const g = gs.find(x => x.dir === ad);
      const tab = g?.tabs.find(t => t.id === g.activeTabId);
      if (tab) setEditing({ kind: 'tab', id: tab.id, value: tab.title });
    };
    window.addEventListener(RENAME_ACTIVE_EVENT, onRenameActive);
    return () =>
      window.removeEventListener(RENAME_ACTIVE_EVENT, onRenameActive);
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

  // global ring ordinals for the first nine tabs (⌘1–⌘9 targets, D18):
  // computed always, revealed only while ⌘ is held (D21)
  const ordinalByTabId = new Map<string, number>();
  {
    let ordinal = 0;
    for (const g of projects) {
      for (const t of g.tabs) {
        ordinal += 1;
        if (ordinal > 9) break;
        ordinalByTabId.set(t.id, ordinal);
      }
      if (ordinal > 9) break;
    }
  }

  // ── Drag arrangement (D20): order is an interface. Tabs move within
  // their Project (grouping is directory truth); Project groups move
  // globally. Keyboard equivalents: ⌘⌥[/] and ⌘⌥⇧[/].
  const [drag, setDrag] = useState<
    { kind: 'tab' | 'project'; id: string; dir: string } | null
  >(null);
  const [hint, setHint] = useState<
    { key: string; place: 'before' | 'after' } | null
  >(null);
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
        const flaggedCount = g.tabs.filter(
          t => t.sessionId && attention[t.sessionId] && tabIsLive(t)
        ).length;
        return (
          <div
            key={g.dir}
            data-project={g.name}
            data-active-project={groupActive || undefined}
            draggable={!editing}
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
            className="flex items-center gap-1 rounded border px-1 py-0.5"
            style={{
              boxShadow: hintShadow(`p:${g.dir}`, color),
              opacity: drag?.kind === 'project' && drag.id === g.dir ? 0.5 : 1,
              borderColor: groupActive
                ? `${color}66`
                : 'rgba(138,160,190,0.12)',
              background: groupActive ? `${color}0d` : 'transparent',
            }}
          >
            <EditableChrome
              editing={editing?.kind === 'group' && editing.id === g.dir}
              onClick={() => onSelectProject(gi)}
              onDoubleClick={() =>
                setEditing({ kind: 'group', id: g.dir, value: g.name })
              }
              title={`${g.dir}${
                gi < 9 ? ` · ⌘⌥${gi + 1} selects` : ''
              } · double-click to rename`}
              className="flex cursor-pointer items-center gap-1.5 rounded px-1.5 py-0.5 font-mono text-[11px] outline-none transition-[filter,transform] duration-100 hover:brightness-150 active:scale-95 motion-reduce:transition-none focus-visible:ring-1 focus-visible:ring-hud-cyan"
              style={{ color: groupActive ? color : HUD.textDim }}
            >
              <span
                className="inline-block h-2 w-2 rotate-45"
                style={{ background: color, boxShadow: `0 0 5px ${color}` }}
              />
              {ordinalHints === 'projects' && gi < 9 && (
                <span data-project-ordinal={gi + 1} className="inline-flex">
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
                g.name
              )}
              {flaggedCount > 0 && (
                // a COUNT badge, visually distinct from shortcut ordinals
                // (D21): pill-shaped, amber like the attention dot it tallies
                <span
                  data-attention-count={flaggedCount}
                  title={`${flaggedCount} ${
                    flaggedCount === 1 ? 'session needs' : 'sessions need'
                  } you (⌘J jumps there)`}
                  className="inline-flex min-w-[15px] items-center justify-center rounded-full px-1 py-px font-mono text-[9px] leading-none"
                  style={{
                    color: HUD.amber,
                    background: 'rgba(255,184,77,0.14)',
                    border: '1px solid rgba(255,184,77,0.4)',
                  }}
                >
                  {flaggedCount}
                </span>
              )}
            </EditableChrome>
            {g.tabs.map(t => {
              const on = groupActive && t.id === g.activeTabId;
              const dead = !tabIsLive(t);
              const summary = summaries[t.durableSessionId];
              const needsYou =
                !dead && !!(t.sessionId && attention[t.sessionId]);
              const working =
                !dead && !!(t.sessionId && activity[t.sessionId]);
              const isAgent = t.harness !== 'shell';
              // started: main-truth engaged bit; a goal subtitle also
              // implies it (covers sessions predating the engaged channel)
              const started =
                !!(t.sessionId && engaged[t.sessionId]) || !!summary;
              const glyphState = sessionGlyphState({
                working,
                agent: isAgent,
                started,
              });
              // the harness glyph already carries source identity — a
              // default title ("Claude Code") is pure redundancy, so agent
              // tabs stay glyph-only until a rename or subtitle (D22);
              // shells keep theirs (no glyph)
              const showTitle = !(
                isAgent && isDefaultHarnessTitle(t.harness, t.title)
              );
              const ordinal = ordinalByTabId.get(t.id);
              const stoppedStatus =
                t.lifecycle === 'interrupted'
                  ? 'Interrupted'
                  : t.lifecycle === 'failed'
                    ? 'Failed'
                    : t.lifecycle === 'exited'
                      ? 'Exited'
                      : 'Stopped';
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
                  className="group/tab flex items-center overflow-hidden rounded border transition-[border-color,background-color,filter] duration-150 hover:brightness-125 motion-reduce:transition-none"
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
                    editing={editing?.kind === 'tab' && editing.id === t.id}
                    onClick={() => onSelectTab(g.dir, t.id)}
                    onDoubleClick={() =>
                      setEditing({ kind: 'tab', id: t.id, value: t.title })
                    }
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
                    className="flex cursor-pointer items-center gap-1.5 px-2 py-1 font-mono text-xs outline-none transition-transform duration-100 active:scale-[0.97] motion-reduce:transition-none focus-visible:ring-1 focus-visible:ring-hud-cyan"
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
                      dead
                        ? '⌘W closes — kept in Recently closed'
                        : '⌘W stops — the tab stays'
                    }\ndouble-click to rename`}
                  >
                    {ordinal !== undefined && ordinalHints === 'tabs' && (
                      <span data-tab-ordinal={ordinal} className="inline-flex">
                        <OrdinalKeycap
                          value={ordinal}
                          color={on ? color : HUD.textDim}
                        />
                      </span>
                    )}
                    {needsYou ? (
                      <AttentionDot />
                    ) : !dead ? (
                      <SessionStatusGlyph state={glyphState} />
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
                    {t.harness !== 'shell' && (
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
                        data-condensed={(dead && !on) || undefined}
                        className={`flex flex-col items-start overflow-hidden transition-[max-width,opacity] duration-200 motion-reduce:transition-none ${
                          dead && !on
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
                          <span
                            data-subtitle
                            className="line-clamp-2 max-w-56 text-left font-sans text-[11px] leading-4"
                            style={{ color: `${color}B0` }}
                          >
                            {summary}
                          </span>
                        )}
                      </span>
                    ) : null}
                    {dead && (
                      <span
                        aria-label={stoppedStatus}
                        className="border border-white/10 px-1 py-0.5 text-[9px] leading-none"
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
                  <button
                    onClick={() => onCloseTab(t.id)}
                    // D23 grammar: live tabs STOP (park in place); stopped
                    // tabs CLOSE into the Recently-closed ledger
                    aria-label={`${dead ? 'Close' : 'Stop'} ${t.title}`}
                    title={
                      dead
                        ? 'Close — kept in Recently closed for 14 days (⌘W)'
                        : 'Stop — the tab stays, resumable (⌘W)'
                    }
                    className="cursor-pointer px-1 py-0.5 font-mono text-xs opacity-40 outline-none transition-opacity duration-100 group-hover/tab:opacity-100 hover:!opacity-100 focus-visible:opacity-100 motion-reduce:transition-none focus-visible:ring-1 focus-visible:ring-hud-cyan"
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
    </div>
  );
}
