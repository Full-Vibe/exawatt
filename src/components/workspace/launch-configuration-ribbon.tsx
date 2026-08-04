'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Pin, Settings2, TerminalSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { PtyHarness } from '@/types/electron';
import { HarnessGlyph } from './harness-icons';
import { HARNESS_META } from './harnesses';
import { SourceIdentityMark } from './source-identity-mark';

export interface LaunchConfigurationRibbonItem {
  id: string;
  /** Short, visible name such as “Reviewer” or “GPT-5 · High”. */
  label: string;
  /** Optional compact source or model detail. Hidden at compact widths. */
  detail?: string;
  /** Complete spoken and tooltip label; never inferred from truncated copy. */
  accessibleLabel: string;
  source: PtyHarness;
  named?: boolean;
  pinned?: boolean;
  available?: boolean;
  unavailableReason?: string;
}

export interface LaunchConfigurationRibbonProps {
  items: readonly LaunchConfigurationRibbonItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onCustomize: () => void;
  onShowAll: () => void;
  ariaLabel?: string;
  customizeLabel?: string;
  allLabel?: string;
  /** Keeps the catalog disclosure visible in deterministic studies and benches. */
  alwaysShowAll?: boolean;
  className?: string;
}

function isAvailable(item: LaunchConfigurationRibbonItem): boolean {
  return item.available !== false;
}

function itemAccessibleLabel(item: LaunchConfigurationRibbonItem): string {
  const state = [
    item.named ? 'named configuration' : null,
    item.pinned ? 'pinned' : null,
    !isAvailable(item)
      ? `unavailable${item.unavailableReason ? `: ${item.unavailableReason}` : ''}`
      : null,
  ].filter(Boolean);

  return state.length > 0
    ? `${item.accessibleLabel}, ${state.join(', ')}`
    : item.accessibleLabel;
}

function ConfigurationMark({ source }: { source: PtyHarness }) {
  const meta = HARNESS_META[source];

  if (source === 'shell') {
    return (
      <SourceIdentityMark color={meta.color}>
        <TerminalSquare className="size-3" strokeWidth={1.8} />
      </SourceIdentityMark>
    );
  }

  return (
    <SourceIdentityMark color={meta.color}>
      <HarnessGlyph harness={source} size={12} />
    </SourceIdentityMark>
  );
}

/**
 * Task-first Launch Configuration picker. This component deliberately owns no
 * persistence or launch behavior: callers provide a selected view model and
 * commit selection only through callbacks.
 */
export function LaunchConfigurationRibbon({
  items,
  selectedId,
  onSelect,
  onCustomize,
  onShowAll,
  ariaLabel = 'Launch configuration',
  customizeLabel = 'Customize',
  allLabel = 'All',
  alwaysShowAll = false,
  className,
}: LaunchConfigurationRibbonProps) {
  const selectableItems = useMemo(() => [...items], [items]);
  const selectedExists = selectableItems.some(item => item.id === selectedId);
  const defaultFocusId = selectedExists
    ? selectedId
    : (selectableItems[0]?.id ?? null);
  const [focusId, setFocusId] = useState<string | null>(defaultFocusId);
  const [activeFocusId, setActiveFocusId] = useState<string | null>(null);
  const [overflowing, setOverflowing] = useState(false);
  const viewportRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef(new Map<string, HTMLButtonElement>());

  useEffect(() => {
    if (defaultFocusId !== null) setFocusId(defaultFocusId);
  }, [defaultFocusId]);

  const measureOverflow = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    setOverflowing(viewport.scrollWidth > viewport.clientWidth + 1);
  }, []);

  useEffect(() => {
    measureOverflow();
    const viewport = viewportRef.current;
    if (!viewport || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measureOverflow);
    observer.observe(viewport);
    if (viewport.firstElementChild)
      observer.observe(viewport.firstElementChild);
    return () => observer.disconnect();
  }, [items, measureOverflow]);

  const moveSelection = useCallback(
    (currentId: string, direction: -1 | 1 | 'first' | 'last') => {
      if (selectableItems.length === 0) return;
      const currentIndex = selectableItems.findIndex(
        item => item.id === currentId
      );
      let nextIndex: number;
      if (direction === 'first') nextIndex = 0;
      else if (direction === 'last') nextIndex = selectableItems.length - 1;
      else {
        const origin = currentIndex >= 0 ? currentIndex : 0;
        nextIndex =
          (origin + direction + selectableItems.length) %
          selectableItems.length;
      }
      const next = selectableItems[nextIndex];
      setFocusId(next.id);
      onSelect(next.id);
      requestAnimationFrame(() => {
        const element = itemRefs.current.get(next.id);
        element?.focus();
        element?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
      });
    },
    [selectableItems, onSelect]
  );

  const showAll = alwaysShowAll || overflowing;

  return (
    <TooltipProvider delayDuration={350}>
      <div
        data-launch-configuration-ribbon
        data-overflowing={showAll || undefined}
        className={cn(
          '@container flex min-w-0 items-center gap-1.5 font-ui',
          className
        )}
      >
        <div
          ref={viewportRef}
          data-launch-configuration-viewport
          className="min-w-0 flex-1 overflow-x-auto overscroll-x-contain rounded-md [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          <div
            role="radiogroup"
            aria-label={ariaLabel}
            className="flex w-max min-w-full items-center gap-1.5 p-0.5"
          >
            {items.map(item => {
              const selected = item.id === selectedId;
              const available = isAvailable(item);
              const spokenLabel = itemAccessibleLabel(item);
              const isFocused = activeFocusId === item.id;

              return (
                <Tooltip key={item.id}>
                  <TooltipTrigger asChild>
                    <button
                      ref={element => {
                        if (element) itemRefs.current.set(item.id, element);
                        else itemRefs.current.delete(item.id);
                      }}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      aria-disabled={!available || undefined}
                      aria-label={spokenLabel}
                      tabIndex={item.id === focusId ? 0 : -1}
                      data-selected={selected || undefined}
                      data-focused={isFocused || undefined}
                      data-pinned={item.pinned || undefined}
                      data-named={item.named || undefined}
                      data-unavailable={!available || undefined}
                      data-shell={item.source === 'shell' || undefined}
                      onFocus={() => {
                        setFocusId(item.id);
                        setActiveFocusId(item.id);
                      }}
                      onBlur={() => setActiveFocusId(null)}
                      onClick={() => {
                        setFocusId(item.id);
                        onSelect(item.id);
                      }}
                      onKeyDown={event => {
                        const direction =
                          event.key === 'ArrowRight' ||
                          event.key === 'ArrowDown'
                            ? 1
                            : event.key === 'ArrowLeft' ||
                                event.key === 'ArrowUp'
                              ? -1
                              : event.key === 'Home'
                                ? 'first'
                                : event.key === 'End'
                                  ? 'last'
                                  : null;
                        if (direction === null) return;
                        event.preventDefault();
                        moveSelection(item.id, direction);
                      }}
                      className={cn(
                        'group/config inline-flex h-8 max-w-56 shrink-0 items-center gap-1.5 rounded-md border border-border bg-background px-2 text-chrome-label font-medium text-foreground outline-none transition-[background-color,border-color,color,opacity] duration-200 hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background motion-reduce:transition-none',
                        selected &&
                          'border-primary bg-primary/10 text-foreground hover:bg-primary/15',
                        !available && 'border-dashed opacity-60',
                        '@max-[768px]:max-w-44 @max-[520px]:max-w-36'
                      )}
                    >
                      <ConfigurationMark source={item.source} />
                      <span className="min-w-0 truncate">{item.label}</span>
                      {item.detail && (
                        <span className="min-w-0 truncate text-chrome-meta font-normal text-muted-foreground @max-[768px]:hidden">
                          {item.detail}
                        </span>
                      )}
                      {item.pinned && (
                        <Pin
                          aria-hidden="true"
                          className="size-3 shrink-0 text-muted-foreground"
                          fill="currentColor"
                        />
                      )}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="max-w-72">
                    <span>{item.accessibleLabel}</span>
                    {!available && item.unavailableReason ? (
                      <span className="block opacity-75">
                        {item.unavailableReason}
                      </span>
                    ) : null}
                  </TooltipContent>
                </Tooltip>
              );
            })}
          </div>
        </div>

        {showAll && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onShowAll}
            aria-label="All launch configurations"
            className="shrink-0 gap-1.5 px-2.5 shadow-none @max-[360px]:w-8 @max-[360px]:px-0"
          >
            <span className="@max-[360px]:sr-only">{allLabel}</span>
            <ChevronDown aria-hidden="true" className="size-3.5" />
          </Button>
        )}

        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onCustomize}
          aria-label={customizeLabel}
          className="shrink-0 px-2.5 text-muted-foreground @max-[520px]:w-8 @max-[520px]:px-0"
        >
          <Settings2 aria-hidden="true" className="size-3.5" />
          <span className="@max-[520px]:sr-only">{customizeLabel}</span>
        </Button>
      </div>
    </TooltipProvider>
  );
}
