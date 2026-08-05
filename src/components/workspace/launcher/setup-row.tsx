'use client';

/**
 * The New Agent row (ENG-016 D49).
 *
 * Two-to-four whole setups, plus one "＋" that opens the full catalog. The row
 * never wraps and never re-sorts under the operator: the caller freezes the
 * order, and while the runtime is still resolving engines the row renders
 * placeholder cards at the FINAL geometry so nothing appears under a moving
 * pointer (finding 4). Placeholders are inert — they cannot be clicked into a
 * launch the operator did not choose.
 */

import { useRef } from 'react';
import { Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SetupChip } from './setup-chip';
import type { LauncherRowState, LauncherSetup } from './launcher-model';

/** How many setups the row shows before the rest live behind ＋. */
export const MAX_ROW_SETUPS = 4;
export const MIN_ROW_SETUPS = 2;

/**
 * The skeleton is the real chip.
 *
 * Hand-drawing a placeholder is how the last round still ended up with a row
 * that jumped on settle: the two structures drifted the moment the chip gained
 * a line. `SetupChip pending` renders the identical element tree with shimmer
 * blocks instead of text, so divergence is impossible by construction rather
 * than by discipline.
 */
const PENDING_SETUP: LauncherSetup = {
  id: '__pending__',
  role: 'coding',
  name: null,
  engine: { harness: 'claude', label: '', color: 'transparent' },
  model: null,
  modelVariant: null,
  vendor: null,
  thinking: null,
  reason: 'default',
  launchCount: 0,
  pinned: false,
  available: true,
};

export interface SetupRowProps {
  setups: readonly LauncherSetup[];
  selectedId: string | null;
  expandedId: string | null;
  state: LauncherRowState;
  /** Slots to render while settling; matches the row the operator will get. */
  placeholderCount?: number;
  onSelect: (id: string) => void;
  onToggleDetail: (id: string) => void;
  onOpenCatalog: () => void;
  className?: string;
}

export function SetupRow({
  setups,
  selectedId,
  expandedId,
  state,
  placeholderCount = 3,
  onSelect,
  onToggleDetail,
  onOpenCatalog,
  className,
}: SetupRowProps) {
  const chipRefs = useRef(new Map<string, HTMLButtonElement>());

  const move = (fromId: string, direction: -1 | 1 | 'first' | 'last') => {
    if (setups.length === 0) return;
    const current = setups.findIndex(setup => setup.id === fromId);
    const next =
      direction === 'first'
        ? 0
        : direction === 'last'
          ? setups.length - 1
          : ((current < 0 ? 0 : current) + direction + setups.length) %
            setups.length;
    const target = setups[next];
    onSelect(target.id);
    requestAnimationFrame(() => chipRefs.current.get(target.id)?.focus());
  };

  return (
    <div
      data-setup-row
      data-row-state={state}
      role="radiogroup"
      aria-label="New Agent setup"
      aria-busy={state === 'settling'}
      className={cn('flex min-w-0 items-stretch gap-2', className)}
    >
      {state === 'settling'
        ? Array.from({ length: placeholderCount }, (_, index) => (
            <SetupChip
              key={`pending-${index}`}
              setup={PENDING_SETUP}
              selected={false}
              expanded={false}
              pending
            />
          ))
        : setups.map(setup => (
            <SetupChip
              key={setup.id}
              ref={element => {
                if (element) chipRefs.current.set(setup.id, element);
                else chipRefs.current.delete(setup.id);
              }}
              setup={setup}
              selected={setup.id === selectedId}
              expanded={setup.id === expandedId}
              tabIndex={
                setup.id === (selectedId ?? setups[0]?.id) ? 0 : -1
              }
              onSelect={onSelect}
              onToggleDetail={onToggleDetail}
              onKeyDown={event => {
                const direction =
                  event.key === 'ArrowRight'
                    ? 1
                    : event.key === 'ArrowLeft'
                      ? -1
                      : event.key === 'Home'
                        ? 'first'
                        : event.key === 'End'
                          ? 'last'
                          : null;
                if (direction === null) return;
                event.preventDefault();
                move(setup.id, direction);
              }}
            />
          ))}

      <button
        type="button"
        data-setup-catalog-trigger
        disabled={state === 'settling'}
        onClick={onOpenCatalog}
        aria-label="All engines and models"
        title="All engines and models"
        className={cn(
          'flex w-14 shrink-0 flex-col items-center justify-center gap-1.5 rounded-lg border border-hud-stroke-faint bg-hud-surface-input text-hud-text-dim outline-none',
          'transition-[border-color,color,background-color] duration-200 ease-[cubic-bezier(0.2,0,0,1)] motion-reduce:transition-none',
          'hover:border-hud-cyan/45 hover:bg-hud-fill hover:text-hud-text',
          'focus-visible:ring-2 focus-visible:ring-hud-cyan focus-visible:ring-offset-2 focus-visible:ring-offset-hud-void',
          'disabled:cursor-not-allowed disabled:opacity-40'
        )}
      >
        <Plus aria-hidden="true" className="size-4" />
        <span className="font-mono text-chrome-micro leading-none">More</span>
      </button>
    </div>
  );
}
