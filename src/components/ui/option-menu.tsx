'use client';

/**
 * OptionMenu — the project's one dropdown (ENG-016 D49, decision `0033`).
 *
 * Built on the Radix Popover the app already depends on, with a real
 * roving-focus listbox inside it rather than a search-first `Command`. The
 * launcher's first cut wrapped cmdk and mounted its input only for long lists,
 * so short lists had no focused element at all: no arrows, no type-ahead. That
 * is the "not very good menus or input system" the operator hit.
 *
 * What this gives every dropdown that adopts it:
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

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Search } from 'lucide-react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
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
  options: readonly OptionMenuOption[];
  value: string | null;
  onValueChange: (optionId: string) => void;
  /** Accessible name for the control. */
  label: string;
  placeholder?: string;
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
  options,
  value,
  onValueChange,
  label,
  placeholder,
  disabled,
  searchable,
  footer,
  provenance,
  tone = 'normal',
  triggerMark,
  className,
  contentClassName,
}: OptionMenuProps) {
  const [open, setOpen] = useState(false);
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
  const flat = useMemo(
    () => groups.flatMap(group => group.options),
    [groups]
  );

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
      setOpen(false);
    },
    [onValueChange]
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
          aria-label={`${label}: ${selected?.label ?? placeholder ?? 'not set'}`}
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
              {selected?.label ?? placeholder ?? '—'}
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
        onKeyDown={onKeyDown}
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
          'w-[min(26rem,calc(100vw-2rem))] border-hud-stroke-soft bg-hud-deep p-0',
          contentClassName
        )}
      >
        {showSearch ? (
          <div className="flex items-center gap-2 border-b border-hud-divider px-2.5">
            <Search aria-hidden="true" className="size-3.5 shrink-0 text-hud-text-dim" />
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
          className="max-h-72 overflow-y-auto py-1 outline-none"
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
          <div className="border-t border-hud-divider p-1">{footer}</div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
