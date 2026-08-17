import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  WORKSPACE_FOUNDATION,
  WORKSPACE_HUD as HUD,
  withThemeAlpha,
} from './workspace-theme';
import { READINESS_NEUTRAL } from '@/components/readiness';
import { PROJECT_PALETTE } from './project-colors';

/** Shortcut hints overlay their anchor so revealing them never shifts
 *  layout. Right-anchored (D42 review round): the status glyph lives at the
 *  chip's left edge, and on a 46px condensed chip a left-anchored keycap
 *  erased the only state signal while ⌘ was held. */
export function OrdinalKeycap({
  value,
  color,
}: {
  value: number;
  color: string;
}) {
  return (
    <span
      className="pointer-events-none absolute right-1 top-1/2 z-10 inline-flex h-3.5 min-w-3.5 -translate-y-1/2 items-center justify-center rounded-sm border px-0.5 font-mono text-chrome-micro leading-none motion-safe:animate-in motion-safe:fade-in motion-safe:duration-100"
      style={{
        color,
        borderColor: `${color}55`,
        background: HUD.bg.panelFill,
      }}
    >
      {value}
    </span>
  );
}

export function RenameInput({
  value,
  color,
  onChange,
  onCommit,
  onCancel,
}: {
  value: string;
  color: string;
  onChange: (value: string) => void;
  onCommit: () => void;
  onCancel: () => void;
}) {
  // Escape unmounts the input and can cause a blur; remember that the edit has
  // already settled so cancellation can never accidentally commit.
  const settled = useRef(false);
  return (
    <input
      value={value}
      autoFocus
      aria-label="Rename"
      onFocus={event => event.currentTarget.select()}
      onChange={event => onChange(event.target.value)}
      onBlur={() => {
        if (!settled.current) onCommit();
      }}
      onKeyDown={event => {
        event.stopPropagation();
        if (event.key === 'Enter') {
          settled.current = true;
          onCommit();
        } else if (event.key === 'Escape') {
          settled.current = true;
          onCancel();
        }
      }}
      onClick={event => event.stopPropagation()}
      className="w-28 bg-transparent font-mono text-chrome-title font-medium outline-none"
      style={{ color, borderBottom: `1px solid ${color}99` }}
    />
  );
}

/** Pointer-down chooses color before blur can settle the surrounding rename. */
export function ColorSwatches({
  current,
  onPick,
}: {
  current: string;
  onPick: (color: string) => void;
}) {
  return (
    <span className="ml-1 inline-flex items-center gap-1">
      {PROJECT_PALETTE.map(color => (
        <button
          key={color}
          type="button"
          aria-label={`Set project color ${color}`}
          onMouseDown={event => {
            event.preventDefault();
            event.stopPropagation();
            onPick(color);
          }}
          className="size-3 rounded-full transition-transform hover:scale-125"
          style={{
            background: color,
            boxShadow:
              color === current
                ? `0 0 0 1.5px ${WORKSPACE_FOUNDATION.text}, 0 0 6px ${color}`
                : 'none',
          }}
        />
      ))}
    </span>
  );
}

/** Avoid invalid interactive descendants while the inline editor is open. */
export function EditableChrome({
  editing,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { editing: boolean }) {
  return editing ? (
    <div {...(props as React.HTMLAttributes<HTMLDivElement>)} />
  ) : (
    <button type="button" {...props} />
  );
}

export function isContextMenuKey(event: React.KeyboardEvent): boolean {
  return event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey);
}

export function keyboardMenuPoint(element: HTMLElement): {
  x: number;
  y: number;
} {
  const rect = element.getBoundingClientRect();
  return { x: rect.left + Math.min(24, rect.width / 2), y: rect.bottom + 2 };
}

export interface StripMenuItem {
  /**
   * Stable row identity, REQUIRED. Everything the menu keys on — the React
   * key, the roving tabstop, the highlight — reads this and never the label.
   *
   * A menu whose rows were identified by their label could not tell two rows
   * apart that legitimately read the same: Clone to… on a Codex Session
   * offered two `GPT-5.6 Codex` setups differing only by reasoning effort,
   * and moving onto either one highlighted BOTH (operator, 2026-08-17). The
   * same family as FIX-007's cmdk group-id collision. Identity is data the
   * caller owns; the menu must never infer it from copy or render order.
   */
  id: string;
  label: string;
  /** Full spoken identity when the visible label is deliberately not unique. */
  accessibleLabel?: string;
  /** Absent only on `announced` rows, which cannot be operated. */
  onSelect?: () => void;
  danger?: boolean;
  focusAfterSelect?: 'trigger' | 'none';
  /**
   * ENG-026 `announced` affordance: the row is visible so the map is
   * complete, but inert — muted readiness neutral, `cursor: default`,
   * tooltip `Coming soon — {announcedComing}`, skipped by keyboard menu
   * navigation. Never renders as disabled-by-error.
   */
  announcedComing?: string;
  /** Muted right-aligned micro note, e.g. `Coming soon` on a preview-surface
   *  entry point (the ⌘K preview-row pattern). Readiness neutral, because
   *  that is the only thing this channel says. */
  note?: string;
  /**
   * Right-aligned secondary VALUE, e.g. the reasoning effort behind a Clone
   * target. Same channel the launcher chip and the configuration ribbon put a
   * setup's effort on, so it carries `hud-text-dim` and never the readiness
   * neutral — this row is built, and the grey that says otherwise is spoken
   * for.
   */
  detail?: string;
  /** A compact drill-in keeps secondary target selection inside the same
   * keyboard-complete menu instead of opening a heavyweight dialog. */
  children?: StripMenuItem[];
}

export type MenuCloseFocus = 'none' | 'trigger' | 'next' | 'previous';

/** One keyboard-complete action surface shared by Project and Session atoms. */
export function StripContextMenu({
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
  onClose: (focus?: MenuCloseFocus) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [position, setPosition] = useState({ x, y });
  const [path, setPath] = useState<StripMenuItem[]>([]);
  const pathDepthRef = useRef(0);
  const visibleItems = path.at(-1)?.children ?? items;

  /**
   * The one ordered list of rows a pointer or an arrow key can land on, in
   * paint order: the drill-out row, then every operable item. `announced`
   * rows are not in it — they are readable but cannot be operated.
   *
   * Everything navigational indexes into THIS list. Arrow keys used to walk
   * the DOM's `[role="menuitem"]` buttons while `tabIndex` was assigned from
   * each item's position in `visibleItems`; inside a submenu the drill-out
   * row shifted those two apart by one, so the roving tabstop landed on the
   * wrong row and Tab re-entered the menu somewhere the operator never left.
   */
  const rows = [
    ...(path.length > 0 ? [{ key: 'back', item: null }] : []),
    ...visibleItems
      .filter(item => !item.announcedComing)
      .map(item => ({ key: `item:${item.id}`, item })),
  ];
  const activeRowKey = rows[activeIndex]?.key ?? null;
  const rowKeyOf = (item: StripMenuItem) => `item:${item.id}`;
  const rowIndexOf = (item: StripMenuItem) =>
    rows.findIndex(row => row.item === item);
  const focusRow = (index: number) => {
    setActiveIndex(index);
    rootRef.current
      ?.querySelector<HTMLElement>(`[data-menu-row-index="${index}"]`)
      ?.focus();
  };

  const openChildren = (item: StripMenuItem) => {
    if (!item.children?.length) return false;
    setPath(current => [...current, item]);
    setActiveIndex(0);
    return true;
  };

  const goBack = () => {
    if (path.length === 0) return false;
    setPath(current => current.slice(0, -1));
    setActiveIndex(0);
    return true;
  };

  useLayoutEffect(() => {
    if (pathDepthRef.current === path.length) return;
    pathDepthRef.current = path.length;
    // Entering a submenu lands on its first ACTION, not on the drill-out row
    // that sits above it — arriving on "go back" makes the drill-in feel like
    // it did nothing.
    focusRow(path.length > 0 ? 1 : 0);
  }, [path]);

  useLayoutEffect(() => {
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect) return;
    setPosition({
      x: Math.min(x, Math.max(4, window.innerWidth - rect.width - 4)),
      y: Math.min(y, Math.max(4, window.innerHeight - rect.height - 4)),
    });
  }, [x, y]);

  useEffect(() => {
    rootRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const closeAway = (event: MouseEvent) => {
      if (
        event.target instanceof Node &&
        !rootRef.current?.contains(event.target)
      ) {
        onClose('none');
      }
    };
    // Arm on the NEXT task, not synchronously. The menu opens from
    // `contextmenu`, and the gesture that opened it still has a `mousedown`
    // (trackpad secondary click) or `mouseup` to deliver. The menu's top-left
    // corner sits exactly under the pointer, so whether that trailing event
    // counted as "outside" was a coin flip on a one-pixel border — the menu
    // sometimes vanished the instant it appeared and the operator had to
    // right-click a second time (2026-08-04).
    const arm = setTimeout(
      () => document.addEventListener('mousedown', closeAway),
      0
    );
    return () => {
      clearTimeout(arm);
      document.removeEventListener('mousedown', closeAway);
    };
  }, [onClose]);

  return (
    <div
      ref={rootRef}
      data-strip-menu
      role="menu"
      aria-label={label}
      className="fixed z-50 flex min-w-44 flex-col rounded border py-1 shadow-2xl motion-safe:animate-in motion-safe:fade-in motion-safe:duration-100"
      style={{
        left: position.x,
        top: position.y,
        borderColor: `${color}44`,
        background: HUD.bg.panelFill,
        boxShadow: `0 12px 32px ${withThemeAlpha(HUD.bg.void, 0.55)}, 0 0 10px ${withThemeAlpha(color, 0.13)}`,
      }}
      onKeyDown={event => {
        event.stopPropagation();
        if (event.key === 'Escape') {
          event.preventDefault();
          if (!goBack()) onClose('trigger');
          return;
        }
        if (event.key === 'Tab') {
          event.preventDefault();
          onClose(event.shiftKey ? 'previous' : 'next');
          return;
        }
        if (event.key === 'ArrowLeft') {
          if (goBack()) event.preventDefault();
          return;
        }
        if (event.key === 'ArrowRight') {
          const item = rows[activeIndex]?.item;
          if (item && openChildren(item)) event.preventDefault();
          return;
        }
        if (
          event.key === 'ArrowDown' ||
          event.key === 'ArrowUp' ||
          event.key === 'Home' ||
          event.key === 'End'
        ) {
          event.preventDefault();
          if (rows.length === 0) return;
          const current = Math.max(0, activeIndex);
          focusRow(
            event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? rows.length - 1
                : (current + (event.key === 'ArrowDown' ? 1 : rows.length - 1)) %
                  rows.length
          );
        }
      }}
    >
      {path.length > 0 && (
        <button
          type="button"
          role="menuitem"
          data-menu-row-index={0}
          data-menu-active={activeRowKey === 'back' || undefined}
          tabIndex={activeIndex === 0 ? 0 : -1}
          onFocus={() => setActiveIndex(0)}
          onPointerMove={() => setActiveIndex(0)}
          onClick={() => goBack()}
          className="flex cursor-pointer items-baseline gap-3 border-b border-hud-stroke-faint px-3 py-1.5 text-left font-mono text-chrome-label outline-none"
          style={{
            color: HUD.textDim,
            background:
              activeRowKey === 'back'
                ? withThemeAlpha(color, 0.18)
                : 'transparent',
          }}
        >
          <span aria-hidden>‹</span>
          <span className="min-w-0 flex-1">{path.at(-1)?.label}</span>
        </button>
      )}
      {visibleItems.map(item =>
        item.announcedComing ? (
          // ENG-026 announced affordance: not a menuitem, so arrow keys and
          // the focus loop skip it; `inert` keeps the promise that it cannot
          // be operated or read as merely disabled.
          <div
            key={item.id}
            data-readiness="announced"
            title={`Coming soon — ${item.announcedComing}`}
            aria-label={`${item.announcedComing} — coming soon`}
            className="cursor-default select-none px-3 py-1.5 text-left font-mono text-chrome-label"
            style={{ color: READINESS_NEUTRAL }}
          >
            <span inert className="opacity-80">
              {item.label}
            </span>
          </div>
        ) : (
          <button
            key={item.id}
            type="button"
            role="menuitem"
            aria-label={item.accessibleLabel}
            data-menu-row-index={rowIndexOf(item)}
            data-menu-active={activeRowKey === rowKeyOf(item) || undefined}
            tabIndex={activeIndex === rowIndexOf(item) ? 0 : -1}
            onFocus={() => setActiveIndex(rowIndexOf(item))}
            onPointerMove={() => setActiveIndex(rowIndexOf(item))}
            onClick={() => {
              if (openChildren(item)) return;
              onClose(item.focusAfterSelect ?? 'trigger');
              item.onSelect?.();
            }}
            // One highlight, driven by the row the operator is ON — whether
            // they got there with the pointer or the arrow keys. It used to
            // be `hover:` plus `focus-visible:`, and `focus-visible` does not
            // match focus moved programmatically out of a pointer-opened
            // menu, so arrowing through a right-click menu highlighted
            // nothing at all and the menu read as keyboard-dead.
            className="relative flex cursor-pointer items-baseline gap-3 px-3 py-1.5 text-left font-mono text-chrome-label outline-none transition-[background-color] duration-75"
            style={{
              color: item.danger ? color : HUD.text,
              background:
                activeRowKey === rowKeyOf(item)
                  ? withThemeAlpha(color, 0.18)
                  : 'transparent',
              boxShadow:
                activeRowKey === rowKeyOf(item)
                  ? `inset 2px 0 0 ${color}`
                  : undefined,
            }}
          >
            <span className="min-w-0 flex-1">{item.label}</span>
            {item.children?.length ? <span aria-hidden>›</span> : null}
            {item.detail && (
              <span
                className="shrink-0 text-chrome-micro"
                style={{ color: HUD.textDim }}
              >
                {item.detail}
              </span>
            )}
            {item.note && (
              <span
                className="shrink-0 text-chrome-micro"
                style={{ color: READINESS_NEUTRAL }}
              >
                {item.note}
              </span>
            )}
          </button>
        )
      )}
    </div>
  );
}
