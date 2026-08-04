'use client';

/**
 * The detail view that ribbons out of a selected setup (ENG-016 D49).
 *
 * Two deliberate seams so the mechanic can change without a rewrite:
 *
 *   `SetupDetailFields` — WHAT is editable. One flat tab-through line of axes
 *     driven by plain data, so the gallery bench and the composer feed it the
 *     same way and neither owns a bespoke layout.
 *   `SetupDetailPanel`  — WHERE it appears. The inline mechanic: a panel that
 *     grows under the row with a notch that slides to the selected chip. A
 *     popover or in-place mechanic hosts the identical fields.
 *
 * Every axis is one Tab stop and closes on Enter, so the operator can land in
 * the panel, change one thing, and Tab straight to Start.
 */

import { useEffect, useState } from 'react';
import { Check, ChevronDown, Search } from 'lucide-react';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { cn } from '@/lib/utils';

/** Long lists become searchable rather than a scrolling wall. */
const SEARCHABLE_THRESHOLD = 10;

export interface DetailAxisOption {
  id: string;
  label: string;
  description?: string;
  /** Optional grouping header, e.g. an OpenCode provider. */
  group?: string;
  available?: boolean;
  unavailableReason?: string;
}

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
  /** Provenance line under the option list, e.g. "Default from Codex config". */
  provenance?: string;
  /** Emphasis for an axis that carries risk, e.g. permissions. */
  tone?: 'normal' | 'caution';
}

function AxisControl({ axis }: { axis: DetailAxis }) {
  const [open, setOpen] = useState(false);
  const selected = axis.options.find(option => option.id === axis.value) ?? null;
  const searchable = axis.options.length > SEARCHABLE_THRESHOLD;
  const groups = Array.from(
    new Set(axis.options.map(option => option.group ?? ''))
  );

  return (
    <label
      data-detail-axis={axis.id}
      className="flex min-w-0 flex-col gap-1"
      style={{ flex: `${axis.weight ?? 1} 1 0%` }}
    >
      <span className="font-mono text-chrome-micro leading-[0.875rem] text-hud-text-dim">
        {axis.label}
      </span>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={axis.disabled}
            aria-label={`${axis.label}: ${selected?.label ?? axis.placeholder ?? 'not set'}`}
            className={cn(
              'flex h-9 min-w-0 items-center justify-between gap-2 rounded-md border border-hud-stroke-faint bg-hud-deep px-2.5 text-left outline-none',
              'transition-[border-color,background-color] duration-150 motion-reduce:transition-none',
              'hover:border-hud-cyan/45 focus-visible:ring-2 focus-visible:ring-hud-cyan',
              'disabled:cursor-not-allowed disabled:opacity-50',
              axis.tone === 'caution' && selected && 'border-hud-amber/35'
            )}
          >
            <span className="flex min-w-0 items-center gap-1.5">
              {axis.tone === 'caution' ? (
                <span
                  aria-hidden="true"
                  className="size-1.5 shrink-0 rounded-full bg-hud-text-dim"
                />
              ) : null}
              <span
                className={cn(
                  'min-w-0 truncate font-mono text-chrome-label',
                  selected ? 'text-hud-text' : 'text-hud-text-dim'
                )}
              >
                {selected?.label ?? axis.placeholder ?? '—'}
              </span>
            </span>
            <ChevronDown
              aria-hidden="true"
              className="size-3.5 shrink-0 text-hud-text-dim"
            />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-[min(24rem,calc(100vw-2rem))] border-hud-stroke-soft bg-hud-deep p-0"
        >
          <Command>
            {searchable ? (
              <div className="flex items-center gap-2 border-b border-hud-divider px-2">
                <Search aria-hidden="true" className="size-3.5 text-hud-text-dim" />
                <CommandInput
                  placeholder={`Search ${axis.label.toLowerCase()}…`}
                  className="h-9 border-0 font-mono text-chrome-label"
                />
              </div>
            ) : null}
            <CommandList className="max-h-64">
              <CommandEmpty className="px-3 py-4 font-mono text-chrome-meta text-hud-text-dim">
                Nothing matches that.
              </CommandEmpty>
              {groups.map(group => (
                <CommandGroup
                  key={group || 'default'}
                  heading={group || undefined}
                >
                  {axis.options
                    .filter(option => (option.group ?? '') === group)
                    .map(option => (
                      <CommandItem
                        key={option.id}
                        value={`${option.label} ${option.id}`}
                        disabled={option.available === false}
                        onSelect={() => {
                          axis.onChange(option.id);
                          setOpen(false);
                        }}
                        className="items-start gap-2 font-mono"
                      >
                        <Check
                          aria-hidden="true"
                          className={cn(
                            'mt-0.5 size-3.5 shrink-0',
                            option.id === axis.value
                              ? 'text-hud-cyan'
                              : 'opacity-0'
                          )}
                        />
                        <span className="flex min-w-0 flex-col">
                          <span className="text-chrome-label text-hud-text">
                            {option.label}
                          </span>
                          {option.description ? (
                            <span className="text-chrome-micro leading-4 text-hud-text-dim">
                              {option.description}
                            </span>
                          ) : null}
                          {option.available === false &&
                          option.unavailableReason ? (
                            <span className="text-chrome-micro leading-4 text-hud-amber/80">
                              {option.unavailableReason}
                            </span>
                          ) : null}
                        </span>
                      </CommandItem>
                    ))}
                </CommandGroup>
              ))}
            </CommandList>
            {axis.provenance ? (
              <p className="border-t border-hud-divider px-3 py-2 font-mono text-chrome-micro leading-4 text-hud-text-dim">
                {axis.provenance}
              </p>
            ) : null}
          </Command>
        </PopoverContent>
      </Popover>
    </label>
  );
}

export interface SetupDetailFieldsProps {
  axes: readonly DetailAxis[];
  /** Trailing content, normally the Start affordance or a save action. */
  trailing?: React.ReactNode;
  footnote?: string;
}

export function SetupDetailFields({
  axes,
  trailing,
  footnote,
}: SetupDetailFieldsProps) {
  return (
    <div data-setup-detail-fields className="flex min-w-0 flex-col gap-2">
      <div className="flex min-w-0 items-end gap-2">
        {axes.map(axis => (
          <AxisControl key={axis.id} axis={axis} />
        ))}
        {trailing ? <div className="shrink-0">{trailing}</div> : null}
      </div>
      {footnote ? (
        <p className="font-mono text-chrome-micro leading-4 text-hud-text-dim">
          {footnote}
        </p>
      ) : null}
    </div>
  );
}

export interface SetupDetailPanelProps extends SetupDetailFieldsProps {
  open: boolean;
  /** 0..1 across the row: where the notch points. */
  notchPosition: number | null;
  labelledBy?: string;
}

/**
 * Inline mechanic. Height animates through a `grid-template-rows` 0fr→1fr
 * transition so the panel opens against its real content height without a
 * measured pixel value, and the notch tweens along the row rather than
 * jumping, which is what makes the panel read as belonging to one chip.
 */
export function SetupDetailPanel({
  open,
  notchPosition,
  labelledBy,
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
          {notchPosition === null ? null : (
            <span
              aria-hidden="true"
              data-setup-detail-notch
              className="absolute top-[3px] size-2.5 -translate-x-1/2 rotate-45 border-l border-t border-hud-cyan/50 bg-hud-panel transition-[left] duration-[220ms] ease-[cubic-bezier(0.2,0,0,1)] motion-reduce:transition-none"
              style={{ left: `${notchPosition * 100}%` }}
            />
          )}
          <div
            role="group"
            aria-labelledby={labelledBy}
            className="rounded-lg border border-hud-cyan/30 bg-hud-panel p-3"
          >
            {mounted ? <SetupDetailFields {...fields} /> : null}
          </div>
        </div>
      </div>
    </div>
  );
}
