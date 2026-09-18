'use client';

/**
 * OptionMenu — the project's one menu primitive (ENG-016 D49, decision
 * `0033`; action face added for BUG-052).
 *
 * Built on the Radix Popover the app already depends on, with a real
 * roving-focus list inside it rather than a search-first `Command`. The
 * launcher's first cut wrapped cmdk and mounted its input only for long lists,
 * so short lists had no focused element at all: no arrows, no type-ahead. That
 * is the "not very good menus or input system" the operator hit.
 *
 * Two faces, one keyboard grammar:
 *
 *   - `OptionMenu` picks a VALUE: a trigger button, a `listbox`, a check on
 *     the current option (the launcher's axes).
 *   - `ActionMenu` runs a VERB: a `menu` opened at a pointer or a keyboard
 *     trigger, no value, rows that do something (the Project and Session
 *     context menus, the terminal's right-click menu).
 *
 * A `role="menu"` anywhere else in `src/` fails `one-menu-primitive.test.ts`.
 *
 * What this gives every menu that adopts it:
 *
 *   - arrows with wrap, Home/End, PageUp/PageDown
 *   - macOS type-ahead: prefix search, and a repeated letter CYCLES matches
 *   - optional search field for long catalogs that never steals the arrows
 *   - grouped options, per-option marks, descriptions, unavailable reasons
 *   - a footer slot for real actions (settings, refresh) inside the same
 *     focus order, which is why this is a listbox in a popover and not a
 *     `Select`
 *
 * The keyboard model lives in `option-menu-keyboard.ts` and is unit tested
 * without a DOM.
 */

import {
  Fragment,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Check, ChevronDown, Search } from 'lucide-react';
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { READINESS_NEUTRAL } from '@/components/readiness';
import { cn } from '@/lib/utils';
import {
  applyTypeahead,
  emptyTypeahead,
  isTypeaheadCharacter,
  resolveMenuKey,
  type TypeaheadState,
} from './option-menu-keyboard';

export interface OptionMenuOption {
  id: string;
  label: string;
  description?: string;
  /** Optional group heading. Options keep the order they are given within it. */
  group?: string;
  /** Leading mark — a harness glyph, a provider mark, a status dot. */
  mark?: React.ReactNode;
  disabled?: boolean;
  /** Required whenever `disabled` is true: the exact missing fact. */
  disabledReason?: string;
  /** Extra words the search field should match, e.g. a source-native model ID. */
  keywords?: string;
}

export interface OptionMenuProps {
  /** Optional staged selection: one list plus an explicit apply footer. */
  closeOnSelect?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  options: readonly OptionMenuOption[];
  value: string | null;
  onValueChange: (optionId: string) => void;
  /** Accessible name for the control. */
  label: string;
  placeholder?: string;
  /** Stable committed value when the open menu stages a different choice. */
  triggerLabel?: string;
  disabled?: boolean;
  /** Force the search field on or off. Defaults to on above 10 options. */
  searchable?: boolean;
  /** Rendered under the list, inside the popover. Actions belong here. */
  footer?: React.ReactNode;
  /** Provenance line under the list, e.g. "Reported by Claude Code". */
  provenance?: string;
  /** Trigger emphasis for an axis that carries risk. */
  tone?: 'normal' | 'caution';
  /** Leading mark on the trigger, normally the selected option's own mark. */
  triggerMark?: React.ReactNode;
  className?: string;
  contentClassName?: string;
}

const SEARCHABLE_THRESHOLD = 10;

export function OptionMenu({
  closeOnSelect = true,
  open: controlledOpen,
  onOpenChange,
  options,
  value,
  onValueChange,
  label,
  placeholder,
  triggerLabel,
  disabled,
  searchable,
  footer,
  provenance,
  tone = 'normal',
  triggerMark,
  className,
  contentClassName,
}: OptionMenuProps) {
  const [localOpen, setLocalOpen] = useState(false);
  const open = controlledOpen ?? localOpen;
  const setOpen = useCallback(
    (next: boolean) => {
      setLocalOpen(next);
      onOpenChange?.(next);
    },
    [onOpenChange]
  );
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(-1);
  const typeahead = useRef<TypeaheadState>(emptyTypeahead());
  const listRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef(new Map<string, HTMLDivElement>());
  const listId = useId();

  const selected = options.find(option => option.id === value) ?? null;
  const showSearch = searchable ?? options.length > SEARCHABLE_THRESHOLD;

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return [...options];
    return options.filter(option =>
      `${option.label} ${option.keywords ?? ''} ${option.description ?? ''}`
        .toLowerCase()
        .includes(needle)
    );
  }, [options, query]);

  // Groups render in first-seen order; options keep their order within a group.
  const groups = useMemo(() => {
    const order: string[] = [];
    const byGroup = new Map<string, OptionMenuOption[]>();
    for (const option of visible) {
      const key = option.group ?? '';
      if (!byGroup.has(key)) {
        byGroup.set(key, []);
        order.push(key);
      }
      byGroup.get(key)!.push(option);
    }
    return order.map(key => ({ key, options: byGroup.get(key)! }));
  }, [visible]);

  /** Flat order matches what the eye sees, so movement matches the render. */
  const flat = useMemo(() => groups.flatMap(group => group.options), [groups]);

  const moveTo = useCallback(
    (index: number) => {
      setActiveIndex(index);
      const option = flat[index];
      if (!option) return;
      requestAnimationFrame(() => {
        optionRefs.current
          .get(option.id)
          ?.scrollIntoView?.({ block: 'nearest' });
      });
    },
    [flat]
  );

  // Opening lands on the current value, exactly like a macOS menu, so the
  // first Down is a move from where you already are.
  useEffect(() => {
    if (!open) {
      setQuery('');
      typeahead.current = emptyTypeahead();
      return;
    }
    const index = flat.findIndex(option => option.id === value);
    setActiveIndex(index >= 0 ? index : flat.findIndex(o => !o.disabled));
  }, [open, value, flat]);

  // Filtering must never strand the active index past the end of the list.
  useEffect(() => {
    if (activeIndex >= flat.length) {
      setActiveIndex(flat.findIndex(option => !option.disabled));
    }
  }, [activeIndex, flat]);

  const commit = useCallback(
    (option: OptionMenuOption) => {
      if (option.disabled) return;
      onValueChange(option.id);
      if (closeOnSelect) setOpen(false);
    },
    [onValueChange, closeOnSelect, setOpen]
  );

  const onKeyDown = (event: React.KeyboardEvent) => {
    const hasModifier = event.metaKey || event.ctrlKey || event.altKey;
    const movement = resolveMenuKey(flat, event.key, activeIndex);
    if (movement) {
      // Space belongs to the search field once there is a query to type into.
      if (event.key === ' ' && showSearch) return;
      event.preventDefault();
      if (movement.kind === 'move') moveTo(movement.index);
      else if (movement.kind === 'commit') commit(flat[movement.index]);
      else setOpen(false);
      return;
    }
    if (showSearch) return; // the field owns printable keys
    if (!isTypeaheadCharacter(event.key, hasModifier)) return;
    event.preventDefault();
    const result = applyTypeahead(
      flat,
      typeahead.current,
      event.key,
      activeIndex,
      // A monotonic clock the buffer can expire against; `Date.now` is fine
      // here because nothing persists it.
      Date.now()
    );
    typeahead.current = result.state;
    if (result.index !== null) moveTo(result.index);
  };

  const active = activeIndex >= 0 ? flat[activeIndex] : null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          data-option-menu-trigger
          data-tone={tone}
          aria-label={`${label}: ${triggerLabel ?? selected?.label ?? placeholder ?? 'not set'}`}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          className={cn(
            'flex h-9 min-w-0 items-center justify-between gap-2 rounded-md border border-hud-stroke-faint bg-hud-deep px-2.5 text-left outline-none',
            'transition-[border-color,background-color] duration-150 motion-reduce:transition-none',
            'hover:border-hud-cyan/45 focus-visible:ring-2 focus-visible:ring-hud-cyan',
            'disabled:cursor-not-allowed disabled:opacity-50',
            tone === 'caution' && selected && 'border-hud-amber/35',
            className
          )}
        >
          <span className="flex min-w-0 items-center gap-1.5">
            {triggerMark}
            <span
              className={cn(
                'min-w-0 truncate font-mono text-chrome-label',
                selected ? 'text-hud-text' : 'text-hud-text-dim'
              )}
            >
              {triggerLabel ?? selected?.label ?? placeholder ?? '—'}
            </span>
          </span>
          <ChevronDown
            aria-hidden="true"
            className={cn(
              'size-3.5 shrink-0 text-hud-text-dim transition-transform duration-150 motion-reduce:transition-none',
              open && 'rotate-180'
            )}
          />
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="start"
        // Keep the whole menu inside the window (BUG-003). The list used to
        // cap at a CONSTANT 18rem, which is not a height the window has
        // promised: opened from a trigger low in a short window, the tail of
        // a long catalog rendered past the viewport with nothing to scroll,
        // and opencode ships the largest catalog of any source. Radix
        // already measures the room it has; the cap is now that measurement,
        // and the list flexes inside it.
        collisionPadding={12}
        onKeyDown={event => {
          // A staged-selection footer owns its buttons; Enter on Apply must
          // not be consumed by the list's keyboard handler.
          if (
            (event.target as HTMLElement).closest('[data-option-menu-footer]')
          )
            return;
          onKeyDown(event);
        }}
        // Focus stays on one element so arrows and type-ahead have a single
        // owner: the search field when present, otherwise the list itself.
        onOpenAutoFocus={event => {
          event.preventDefault();
          requestAnimationFrame(() => {
            const node = showSearch
              ? listRef.current?.parentElement?.querySelector('input')
              : listRef.current;
            (node as HTMLElement | null)?.focus();
          });
        }}
        className={cn(
          'flex w-[min(26rem,calc(100vw-2rem))] flex-col border-hud-stroke-soft bg-hud-deep p-0',
          'max-h-[min(21rem,var(--radix-popover-content-available-height,21rem))]',
          contentClassName
        )}
      >
        {showSearch ? (
          <div className="flex items-center gap-2 border-b border-hud-divider px-2.5">
            <Search
              aria-hidden="true"
              className="size-3.5 shrink-0 text-hud-text-dim"
            />
            <input
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder={`Search ${label.toLowerCase()}…`}
              aria-label={`Search ${label}`}
              aria-controls={listId}
              className="h-9 min-w-0 flex-1 bg-transparent font-mono text-chrome-label text-hud-text outline-none placeholder:text-hud-text-dim"
            />
          </div>
        ) : null}

        <div
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label={label}
          aria-activedescendant={active ? `${listId}-${active.id}` : undefined}
          tabIndex={showSearch ? -1 : 0}
          className="min-h-0 flex-1 overflow-y-auto py-1 outline-none"
        >
          {flat.length === 0 ? (
            <p className="px-3 py-4 font-mono text-chrome-meta text-hud-text-dim">
              Nothing matches that.
            </p>
          ) : null}
          {groups.map(group => (
            <div key={group.key || 'ungrouped'}>
              {group.key ? (
                <p className="px-3 pb-1 pt-2 font-mono text-chrome-micro text-hud-text-dim">
                  {group.key}
                </p>
              ) : null}
              {group.options.map(option => {
                const index = flat.indexOf(option);
                const isActive = index === activeIndex;
                return (
                  <div
                    key={option.id}
                    id={`${listId}-${option.id}`}
                    ref={element => {
                      if (element) optionRefs.current.set(option.id, element);
                      else optionRefs.current.delete(option.id);
                    }}
                    role="option"
                    aria-selected={option.id === value}
                    aria-disabled={option.disabled || undefined}
                    data-active={isActive || undefined}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => commit(option)}
                    className={cn(
                      'flex cursor-pointer items-start gap-2 px-2.5 py-1.5',
                      isActive && 'bg-hud-fill-hi',
                      option.disabled && 'cursor-not-allowed opacity-55'
                    )}
                  >
                    <Check
                      aria-hidden="true"
                      className={cn(
                        'mt-0.5 size-3.5 shrink-0 text-hud-cyan',
                        option.id === value ? '' : 'opacity-0'
                      )}
                    />
                    {option.mark ? (
                      <span className="mt-px shrink-0">{option.mark}</span>
                    ) : null}
                    <span className="flex min-w-0 flex-col">
                      <span className="font-mono text-chrome-label text-hud-text">
                        {option.label}
                      </span>
                      {option.description ? (
                        <span className="font-mono text-chrome-micro leading-4 text-hud-text-dim">
                          {option.description}
                        </span>
                      ) : null}
                      {option.disabled && option.disabledReason ? (
                        <span className="font-mono text-chrome-micro leading-4 text-hud-amber/80">
                          {option.disabledReason}
                        </span>
                      ) : null}
                    </span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        {provenance ? (
          <p className="border-t border-hud-divider px-3 py-2 font-mono text-chrome-micro leading-4 text-hud-text-dim">
            {provenance}
          </p>
        ) : null}
        {footer ? (
          <div
            data-option-menu-footer
            className="border-t border-hud-divider p-1"
          >
            {footer}
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

// ---------------------------------------------------------------------------
// ActionMenu: the primitive's ACTION face (BUG-052; decision `0033` amended
// 2026-09-13).
//
// The Project ribbon and the terminal pane each hand-rolled a `role="menu"`.
// The ribbon's had arrows and a roving tabstop of its own design; the
// terminal's had no keyboard at all and, worse, left DOM focus in xterm's
// textarea while it was open, so ArrowDown went to the shell as an escape
// sequence and nothing on screen moved. Both are this now.
//
// Focus is the whole difficulty against a live xterm, so the contract is
// explicit:
//
//   - Opening moves DOM focus onto the menu (one owner for the arrows, the
//     type-ahead and ⏎). xterm blurs, which is what any other surface taking
//     the keyboard does to it.
//   - The close gesture is reported to the caller SYNCHRONOUSLY through
//     `onClose(reason, item)`, before Radix's exit animation, and the
//     primitive suppresses Radix's own close-focus. The caller owns the
//     restore because only the caller knows the target: the terminal pane
//     calls `term.focus()`, the tab strip refocuses the tab it opened from.
//     `onClose` fires exactly once per open.
//   - Escape is consumed here. It never reaches the element focus returns
//     to, so a terminal gets its focus back and NOT an ESC byte (which would
//     interrupt an Agent's turn and scroll the viewport to the bottom).
//   - A pointer-down outside closes with `outside` and is delivered to what
//     was clicked; that click decides focus, so the caller leaves it alone.
// ---------------------------------------------------------------------------

export interface ActionMenuItem {
  /** Stable row identity, REQUIRED (BUG-051): keys, highlight and the
   *  roving cursor read this, never the label. */
  id: string;
  label: string;
  /** Full spoken identity when the visible label is deliberately not unique. */
  accessibleLabel?: string;
  /** Right-aligned secondary VALUE (the reasoning effort behind a Clone
   *  target), on `hud-text-dim`, never the readiness neutral. */
  detail?: string;
  /** Muted right-aligned readiness note, e.g. `Coming soon`. */
  note?: string;
  /** A destructive verb. Tinted with the menu's accent when it has one. */
  danger?: boolean;
  disabled?: boolean;
  /** Required whenever `disabled` is true: the exact missing fact. */
  disabledReason?: string;
  /**
   * ENG-026 `announced` affordance: the row is visible so the map is
   * complete, but inert. Readiness neutral, `cursor: default`, a tooltip,
   * no `menuitem` role, so keyboard traversal skips it and a screen reader
   * does not read it as merely disabled.
   */
  announcedComing?: string;
  /** Rows partition into sections in first-seen order; a rule separates
   *  sections. Rows without one form the first (unnamed) section. */
  section?: string;
  /** Absent only on `announced` rows and on rows with `children`. */
  onSelect?: () => void;
  /** Where the caller should put focus after this row runs; forwarded on
   *  the `select` close reason's item. */
  focusAfterSelect?: 'trigger' | 'none';
  /** A compact drill-in keeps secondary choice inside the same
   *  keyboard-complete menu instead of opening a heavyweight dialog. */
  children?: ActionMenuItem[];
  /** Product hooks the row carries (`data-terminal-copy-target`). */
  attributes?: Record<`data-${string}`, string>;
}

type ActionMenuCloseReason =
  | 'escape'
  | 'select'
  | 'outside'
  | 'tab-next'
  | 'tab-previous'
  | 'blur';

/** A viewport point (the pointer, or the corner of a keyboard-opened
 *  trigger) or an element to hang the menu under. */
type ActionMenuAnchor =
  | { x: number; y: number }
  | { getBoundingClientRect(): DOMRect };

interface ActionMenuProps {
  open: boolean;
  anchor: ActionMenuAnchor | null;
  /** Accessible name for the menu. */
  label: string;
  items: readonly ActionMenuItem[];
  /**
   * The close gesture, reported once per open and synchronously with the
   * gesture. `select` carries the row; the caller restores focus, then the
   * row's `onSelect` runs.
   */
  onClose: (reason: ActionMenuCloseReason, item?: ActionMenuItem) => void;
  /** Identity tint for the highlight, the border and danger rows (a Project
   *  colour). Without it the menu wears the HUD highlight. */
  accent?: string;
  /** Product hooks on the menu element (`data-strip-menu`). */
  attributes?: Record<`data-${string}`, string>;
}

type ActionMenuRow =
  | { kind: 'back'; id: string; label: string; disabled?: false }
  | {
      kind: 'item';
      id: string;
      label: string;
      disabled?: boolean;
      item: ActionMenuItem;
    };

function rectAt(x: number, y: number): DOMRect {
  return {
    x,
    y,
    width: 0,
    height: 0,
    top: y,
    left: x,
    right: x,
    bottom: y,
    toJSON: () => ({ x, y, width: 0, height: 0 }),
  } as DOMRect;
}

function tint(accent: string, percent: number): string {
  return `color-mix(in srgb, ${accent} ${percent}%, transparent)`;
}

export function ActionMenu({
  open,
  anchor,
  label,
  items,
  onClose,
  accent,
  attributes,
}: ActionMenuProps) {
  const [path, setPath] = useState<ActionMenuItem[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const typeahead = useRef<TypeaheadState>(emptyTypeahead());
  const listRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  const listId = useId();
  // `onClose` fires once per open: Radix reports Escape, a pointer-down
  // outside AND the focus change a caller's own restore causes, and a
  // selection closes before the parent has even flipped `open`.
  const closedRef = useRef(true);
  const reasonRef = useRef<ActionMenuCloseReason>('outside');

  useEffect(() => {
    if (!open) return;
    closedRef.current = false;
    reasonRef.current = 'outside';
    setPath([]);
    setActiveIndex(0);
    typeahead.current = emptyTypeahead();
  }, [open]);

  const close = useCallback(
    (reason: ActionMenuCloseReason, item?: ActionMenuItem) => {
      if (closedRef.current) return;
      closedRef.current = true;
      onClose(reason, item);
    },
    [onClose]
  );

  // The app losing focus (⌘⇥) closes a menu the way macOS closes its own.
  useEffect(() => {
    if (!open) return;
    const onBlur = () => close('blur');
    window.addEventListener('blur', onBlur);
    return () => window.removeEventListener('blur', onBlur);
  }, [close, open]);

  const measurable = useMemo(() => {
    if (!anchor) return null;
    if ('getBoundingClientRect' in anchor) return anchor;
    const { x, y } = anchor;
    return { getBoundingClientRect: () => rectAt(x, y) };
  }, [anchor]);
  const virtualRef = useMemo(() => ({ current: measurable }), [measurable]);

  const parent = path.at(-1) ?? null;
  const visible = parent?.children ?? items;

  /** The one ordered list a pointer or an arrow key can land on, in paint
   *  order: the drill-out row, then every operable item. `announced` rows
   *  are readable but not in it. */
  const rows = useMemo<ActionMenuRow[]>(
    () => [
      ...(parent
        ? [{ kind: 'back' as const, id: 'back', label: parent.label }]
        : []),
      ...visible
        .filter(item => !item.announcedComing)
        .map(item => ({
          kind: 'item' as const,
          id: item.id,
          label: item.label,
          disabled: item.disabled,
          item,
        })),
    ],
    [parent, visible]
  );

  /** Sections in first-seen order, so a rule can separate them. */
  const sections = useMemo(() => {
    const order: string[] = [];
    const byKey = new Map<string, ActionMenuItem[]>();
    for (const item of visible) {
      const key = item.section ?? '';
      if (!byKey.has(key)) {
        byKey.set(key, []);
        order.push(key);
      }
      byKey.get(key)!.push(item);
    }
    return order.map(key => byKey.get(key)!);
  }, [visible]);

  const rowIndexOf = (item: ActionMenuItem) =>
    rows.findIndex(row => row.kind === 'item' && row.item === item);

  const moveTo = useCallback(
    (index: number) => {
      setActiveIndex(index);
      const row = rows[index];
      if (!row) return;
      requestAnimationFrame(() => {
        rowRefs.current.get(row.id)?.scrollIntoView?.({ block: 'nearest' });
      });
    },
    [rows]
  );

  const enter = (item: ActionMenuItem) => {
    if (!item.children?.length) return false;
    setPath(current => [...current, item]);
    // Land on the submenu's first ACTION, not on the drill-out row above
    // it: arriving on "go back" makes the drill-in feel like it did nothing.
    setActiveIndex(1);
    typeahead.current = emptyTypeahead();
    return true;
  };

  const back = () => {
    if (path.length === 0) return false;
    setPath(current => current.slice(0, -1));
    setActiveIndex(0);
    typeahead.current = emptyTypeahead();
    return true;
  };

  const commit = (row: ActionMenuRow | undefined) => {
    if (!row || row.disabled) return;
    if (row.kind === 'back') {
      back();
      return;
    }
    if (enter(row.item)) return;
    close('select', row.item);
    row.item.onSelect?.();
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    // Radix's document-level listener owns Escape (`onEscapeKeyDown`), and
    // stopping it here would let the workspace key layer see the key.
    if (event.key === 'Escape') return;
    if (event.key === 'Tab') {
      event.preventDefault();
      close(event.shiftKey ? 'tab-previous' : 'tab-next');
      return;
    }
    if (event.key === 'ArrowRight') {
      const row = rows[activeIndex];
      if (row?.kind === 'item' && enter(row.item)) event.preventDefault();
      return;
    }
    if (event.key === 'ArrowLeft') {
      if (back()) event.preventDefault();
      return;
    }
    const movement = resolveMenuKey(rows, event.key, activeIndex);
    if (movement) {
      event.preventDefault();
      if (movement.kind === 'move') moveTo(movement.index);
      else if (movement.kind === 'commit') commit(rows[movement.index]);
      return;
    }
    const hasModifier = event.metaKey || event.ctrlKey || event.altKey;
    if (!isTypeaheadCharacter(event.key, hasModifier)) return;
    event.preventDefault();
    const result = applyTypeahead(
      rows,
      typeahead.current,
      event.key,
      activeIndex,
      Date.now()
    );
    typeahead.current = result.state;
    if (result.index !== null) moveTo(result.index);
  };

  const active = rows[activeIndex] ?? null;
  const highlight = accent
    ? { background: tint(accent, 18), boxShadow: `inset 2px 0 0 ${accent}` }
    : undefined;

  const renderRow = (item: ActionMenuItem) => {
    if (item.announcedComing) {
      return (
        <div
          key={item.id}
          data-readiness="announced"
          title={`Coming soon: ${item.announcedComing}`}
          aria-label={`${item.announcedComing}, coming soon`}
          className="cursor-default select-none px-3 py-1.5 font-mono text-chrome-label"
          style={{ color: READINESS_NEUTRAL }}
        >
          <span inert className="opacity-80">
            {item.label}
          </span>
        </div>
      );
    }
    const index = rowIndexOf(item);
    const isActive = index === activeIndex;
    return (
      <div
        key={item.id}
        id={`${listId}-${item.id}`}
        ref={element => {
          if (element) rowRefs.current.set(item.id, element);
          else rowRefs.current.delete(item.id);
        }}
        role="menuitem"
        aria-label={item.accessibleLabel}
        aria-disabled={item.disabled || undefined}
        data-active={isActive || undefined}
        {...item.attributes}
        onPointerMove={() => setActiveIndex(index)}
        onClick={() => commit(rows[index])}
        className={cn(
          'flex cursor-pointer items-baseline gap-3 px-3 py-1.5 font-mono text-chrome-label transition-[background-color] duration-75 motion-reduce:transition-none',
          isActive && !accent && 'bg-hud-fill-hi',
          item.danger ? (accent ? '' : 'text-hud-red') : 'text-hud-text',
          item.disabled && 'cursor-not-allowed opacity-55'
        )}
        style={{
          ...(isActive ? highlight : undefined),
          ...(item.danger && accent ? { color: accent } : undefined),
        }}
      >
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate">{item.label}</span>
          {item.disabled && item.disabledReason ? (
            <span className="font-mono text-chrome-micro leading-4 text-hud-amber/80">
              {item.disabledReason}
            </span>
          ) : null}
        </span>
        {item.children?.length ? <span aria-hidden>›</span> : null}
        {item.detail ? (
          <span className="shrink-0 text-chrome-micro text-hud-text-dim">
            {item.detail}
          </span>
        ) : null}
        {item.note ? (
          <span
            className="shrink-0 text-chrome-micro"
            style={{ color: READINESS_NEUTRAL }}
          >
            {item.note}
          </span>
        ) : null}
      </div>
    );
  };

  return (
    <Popover
      open={open}
      onOpenChange={next => {
        if (!next) close(reasonRef.current);
      }}
    >
      <PopoverAnchor virtualRef={virtualRef} />
      <PopoverContent
        side="bottom"
        align="start"
        sideOffset={0}
        collisionPadding={8}
        onOpenAutoFocus={event => {
          // Focus the list itself, not its first row: one element owns the
          // keyboard and `aria-activedescendant` names the highlighted row.
          event.preventDefault();
          listRef.current?.focus({ preventScroll: true });
        }}
        onCloseAutoFocus={event => {
          // The caller restored focus the moment the gesture happened; Radix
          // would otherwise focus a trigger this menu does not have.
          event.preventDefault();
        }}
        onEscapeKeyDown={event => {
          if (path.length > 0) {
            event.preventDefault();
            back();
            return;
          }
          reasonRef.current = 'escape';
        }}
        onPointerDownOutside={() => {
          reasonRef.current = 'outside';
        }}
        onFocusOutside={() => {
          reasonRef.current = 'outside';
        }}
        className={cn(
          'flex w-auto min-w-44 max-w-[min(26rem,calc(100vw-2rem))] flex-col rounded border-hud-stroke-soft bg-hud-deep p-0',
          'max-h-[min(24rem,var(--radix-popover-content-available-height,24rem))]'
        )}
        style={
          accent
            ? {
                borderColor: tint(accent, 27),
                boxShadow: `0 12px 32px color-mix(in srgb, var(--color-hud-void) 55%, transparent), 0 0 10px ${tint(accent, 13)}`,
              }
            : undefined
        }
      >
        <div
          ref={listRef}
          id={listId}
          role="menu"
          aria-label={label}
          aria-activedescendant={active ? `${listId}-${active.id}` : undefined}
          tabIndex={0}
          onKeyDown={onKeyDown}
          className="min-h-0 flex-1 overflow-y-auto py-1 outline-none"
          {...attributes}
        >
          {parent ? (
            <div
              id={`${listId}-back`}
              ref={element => {
                if (element) rowRefs.current.set('back', element);
                else rowRefs.current.delete('back');
              }}
              role="menuitem"
              aria-label={`Back from ${parent.label}`}
              data-active={activeIndex === 0 || undefined}
              onPointerMove={() => setActiveIndex(0)}
              onClick={() => back()}
              className={cn(
                'flex cursor-pointer items-baseline gap-3 border-b border-hud-stroke-faint px-3 py-1.5 font-mono text-chrome-label text-hud-text-dim',
                activeIndex === 0 && !accent && 'bg-hud-fill-hi'
              )}
              style={activeIndex === 0 ? highlight : undefined}
            >
              <span aria-hidden>‹</span>
              <span className="min-w-0 flex-1 truncate">{parent.label}</span>
            </div>
          ) : null}
          {sections.map((section, index) => (
            <Fragment key={section[0]?.section ?? index}>
              {index > 0 ? (
                <div
                  role="separator"
                  className="my-1 border-t border-hud-divider"
                />
              ) : null}
              {section.map(renderRow)}
            </Fragment>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
