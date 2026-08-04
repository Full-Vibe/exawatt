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
 *
 * `drawer` picks how the detail view announces itself. Both mechanics host the
 * identical fields; only the closed face differs, which is the whole point of
 * keeping WHAT and WHERE apart in `setup-detail.tsx`.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { SetupRow } from './setup-row';
import {
  SetupDetailHandle,
  SetupDetailPanel,
  SetupDetailSummary,
  type DetailAxis,
} from './setup-detail';
import type { SetupChipVariant } from './setup-chip';
import {
  setupAccessibleLabel,
  type LauncherRowState,
  type LauncherSetup,
} from './launcher-model';

/**
 * `peek`   — a collapsed summary of the current setup is always visible; it IS
 *            the drawer, closed. Nothing is hidden, so nothing has to be found.
 * `handle` — a grip tab hangs under the selected chip and slides with the
 *            selection. Lighter at rest, one more thing to notice.
 */
export type LauncherDrawer = 'peek' | 'handle';

export const LAUNCHER_DRAWERS: readonly LauncherDrawer[] = ['peek', 'handle'];

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
  drawer?: LauncherDrawer;
  launching?: boolean;
  /** Blocks Start with a stated reason; never silently disabled. */
  blockedReason?: string | null;
  variant?: SetupChipVariant;
  placeholderCount?: number;
  /** Bench escape hatch: open the detail panel for a screenshot. */
  defaultDetailOpen?: boolean;
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
  drawer = 'peek',
  launching = false,
  blockedReason,
  variant,
  placeholderCount,
  defaultDetailOpen = false,
  className,
}: AgentLauncherProps) {
  const [open, setOpen] = useState(defaultDetailOpen);
  const [notchPosition, setNotchPosition] = useState<number | null>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const taskRef = useRef<HTMLTextAreaElement>(null);

  const selected = setups.find(setup => setup.id === selectedId) ?? null;
  const ready = state === 'ready' && selected !== null && axes.length > 0;

  // The notch and the handle both follow the SELECTION, not the open state, so
  // switching chips slides them rather than making them disappear and return.
  useLayoutEffect(() => {
    const row = rowRef.current;
    if (!row || !selectedId) return;
    const measure = () => {
      const chip = row.querySelector<HTMLElement>(
        `[data-setup-id="${CSS.escape(selectedId)}"]`
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
  }, [selectedId, setups]);

  useEffect(() => {
    if (state !== 'ready') setOpen(false);
  }, [state]);

  const toggleDetail = useCallback(() => setOpen(current => !current), []);
  const startBlocked = Boolean(blockedReason) || launching || selected === null;

  return (
    <form
      data-agent-launcher
      data-drawer={drawer}
      className={cn('flex w-full min-w-0 flex-col gap-2', className)}
      onSubmit={event => {
        event.preventDefault();
        if (!startBlocked) onStart();
      }}
      onKeyDown={event => {
        if (event.key === 'Escape' && open) {
          event.stopPropagation();
          setOpen(false);
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

      <div className="flex min-w-0 items-stretch gap-2">
        <div ref={rowRef} className="flex min-w-0 flex-1 items-stretch">
          <SetupRow
            setups={setups}
            selectedId={selectedId}
            expandedId={open ? selectedId : null}
            state={state}
            variant={variant}
            placeholderCount={placeholderCount}
            onSelect={onSelect}
            onToggleDetail={toggleDetail}
            onOpenCatalog={onOpenCatalog}
            className="flex-1"
          />
        </div>
        <Button
          type="submit"
          data-launcher-start
          aria-busy={launching}
          disabled={startBlocked}
          title={blockedReason ?? undefined}
          className="min-w-24 shrink-0 self-stretch motion-reduce:transition-none"
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

      {drawer === 'handle' ? (
        <SetupDetailHandle
          open={open}
          notchPosition={notchPosition}
          onToggle={toggleDetail}
          disabled={!ready}
        />
      ) : (
        <SetupDetailSummary
          axes={axes}
          open={open}
          onToggle={toggleDetail}
          disabled={!ready}
        />
      )}

      <SetupDetailPanel
        open={open && ready}
        notchPosition={notchPosition}
        // Both mechanics already anchor themselves — the handle slides to the
        // selected chip, the summary is a full-width face. A notch on top of
        // either is a second pointer at the same thing.
        showNotch={false}
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
            ? `Selected ${setupAccessibleLabel(selected)}.${
                open ? ' Adjusting this setup.' : ''
              }`
            : ''}
      </span>
    </form>
  );
}
