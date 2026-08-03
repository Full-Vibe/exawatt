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
  label: string;
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
   *  entry point (the ⌘K preview-row pattern). */
  note?: string;
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
    document.addEventListener('mousedown', closeAway);
    return () => document.removeEventListener('mousedown', closeAway);
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
          onClose('trigger');
          return;
        }
        const buttons = Array.from(
          rootRef.current?.querySelectorAll<HTMLButtonElement>(
            '[role="menuitem"]'
          ) ?? []
        );
        if (event.key === 'Tab') {
          event.preventDefault();
          onClose(event.shiftKey ? 'previous' : 'next');
          return;
        }
        if (
          event.key === 'ArrowDown' ||
          event.key === 'ArrowUp' ||
          event.key === 'Home' ||
          event.key === 'End'
        ) {
          event.preventDefault();
          const index = buttons.indexOf(
            document.activeElement as HTMLButtonElement
          );
          const nextIndex =
            event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? buttons.length - 1
                : (Math.max(0, index) +
                    (event.key === 'ArrowDown' ? 1 : buttons.length - 1)) %
                  buttons.length;
          setActiveIndex(nextIndex);
          buttons[nextIndex]?.focus();
        }
      }}
    >
      {items.map((item, index) =>
        item.announcedComing ? (
          // ENG-026 announced affordance: not a menuitem, so arrow keys and
          // the focus loop skip it; `inert` keeps the promise that it cannot
          // be operated or read as merely disabled.
          <div
            key={item.label}
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
            key={item.label}
            type="button"
            role="menuitem"
            tabIndex={index === activeIndex ? 0 : -1}
            onFocus={() => setActiveIndex(index)}
            onPointerMove={() => setActiveIndex(index)}
            onClick={() => {
              onClose(item.focusAfterSelect ?? 'trigger');
              item.onSelect?.();
            }}
            className="flex cursor-pointer items-baseline gap-3 px-3 py-1.5 text-left font-mono text-chrome-label outline-none transition-[background-color] duration-75 hover:bg-hud-fill-hi focus-visible:bg-hud-fill-hi"
            style={{ color: item.danger ? color : HUD.text }}
          >
            <span className="min-w-0 flex-1">{item.label}</span>
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
