'use client';

/**
 * One whole Agent setup, as a selectable card (ENG-016 D49).
 *
 * Line structure, top to bottom, each owning its full width with a reserved
 * height so every chip is the same height by construction:
 *
 *   role      quiet     what kind of worker (ENG-028's axis, Coding for now)
 *   engine    quiet     which harness runs it
 *   MODEL     ANCHOR    the thing actually chosen between, plus its variant
 *   vendor    quiet     who serves the model — only when the engine does not
 *                       imply it, and marked so it can never be mistaken for
 *                       the capability tag beside the model name
 *   thinking  quiet     reasoning effort
 *   why       quietest  provenance for the row's ordering
 *
 * `pending` renders the SAME structure with shimmer blocks instead of text.
 * The skeleton IS this component, so it cannot drift from what it stands in
 * for — an earlier round hand-drew it and the row still jumped on settle.
 *
 * There is deliberately no variant prop. Carrying three layouts side by side
 * was useful for one review and then became permutations to wade through
 * (operator, 2026-08-04); this is the layout.
 */

import { forwardRef } from 'react';
import { Cloud, HardDrive, Pin, TerminalSquare } from 'lucide-react';
import { cn } from '@/lib/utils';
import { HarnessGlyph } from '../harness-icons';
import {
  LAUNCHER_ROLE_LABEL,
  reasonLabel,
  setupAccessibleLabel,
  type LauncherSetup,
  type LauncherVendor,
} from './launcher-model';

export function EngineGlyph({
  engine,
  size = 13,
}: {
  engine: LauncherSetup['engine'];
  size?: number;
}) {
  return (
    <span
      aria-hidden="true"
      data-engine-glyph
      className="inline-flex shrink-0 items-center justify-center"
      style={{ color: engine.color, width: size, height: size }}
    >
      {engine.harness === 'shell' ? (
        <TerminalSquare size={size} strokeWidth={1.8} />
      ) : (
        <HarnessGlyph harness={engine.harness} size={size} />
      )}
    </span>
  );
}

/**
 * The vendor is identity — who actually serves this model — so it wears a mark
 * the way the engine does. Local inference gets a different mark from a hosted
 * provider, because that difference is the point of engine plurality (`0027`).
 */
export function VendorGlyph({ vendor }: { vendor: LauncherVendor }) {
  const Icon = vendor.kind === 'local' ? HardDrive : Cloud;
  return (
    <Icon
      aria-hidden="true"
      data-vendor-glyph
      strokeWidth={1.8}
      className="size-3 shrink-0 text-hud-text-dim"
    />
  );
}

function Shimmer({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'block animate-pulse rounded bg-hud-text-dim/15 motion-reduce:animate-none',
        className
      )}
    />
  );
}

export interface SetupChipProps {
  setup: LauncherSetup;
  selected: boolean;
  expanded: boolean;
  /** Renders the same structure as shimmer blocks. Inert: no click, no focus. */
  pending?: boolean;
  tabIndex?: number;
  onSelect?: (id: string) => void;
  onToggleDetail?: (id: string) => void;
  onKeyDown?: (event: React.KeyboardEvent<HTMLButtonElement>) => void;
}

export const SetupChip = forwardRef<HTMLButtonElement, SetupChipProps>(
  function SetupChip(
    {
      setup,
      selected,
      expanded,
      pending = false,
      tabIndex,
      onSelect,
      onToggleDetail,
      onKeyDown,
    },
    ref
  ) {
    const role = LAUNCHER_ROLE_LABEL[setup.role];
    const provenance = setup.available
      ? reasonLabel(setup)
      : (setup.unavailableReason ?? 'Unavailable');

    return (
      <button
        ref={ref}
        type="button"
        role={pending ? 'presentation' : 'radio'}
        aria-hidden={pending || undefined}
        aria-checked={pending ? undefined : selected}
        aria-label={pending ? undefined : setupAccessibleLabel(setup)}
        title={pending ? undefined : setupAccessibleLabel(setup)}
        aria-disabled={!pending && !setup.available ? true : undefined}
        disabled={pending}
        tabIndex={pending ? -1 : tabIndex}
        data-setup-chip
        data-setup-id={setup.id}
        data-pending={pending || undefined}
        data-selected={(!pending && selected) || undefined}
        data-expanded={(!pending && expanded) || undefined}
        data-unavailable={(!pending && !setup.available) || undefined}
        onClick={
          pending
            ? undefined
            : () => (selected ? onToggleDetail?.(setup.id) : onSelect?.(setup.id))
        }
        onKeyDown={pending ? undefined : onKeyDown}
        className={cn(
          'group/setup relative flex min-w-0 flex-1 basis-0 flex-col items-start rounded-lg border px-3 py-2.5 text-left outline-none',
          'border-hud-stroke-faint bg-hud-surface-input',
          'transition-[border-color,background-color] duration-200 ease-[cubic-bezier(0.2,0,0,1)] motion-reduce:transition-none',
          !pending && 'hover:border-hud-cyan/45 hover:bg-hud-fill',
          'focus-visible:ring-2 focus-visible:ring-hud-cyan focus-visible:ring-offset-2 focus-visible:ring-offset-hud-void',
          !pending && selected && 'border-hud-cyan/70 bg-hud-fill-hi',
          !pending && !setup.available && 'opacity-55',
          pending && 'cursor-default'
        )}
      >
        <span className="flex h-3.5 w-full items-center font-mono text-chrome-micro leading-[0.875rem] text-hud-text-dim/70">
          {pending ? <Shimmer className="h-2 w-10" /> : role}
        </span>

        <span className="flex h-4 w-full min-w-0 items-center gap-1.5">
          {pending ? (
            <Shimmer className="h-2.5 w-24 max-w-[75%]" />
          ) : (
            <>
              <EngineGlyph engine={setup.engine} />
              <span className="min-w-0 flex-1 truncate font-mono text-chrome-meta text-hud-text-dim">
                {setup.engine.label}
              </span>
              {setup.pinned ? (
                <Pin
                  aria-hidden="true"
                  fill="currentColor"
                  className="size-3 shrink-0 text-hud-text-dim"
                />
              ) : null}
            </>
          )}
        </span>

        {/* The anchor. The model is what the operator chooses between, so it is
            the only line carrying weight. */}
        <span className="mt-1 flex h-5 w-full min-w-0 items-baseline gap-1.5">
          {pending ? (
            <Shimmer className="h-3.5 w-4/5" />
          ) : (
            <>
              <span className="min-w-0 truncate font-ui text-chrome-label font-semibold text-hud-text">
                {setup.model ?? 'Choose a model'}
              </span>
              {setup.modelVariant ? (
                <span className="shrink-0 font-mono text-chrome-micro text-hud-text-dim">
                  {setup.modelVariant}
                </span>
              ) : null}
            </>
          )}
        </span>

        {/* Vendor: identity, marked, structurally distinct from the capability
            tag beside the model name above. */}
        <span className="flex h-3.5 w-full min-w-0 items-center gap-1 font-mono text-chrome-micro leading-[0.875rem] text-hud-text-dim">
          {!pending && setup.vendor ? (
            <>
              <VendorGlyph vendor={setup.vendor} />
              <span className="min-w-0 truncate">{setup.vendor.label}</span>
            </>
          ) : null}
        </span>

        <span className="mt-1 flex h-3.5 w-full items-center font-mono text-chrome-micro leading-[0.875rem] text-hud-text-dim">
          {pending ? (
            <Shimmer className="h-2 w-1/2" />
          ) : setup.thinking ? (
            `${setup.thinking} thinking`
          ) : (
            'Engine default'
          )}
        </span>

        <span
          className={cn(
            'flex h-3.5 w-full items-center truncate font-mono text-chrome-micro leading-[0.875rem]',
            setup.available ? 'text-hud-text-dim/65' : 'text-hud-amber/80'
          )}
        >
          {pending ? null : provenance}
        </span>
      </button>
    );
  }
);
