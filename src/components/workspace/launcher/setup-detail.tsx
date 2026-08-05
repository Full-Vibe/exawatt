'use client';

/**
 * The detail view that ribbons out of a selected setup (ENG-016 D49).
 *
 * Two parts, deliberately separate:
 *
 *   `SetupDrawerHandle` — the closed face, attached to the row's bottom
 *     edge, naming the axes it holds.
 *   `SetupDetailPanel`  — the open face. The editable axes, and NOTHING that
 *     restates them; the axes' own values are the only place those values
 *     appear inside the drawer.
 *
 * Every axis is one Tab stop, so the operator can land in the panel, change
 * one thing, and Tab straight to Start.
 */

import { useEffect, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { OptionMenu, type OptionMenuOption } from '@/components/ui/option-menu';
import { cn } from '@/lib/utils';

export type DetailAxisOption = OptionMenuOption;

export interface DetailAxis {
  id: string;
  label: string;
  value: string | null;
  /** Flex weight. Model names are long, so Model earns more width than Engine. */
  weight?: number;
  /** Shown when `value` is null — never a fabricated selection. */
  placeholder?: string;
  options: readonly DetailAxisOption[];
  onChange: (optionId: string) => void;
  disabled?: boolean;
  /** Provenance line under the option list, e.g. "Reported by Claude Code". */
  provenance?: string;
  /** Real actions inside the menu, e.g. a route to Settings, or Refresh. */
  footer?: React.ReactNode;
  /** Emphasis for an axis that carries risk, e.g. permissions. */
  tone?: 'normal' | 'caution';
  /** Force the search field on or off; defaults to on above 10 options. */
  searchable?: boolean;
}

function axisMark(axis: DetailAxis): React.ReactNode {
  return axis.options.find(option => option.id === axis.value)?.mark ?? null;
}

export interface SetupDetailFieldsProps {
  axes: readonly DetailAxis[];
  footnote?: string;
  /** Rendered opposite the footnote, where there was already empty space. */
  onDone?: () => void;
}

export function SetupDetailFields({
  axes,
  footnote,
  onDone,
}: SetupDetailFieldsProps) {
  return (
    <div data-setup-detail-fields className="flex min-w-0 flex-col gap-2">
      <div className="flex min-w-0 items-end gap-2">
        {axes.map(axis => (
          <label
            key={axis.id}
            data-detail-axis={axis.id}
            className="flex min-w-0 flex-col gap-1"
            style={{ flex: `${axis.weight ?? 1} 1 0%` }}
          >
            <span className="font-mono text-chrome-micro leading-[0.875rem] text-hud-text-dim">
              {axis.label}
            </span>
            <OptionMenu
              label={axis.label}
              options={axis.options}
              value={axis.value}
              onValueChange={axis.onChange}
              placeholder={axis.placeholder}
              disabled={axis.disabled}
              provenance={axis.provenance}
              footer={axis.footer}
              tone={axis.tone}
              searchable={axis.searchable}
              triggerMark={axisMark(axis)}
            />
          </label>
        ))}
      </div>
      {footnote || onDone ? (
        <div className="flex min-w-0 items-center justify-between gap-3">
          <p className="min-w-0 font-mono text-chrome-micro leading-4 text-hud-text-dim">
            {footnote}
          </p>
          {onDone ? (
            <button
              type="button"
              data-setup-drawer-done
              onClick={onDone}
              className="flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 font-mono text-chrome-micro text-hud-text-dim outline-none transition-colors hover:bg-hud-fill hover:text-hud-text focus-visible:ring-2 focus-visible:ring-hud-cyan motion-reduce:transition-none"
            >
              Done
              <ChevronUp aria-hidden="true" className="size-3.5" />
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * The drawer, closed and open, as ONE attached element.
 *
 * Two corrections from the operator's round-3 review (2026-08-04):
 *
 *   "the arrow handle is disconnected from the card, gap looks bad" — the
 *   handle sat in its own flex child under a `gap-2` row, so it floated. It
 *   is now flush: the row's bottom border and the drawer's top border are the
 *   same line, and a tick on that line sits under the selected chip.
 *
 *   "it doesn't communicate what's in it" — a bare chevron says a thing
 *   exists, not what it is. Closed, the drawer names the axes it holds.
 *   Naming the AXES is not the read-only summary that was deleted before
 *   that one restated the chip's VALUES; this restates nothing, and it
 *   disappears when the drawer opens and the real labels take over.
 */
export function SetupDrawerHandle({
  open,
  axes,
  tickPosition,
  onToggle,
  disabled,
}: {
  open: boolean;
  axes: readonly DetailAxis[];
  /** 0..1 across the launcher: where the selected chip is. */
  tickPosition: number | null;
  onToggle: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      data-setup-drawer-handle
      data-open={open || undefined}
      aria-expanded={open}
      aria-label={
        open
          ? 'Hide setup options'
          : `Adjust ${axes.map(axis => axis.label.toLowerCase()).join(', ')}`
      }
      disabled={disabled}
      onClick={onToggle}
      // Open, this collapses to nothing rather than staying as a full-width
      // band holding one right-aligned word. The Done control moves into the
      // panel's footnote line, which was already half empty.
      className={cn(
        'relative flex w-full items-center justify-between gap-2 overflow-hidden border-hud-stroke-faint bg-hud-surface-input px-3 text-left outline-none',
        // The row above owns this border. Overlapping by exactly 1px makes the
        // chips' bottom edge and the drawer's top edge one line, not two.
        '-mt-px rounded-b-lg',
        'transition-[height,opacity,border-color,background-color] duration-200 ease-[cubic-bezier(0.2,0,0,1)] motion-reduce:transition-none',
        'focus-visible:ring-2 focus-visible:ring-hud-cyan focus-visible:ring-offset-2 focus-visible:ring-offset-hud-void',
        'disabled:cursor-not-allowed disabled:opacity-40',
        open
          ? 'pointer-events-none h-0 border-0 opacity-0'
          : 'h-8 border hover:border-hud-cyan/45 hover:bg-hud-fill'
      )}
    >
      {/* The tick is the connection to ONE chip: a segment of the shared
          border, lit, that slides with the selection. */}
      {tickPosition === null ? null : (
        <span
          aria-hidden="true"
          data-setup-drawer-tick
          style={{ left: `${tickPosition * 100}%` }}
          className={cn(
            'absolute -top-px h-px w-10 -translate-x-1/2 bg-hud-cyan/70',
            'transition-[left,opacity] duration-[220ms] ease-[cubic-bezier(0.2,0,0,1)] motion-reduce:transition-none',
            open && 'opacity-0'
          )}
        />
      )}

      <span className="min-w-0 truncate font-mono text-chrome-micro text-hud-text-dim">
        {axes.map(axis => axis.label).join('  ·  ')}
      </span>
      <span className="flex shrink-0 items-center gap-1.5 font-mono text-chrome-micro text-hud-text-dim">
        Adjust
        <ChevronDown aria-hidden="true" className="size-3.5" />
      </span>
    </button>
  );
}

export interface SetupDetailPanelProps extends SetupDetailFieldsProps {
  open: boolean;
}

/**
 * Height animates through a `grid-template-rows` 0fr→1fr transition, so the
 * panel opens against its real content height without a measured pixel value.
 */
export function SetupDetailPanel({ open, ...fields }: SetupDetailPanelProps) {
  const [mounted, setMounted] = useState(open);

  useEffect(() => {
    if (open) setMounted(true);
  }, [open]);

  return (
    <div
      data-setup-detail
      data-open={open || undefined}
      aria-hidden={!open}
      className={cn(
        'grid transition-[grid-template-rows,opacity] duration-[220ms] ease-[cubic-bezier(0.2,0,0,1)] motion-reduce:transition-none',
        open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
      )}
      onTransitionEnd={() => {
        if (!open) setMounted(false);
      }}
    >
      <div className="min-h-0 overflow-hidden">
        {/* Shares the handle's bottom border, so handle and panel read as one
            drawer rather than two stacked boxes. */}
        <div className="-mt-px rounded-b-lg border border-hud-cyan/30 bg-hud-panel p-3">
          {mounted ? <SetupDetailFields {...fields} /> : null}
        </div>
      </div>
    </div>
  );
}
