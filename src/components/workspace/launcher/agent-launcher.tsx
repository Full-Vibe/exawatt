'use client';

/**
 * The New Agent surface (ENG-016 D49).
 *
 * Fully controlled and free of persistence, IPC, and launch behaviour so the
 * gallery bench and the composer render the identical component. What the
 * operator sees is task → row → Start, with everything else reachable but
 * silent until asked for:
 *
 *   - no Project/product name above it (finding 10) — the chrome already says it
 *   - no second control row, no duplicated Customize icon (findings 6, 7)
 *   - no co-visible "All configurations" and "Customize" (finding 5)
 *   - no `Shapes` link, no "Optional name" field (findings 8, 9)
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { SetupRow } from './setup-row';
import { SetupDetailPanel, type DetailAxis } from './setup-detail';
import type { SetupChipVariant } from './setup-chip';
import {
  setupAccessibleLabel,
  type LauncherRowState,
  type LauncherSetup,
} from './launcher-model';

export interface AgentLauncherProps {
  setups: readonly LauncherSetup[];
  selectedId: string | null;
  state: LauncherRowState;
  /** Axes for the selected setup. Empty while nothing is selected. */
  axes: readonly DetailAxis[];
  detailFootnote?: string;
  task: string;
  onTaskChange: (task: string) => void;
  onSelect: (id: string) => void;
  onOpenCatalog: () => void;
  onStart: () => void;
  launching?: boolean;
  /** Blocks Start with a stated reason; never silently disabled. */
  blockedReason?: string | null;
  variant?: SetupChipVariant;
  placeholderCount?: number;
  /** Bench escape hatch: force the detail panel open for a screenshot. */
  forceDetailOpen?: boolean;
  className?: string;
}

export function AgentLauncher({
  setups,
  selectedId,
  state,
  axes,
  detailFootnote,
  task,
  onTaskChange,
  onSelect,
  onOpenCatalog,
  onStart,
  launching = false,
  blockedReason,
  variant,
  placeholderCount,
  forceDetailOpen,
  className,
}: AgentLauncherProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [notchPosition, setNotchPosition] = useState<number | null>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const taskRef = useRef<HTMLTextAreaElement>(null);

  const open = forceDetailOpen === true || expandedId !== null;
  const anchorId = forceDetailOpen ? (expandedId ?? selectedId) : expandedId;
  const selected = setups.find(setup => setup.id === selectedId) ?? null;

  // The selection moving is what the notch follows, so the measurement is tied
  // to the anchor rather than to the open/close transition.
  useLayoutEffect(() => {
    const row = rowRef.current;
    if (!row || anchorId === null) return;
    const measure = () => {
      const chip = row.querySelector<HTMLElement>(
        `[data-setup-id="${CSS.escape(anchorId)}"]`
      );
      if (!chip) return;
      const rowBox = row.getBoundingClientRect();
      const chipBox = chip.getBoundingClientRect();
      if (rowBox.width === 0) return;
      setNotchPosition(
        (chipBox.left + chipBox.width / 2 - rowBox.left) / rowBox.width
      );
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(row);
    return () => observer.disconnect();
  }, [anchorId, setups]);

  // A setup leaving the row must not strand an open panel pointing at nothing.
  useEffect(() => {
    if (expandedId && !setups.some(setup => setup.id === expandedId)) {
      setExpandedId(null);
    }
  }, [expandedId, setups]);

  const toggleDetail = useCallback((id: string) => {
    setExpandedId(current => (current === id ? null : id));
  }, []);

  const startBlocked = Boolean(blockedReason) || launching || selected === null;

  return (
    <form
      data-agent-launcher
      className={cn('flex w-full min-w-0 flex-col gap-2', className)}
      onSubmit={event => {
        event.preventDefault();
        if (!startBlocked) onStart();
      }}
      onKeyDown={event => {
        if (event.key === 'Escape' && expandedId) {
          event.stopPropagation();
          setExpandedId(null);
          requestAnimationFrame(() => taskRef.current?.focus());
        }
      }}
    >
      <textarea
        ref={taskRef}
        rows={1}
        value={task}
        maxLength={8_000}
        onChange={event => onTaskChange(event.target.value)}
        onKeyDown={event => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            if (!startBlocked) onStart();
          }
        }}
        placeholder="What should this Agent do?"
        aria-label="Initial task for the new Agent"
        className="max-h-40 min-h-11 w-full resize-none rounded-md border border-hud-stroke-soft bg-hud-surface-input px-3 py-2 font-mono text-xs leading-5 text-hud-text outline-none transition-colors [field-sizing:content] placeholder:text-hud-text-dim/80 hover:border-hud-cyan/40 focus-visible:ring-1 focus-visible:ring-hud-cyan motion-reduce:transition-none"
      />

      <div ref={rowRef} className="flex min-w-0 items-stretch gap-2">
        <SetupRow
          setups={setups}
          selectedId={selectedId}
          expandedId={open ? anchorId : null}
          state={state}
          variant={variant}
          placeholderCount={placeholderCount}
          onSelect={id => {
            onSelect(id);
            // Selecting a different chip while the panel is open re-anchors it
            // rather than closing and reopening: the notch slides across.
            setExpandedId(current => (current === null ? null : id));
          }}
          onToggleDetail={toggleDetail}
          onOpenCatalog={onOpenCatalog}
          className="flex-1"
        />
        <div className="flex shrink-0 flex-col justify-stretch gap-2">
          <Button
            type="submit"
            data-launcher-start
            aria-busy={launching}
            disabled={startBlocked}
            title={blockedReason ?? undefined}
            className="h-full min-w-24 motion-reduce:transition-none"
          >
            {launching ? (
              <LoaderCircle
                aria-hidden="true"
                className="animate-spin motion-reduce:animate-none"
              />
            ) : null}
            {launching ? 'Starting…' : 'Start'}
          </Button>
        </div>
      </div>

      <SetupDetailPanel
        open={open && axes.length > 0}
        notchPosition={notchPosition}
        axes={axes}
        footnote={detailFootnote}
      />

      {blockedReason ? (
        <p
          role="status"
          className="font-mono text-chrome-micro leading-4 text-hud-amber/85"
        >
          {blockedReason}
        </p>
      ) : null}

      <p
        aria-hidden="true"
        data-launcher-hints
        className="px-0.5 font-mono text-chrome-micro leading-none text-hud-text-dim"
      >
        ⏎ start · ⌥↑↓ setup · ⇥ adjust · ⌘⌥T shell · ⌘V image · ⇧⏎ newline
      </p>

      <span className="sr-only" aria-live="polite">
        {state === 'settling'
          ? 'Checking which engines are available.'
          : selected
            ? `Selected ${setupAccessibleLabel(selected)}.`
            : ''}
      </span>
    </form>
  );
}
