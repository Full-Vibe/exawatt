import { useRef } from 'react';
import { WORKSPACE_FOUNDATION, WORKSPACE_HUD as HUD } from './workspace-theme';
import { ActionMenu, type ActionMenuItem } from '@/components/ui/option-menu';
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

/**
 * Rows for the Project and Session context menus. The type IS the
 * primitive's: identity is required (BUG-051), `announced` rows are inert,
 * `detail` is a value channel and `note` a readiness one, and `children`
 * drill in without leaving the menu.
 */
export type StripMenuItem = ActionMenuItem;

export type MenuCloseFocus = 'none' | 'trigger' | 'next' | 'previous';

/**
 * One keyboard-complete action surface shared by Project and Session atoms:
 * the one menu primitive's action face (decision `0033`), anchored at the
 * pointer or under a keyboard-opened chip, tinted with the Project colour.
 *
 * The strip owns focus after close, because only it knows the chip the
 * menu opened from: the primitive reports the gesture and this maps it to
 * the strip's focus vocabulary.
 */
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
  return (
    <ActionMenu
      open
      anchor={{ x, y }}
      label={label}
      items={items}
      accent={color}
      attributes={{ 'data-strip-menu': '' }}
      onClose={(reason, item) => {
        switch (reason) {
          case 'select':
            onClose(item?.focusAfterSelect ?? 'trigger');
            return;
          case 'escape':
            onClose('trigger');
            return;
          case 'tab-next':
            onClose('next');
            return;
          case 'tab-previous':
            onClose('previous');
            return;
          default:
            onClose('none');
        }
      }}
    />
  );
}
