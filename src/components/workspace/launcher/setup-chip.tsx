'use client';

/**
 * One whole Agent setup, as a selectable card (ENG-016 D49).
 *
 * The chip is tall on purpose (finding 1). Every fact gets its OWN full-width
 * line with a reserved height, so nothing competes for horizontal space and
 * every chip in the row is the same height by construction — the first cut of
 * this redesign put the role tag beside the engine name and immediately
 * reproduced the `Cl…` truncation the round exists to kill.
 *
 * The harness glyph wears its brand colour and nothing else: no plate, no
 * border box (finding 3).
 *
 * `variant` is a design-iteration seam for the gallery, not a runtime feature.
 */

import { forwardRef } from 'react';
import { Pin, TerminalSquare } from 'lucide-react';
import { cn } from '@/lib/utils';
import { HarnessGlyph } from '../harness-icons';
import {
  LAUNCHER_ROLE_LABEL,
  reasonLabel,
  setupAccessibleLabel,
  type LauncherSetup,
} from './launcher-model';

export type SetupChipVariant = 'role-lede' | 'role-footer' | 'quiet';

export const SETUP_CHIP_VARIANTS: readonly SetupChipVariant[] = [
  'role-lede',
  'role-footer',
  'quiet',
];

function EngineGlyph({ setup }: { setup: LauncherSetup }) {
  return (
    <span
      aria-hidden="true"
      data-engine-glyph
      className="inline-flex size-3.5 shrink-0 items-center justify-center"
      style={{ color: setup.engine.color }}
    >
      {setup.engine.harness === 'shell' ? (
        <TerminalSquare size={14} strokeWidth={1.8} />
      ) : (
        <HarnessGlyph harness={setup.engine.harness} size={14} />
      )}
    </span>
  );
}

export interface SetupChipProps {
  setup: LauncherSetup;
  selected: boolean;
  expanded: boolean;
  variant?: SetupChipVariant;
  tabIndex?: number;
  onSelect: (id: string) => void;
  onToggleDetail: (id: string) => void;
  onKeyDown?: (event: React.KeyboardEvent<HTMLButtonElement>) => void;
}

export const SetupChip = forwardRef<HTMLButtonElement, SetupChipProps>(
  function SetupChip(
    {
      setup,
      selected,
      expanded,
      variant = 'role-lede',
      tabIndex,
      onSelect,
      onToggleDetail,
      onKeyDown,
    },
    ref
  ) {
    const role = LAUNCHER_ROLE_LABEL[setup.role];
    const headline = setup.name ?? setup.engine.label;
    const provenance = setup.available
      ? reasonLabel(setup)
      : (setup.unavailableReason ?? 'Unavailable');

    return (
      <button
        ref={ref}
        type="button"
        role="radio"
        aria-checked={selected}
        // `radio` does not support aria-expanded, and selection is this
        // control's primary semantic. The panel's open state is announced
        // through the launcher's live region instead.
        aria-label={setupAccessibleLabel(setup)}
        title={setupAccessibleLabel(setup)}
        aria-disabled={setup.available ? undefined : true}
        tabIndex={tabIndex}
        data-setup-chip
        data-setup-id={setup.id}
        data-selected={selected || undefined}
        data-expanded={expanded || undefined}
        data-unavailable={setup.available ? undefined : true}
        data-variant={variant}
        onClick={() => (selected ? onToggleDetail(setup.id) : onSelect(setup.id))}
        onKeyDown={onKeyDown}
        className={cn(
          'group/setup relative flex min-w-0 flex-1 basis-0 flex-col items-start rounded-lg border px-3 py-2.5 text-left outline-none',
          'border-hud-stroke-faint bg-hud-surface-input',
          'transition-[border-color,background-color,box-shadow] duration-200 ease-[cubic-bezier(0.2,0,0,1)] motion-reduce:transition-none',
          'hover:border-hud-cyan/45 hover:bg-hud-fill',
          'focus-visible:ring-2 focus-visible:ring-hud-cyan focus-visible:ring-offset-2 focus-visible:ring-offset-hud-void',
          selected && 'border-hud-cyan/70 bg-hud-fill-hi',
          !setup.available && 'opacity-55'
        )}
      >
        {/* Role — the "what kind of worker" axis. Quiet: it is identical on
            every chip until ENG-028 ships more than one Type, and a line that
            repeats four times must not shout. */}
        {variant === 'role-lede' ? (
          <span className="h-3.5 w-full truncate font-mono text-chrome-micro leading-[0.875rem] text-hud-text-dim/70">
            {role}
          </span>
        ) : null}

        <span className="flex h-5 w-full min-w-0 items-center gap-2">
          <EngineGlyph setup={setup} />
          <span className="min-w-0 flex-1 truncate font-ui text-chrome-label font-semibold text-hud-text">
            {headline}
          </span>
          {setup.pinned ? (
            <Pin
              aria-hidden="true"
              fill="currentColor"
              className="size-3 shrink-0 text-hud-text-dim"
            />
          ) : null}
        </span>

        {/* The model is the fact truncation used to eat (finding 2): its own
            line, full width, and the secondary note gets a line of its own
            rather than competing for the same one. */}
        <span className="mt-1.5 h-4 w-full truncate font-mono text-chrome-meta leading-4 text-hud-text">
          {setup.model ?? 'Engine default'}
        </span>
        <span className="h-3.5 w-full truncate font-mono text-chrome-micro leading-[0.875rem] text-hud-text-dim">
          {setup.modelNote ?? ''}
        </span>

        <span className="mt-1.5 h-3.5 w-full truncate font-mono text-chrome-micro leading-[0.875rem] text-hud-text-dim">
          {setup.thinking ? `${setup.thinking} thinking` : 'Engine default'}
        </span>
        <span
          className={cn(
            'h-3.5 w-full truncate font-mono text-chrome-micro leading-[0.875rem]',
            setup.available ? 'text-hud-text-dim/65' : 'text-hud-amber/80'
          )}
        >
          {variant === 'role-footer' ? `${role} · ${provenance}` : provenance}
        </span>
      </button>
    );
  }
);
