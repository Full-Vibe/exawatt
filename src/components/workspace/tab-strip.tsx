// No 'use client' directive: only imported by the client workspace surface.

/**
 * Grouped tab strip (ENG-002 W0.2–W0.4): initiatives are visual clusters —
 * a numbered, project-colored group chip (⌘1..9 target) followed by its
 * tabs, all sharing the project color. W0.4: double-click a group or tab
 * name to rename it (persists with the layout), and agent tabs carry an
 * auto-summarized micro-context subtitle ("what was I working on here?").
 * One of two first-class regimes (the other: sessions as entities on the
 * ENG-004 world map) — parallel skins over the same session system.
 */
import { useRef, useState } from 'react';
import { HUD } from '@/components/hud';
import { PROJECT_PALETTE } from './project-colors';
import { HarnessGlyph } from './harness-icons';
import { REVIVE_FAILED } from './use-workspace-state';
import type { Initiative } from './use-workspace-state';

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
      onChange={(e) => onChange(e.target.value)}
      onBlur={() => {
        if (!settled.current) onCommit();
      }}
      onKeyDown={(e) => {
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
      onClick={(e) => e.stopPropagation()}
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
      {PROJECT_PALETTE.map((c) => (
        <button
          key={c}
          aria-label={`Set project color ${c}`}
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onPick(c);
          }}
          className="h-3 w-3 rounded-full transition-transform hover:scale-125"
          style={{
            background: c,
            boxShadow: c === current ? `0 0 0 1.5px #fff, 0 0 6px ${c}` : 'none',
          }}
        />
      ))}
    </span>
  );
}

export function TabStrip({
  initiatives,
  activeDir,
  summaries,
  onSelectInitiative,
  onSelectTab,
  onCloseTab,
  onRenameTab,
  onRenameInitiative,
  onSetInitiativeColor,
}: {
  initiatives: Initiative[];
  activeDir: string | null;
  /** micro-context subtitles keyed by sessionId */
  summaries: Record<string, string>;
  onSelectInitiative: (index: number) => void;
  onSelectTab: (dir: string, tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onRenameTab: (tabId: string, title: string) => void;
  onRenameInitiative: (dir: string, name: string) => void;
  onSetInitiativeColor: (dir: string, color: string) => void;
}) {
  const [editing, setEditing] = useState<Editing | null>(null);

  const commit = () => {
    if (!editing) return;
    if (editing.kind === 'group') onRenameInitiative(editing.id, editing.value);
    else onRenameTab(editing.id, editing.value);
    setEditing(null);
  };

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
      {initiatives.map((g, gi) => {
        const color = g.color;
        const groupActive = g.dir === activeDir;
        return (
          <div
            key={g.dir}
            data-initiative={g.name}
            data-active-initiative={groupActive || undefined}
            className="flex items-center gap-1 rounded border px-1 py-0.5"
            style={{
              borderColor: groupActive ? `${color}66` : 'rgba(138,160,190,0.12)',
              background: groupActive ? `${color}0d` : 'transparent',
            }}
          >
            <button
              onClick={() => onSelectInitiative(gi)}
              onDoubleClick={() =>
                setEditing({ kind: 'group', id: g.dir, value: g.name })
              }
              title={`${g.dir} · double-click to rename`}
              className="flex items-center gap-1.5 rounded px-1.5 py-0.5 font-mono text-[11px] outline-none focus-visible:ring-1 focus-visible:ring-hud-cyan"
              style={{ color: groupActive ? color : HUD.textDim }}
            >
              <span
                className="inline-block h-2 w-2 rotate-45"
                style={{ background: color, boxShadow: `0 0 5px ${color}` }}
              />
              {gi + 1}{' '}
              {editing?.kind === 'group' && editing.id === g.dir ? (
                <>
                  <RenameInput
                    value={editing.value}
                    color={color}
                    onChange={(v) => setEditing({ ...editing, value: v })}
                    onCommit={commit}
                    onCancel={() => setEditing(null)}
                  />
                  <ColorSwatches
                    current={color}
                    onPick={(c) => onSetInitiativeColor(g.dir, c)}
                  />
                </>
              ) : (
                g.name
              )}
            </button>
            {g.tabs.map((t) => {
              const on = groupActive && t.id === g.activeTabId;
              const dead = t.exitCode !== null;
              const summary = t.sessionId ? summaries[t.sessionId] : undefined;
              return (
                <div
                  key={t.id}
                  data-active={on || undefined}
                  className="flex items-center overflow-hidden rounded border"
                  style={{
                    borderColor: on ? `${color}99` : 'rgba(138,160,190,0.18)',
                    background: on ? `${color}14` : 'transparent',
                    opacity: dead ? 0.55 : 1,
                  }}
                >
                  <button
                    onClick={() => onSelectTab(g.dir, t.id)}
                    onDoubleClick={() =>
                      setEditing({ kind: 'tab', id: t.id, value: t.title })
                    }
                    className="flex items-center gap-1.5 px-2 py-0.5 font-mono text-xs outline-none focus-visible:ring-1 focus-visible:ring-hud-cyan"
                    style={{ color: on ? HUD.text : HUD.textDim }}
                    title={`${t.cwd}${summary ? `\n${summary}` : ''}${
                      dead
                        ? t.exitCode === REVIVE_FAILED
                          ? '\nrevive failed'
                          : `\nexited ${t.exitCode}`
                        : ''
                    }\ndouble-click to rename`}
                  >
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
                          onChange={(v) => setEditing({ ...editing, value: v })}
                          onCommit={commit}
                          onCancel={() => setEditing(null)}
                        />
                        <ColorSwatches
                          current={color}
                          onPick={(c) => onSetInitiativeColor(g.dir, c)}
                        />
                      </>
                    ) : (
                      <span className="flex flex-col items-start">
                        <span className="leading-tight">{t.title}</span>
                        {summary && !dead && (
                          <span
                            data-subtitle
                            className="max-w-44 truncate text-left text-[9px] leading-tight"
                            style={{ color: `${color}B0` }}
                          >
                            {summary}
                          </span>
                        )}
                      </span>
                    )}
                    {dead && <span style={{ color: HUD.red }}>✕</span>}
                  </button>
                  <button
                    onClick={() => onCloseTab(t.id)}
                    aria-label={`Close ${t.title}`}
                    className="px-1 py-0.5 font-mono text-xs outline-none focus-visible:ring-1 focus-visible:ring-hud-cyan"
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
