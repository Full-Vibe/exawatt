'use client';

/**
 * The detail view that ribbons out of a selected setup (ENG-016 D49).
 *
 * Two parts, deliberately separate:
 *
 *   `SetupDetailHandle` — the closed face. A grip under the selected chip.
 *   `SetupDetailPanel`  — the open face. The editable axes, and NOTHING that
 *     restates them; the axes' own values are the only place those values
 *     appear inside the drawer.
 *
 * Every axis is one Tab stop, so the operator can land in the panel, change
 * one thing, and Tab straight to Start.
 */

import { useEffect, useState } from 'react';
import { ChevronDown } from 'lucide-react';
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
}

export function SetupDetailFields({ axes, footnote }: SetupDetailFieldsProps) {
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
      {footnote ? (
        <p className="font-mono text-chrome-micro leading-4 text-hud-text-dim">
          {footnote}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The drawer's closed face: a grip that slides to the selected chip.
 *
 * An earlier cut put a read-only summary line here instead — engine, model,
 * thinking, permission as text. It restated the chip above it AND the fields
 * below it, so the same four values appeared three times (operator,
 * 2026-08-04). A drawer pull says "there is more here" without saying anything
 * the surface already says.
 */
export function SetupDetailHandle({
  open,
  notchPosition,
  onToggle,
  disabled,
}: {
  open: boolean;
  notchPosition: number | null;
  onToggle: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="relative h-4">
      <button
        type="button"
        data-setup-detail-handle
        aria-expanded={open}
        aria-label={open ? 'Hide setup options' : 'Adjust this setup'}
        title={open ? 'Hide setup options' : 'Adjust this setup'}
        disabled={disabled}
        onClick={onToggle}
        style={{ left: `${(notchPosition ?? 0.5) * 100}%` }}
        className={cn(
          'absolute top-0 flex h-4 w-14 -translate-x-1/2 items-center justify-center rounded-b-lg border border-t-0 border-hud-stroke-faint bg-hud-surface-input outline-none',
          'transition-[left,border-color,background-color] duration-[220ms] ease-[cubic-bezier(0.2,0,0,1)] motion-reduce:transition-none',
          'hover:border-hud-cyan/45 hover:bg-hud-fill',
          'focus-visible:ring-2 focus-visible:ring-hud-cyan focus-visible:ring-offset-2 focus-visible:ring-offset-hud-void',
          'disabled:cursor-not-allowed disabled:opacity-40',
          open && 'border-hud-cyan/50 bg-hud-fill-hi'
        )}
      >
        {/* A grip, not an icon: three rules read as "pull me" at 4px tall. */}
        <span
          aria-hidden="true"
          className={cn(
            'flex items-center gap-0.5 transition-transform duration-200 motion-reduce:transition-none',
            open && 'rotate-180'
          )}
        >
          <ChevronDown className="size-3 text-hud-text-dim" />
        </span>
      </button>
    </div>
  );
}

export interface SetupDetailPanelProps extends SetupDetailFieldsProps {
  open: boolean;
  /** 0..1 across the row: where the notch points. Null hides the notch. */
  notchPosition: number | null;
  /** The peek mechanic already has a visible closed face, so it needs no notch. */
  showNotch?: boolean;
}

/**
 * Height animates through a `grid-template-rows` 0fr→1fr transition so the
 * panel opens against its real content height without a measured pixel value,
 * and the notch tweens along the row rather than jumping — which is what makes
 * the panel read as belonging to one chip.
 */
export function SetupDetailPanel({
  open,
  notchPosition,
  showNotch = true,
  ...fields
}: SetupDetailPanelProps) {
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
        <div className="relative pt-2">
          {showNotch && notchPosition !== null ? (
            <span
              aria-hidden="true"
              data-setup-detail-notch
              className="absolute top-[3px] size-2.5 -translate-x-1/2 rotate-45 border-l border-t border-hud-cyan/50 bg-hud-panel transition-[left] duration-[220ms] ease-[cubic-bezier(0.2,0,0,1)] motion-reduce:transition-none"
              style={{ left: `${notchPosition * 100}%` }}
            />
          ) : null}
          <div className="rounded-lg border border-hud-cyan/30 bg-hud-panel p-3">
            {mounted ? <SetupDetailFields {...fields} /> : null}
          </div>
        </div>
      </div>
    </div>
  );
}
