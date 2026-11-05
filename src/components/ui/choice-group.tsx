'use client';

/**
 * ChoiceGroup: the one control for choosing exactly one of a short set that
 * stays on screen (ENG-016; BUG-326, BUG-334). A long or searchable set is an
 * `OptionMenu`; a set the operator should see whole at a glance (Fleet view,
 * Theme mode, a tile material, a thinking effort) is this.
 *
 * The selected option is drawn ONE way everywhere: the action role as its
 * border over the action wash, at full text strength. Settings used to paint
 * a segmented choice by turning its label white over a ground one step from
 * its neighbours, which an external user could not read as selected (BUG-326)
 * while the material cards beside it used the action border and wash. Both
 * are this component now, so a theme cannot make one of them disappear.
 *
 * Semantic tokens only (`primary`, `foreground`, `muted-foreground`,
 * `border`, `popover`): inside the Settings shell they resolve to the same
 * foundation roles as `--settings-teal` and friends, and in the workspace
 * they resolve to the active preset's chrome, so one recipe serves both.
 *
 * Each option is a toggle button (`aria-pressed`) in a labelled group: the
 * choice is one click, and the pressed state is the contract evals read.
 */

import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface ChoiceGroupOption<T extends string> {
  value: T;
  label: ReactNode;
  /** Second line under the label (card layout only). */
  description?: ReactNode;
  /** Spoken name when the visible label is not text. */
  accessibleLabel?: string;
  disabled?: boolean;
  /** Required whenever `disabled` is true: the exact missing fact. */
  disabledReason?: string;
}

export interface ChoiceGroupProps<T extends string> {
  /** Accessible name of the group. */
  label: string;
  value: T | null;
  options: readonly ChoiceGroupOption<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
  /** `segmented`: one compact strip. `cards`: a grid of described options. */
  layout?: 'segmented' | 'cards';
  /**
   * The product hook each option carries, valued by the option's value
   * (`data-settings-option="v2"`). One name per group.
   */
  optionAttribute?: `data-${string}`;
  className?: string;
  optionClassName?: string;
}

/** The selected treatment, shared by both layouts; only the resting
 *  frame differs (a strip segment has none, a card has its own). */
function choiceOptionClass(selected: boolean, cards: boolean): string {
  if (selected) return 'border-primary bg-primary/10 text-foreground';
  return cn(
    'text-muted-foreground hover:bg-foreground/5 hover:text-foreground',
    cards ? 'border-border bg-popover' : 'border-transparent'
  );
}

export function ChoiceGroup<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled = false,
  layout = 'segmented',
  optionAttribute,
  className,
  optionClassName,
}: ChoiceGroupProps<T>) {
  const cards = layout === 'cards';
  return (
    <div
      role="group"
      aria-label={label}
      data-choice-group={layout}
      className={cn(
        cards
          ? 'grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3'
          : 'flex shrink-0 self-start rounded-md border border-border bg-popover p-0.5',
        className
      )}
    >
      {options.map(option => {
        const selected = value === option.value;
        const optionDisabled = disabled || option.disabled === true;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={selected}
            aria-label={option.accessibleLabel}
            data-choice-value={option.value}
            data-selected={selected || undefined}
            {...(optionAttribute ? { [optionAttribute]: option.value } : {})}
            disabled={optionDisabled}
            title={option.disabled ? option.disabledReason : undefined}
            onClick={() => onChange(option.value)}
            className={cn(
              'border outline-none transition-[border-color,background-color,color] duration-150 focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none',
              cards
                ? 'min-w-0 rounded-lg px-4 py-3 text-left'
                : 'h-8 rounded px-3 font-medium',
              choiceOptionClass(selected, cards),
              optionClassName
            )}
          >
            {cards ? (
              <>
                <span className="block text-sm font-medium text-foreground">
                  {option.label}
                </span>
                {option.description ? (
                  <span className="mt-1 block text-chrome-label leading-5 text-muted-foreground">
                    {option.description}
                  </span>
                ) : null}
              </>
            ) : (
              option.label
            )}
          </button>
        );
      })}
    </div>
  );
}
