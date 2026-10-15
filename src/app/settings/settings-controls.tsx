'use client';

import type { ReactNode } from 'react';

export function SettingsGroup({
  title,
  description,
  children,
  dataAttribute,
}: {
  title: string;
  description: string;
  children: ReactNode;
  dataAttribute: string;
}) {
  return (
    <section
      className="mb-6 overflow-hidden rounded-lg border border-[var(--settings-line)] bg-[var(--settings-panel)]"
      {...{ [dataAttribute]: '' }}
    >
      <header className="border-b border-[var(--settings-line)] px-5 py-4">
        <h3 className="font-display text-reading font-semibold text-[var(--settings-text)]">
          {title}
        </h3>
        <p className="mt-1 max-w-[72ch] font-ui text-chrome-label leading-5 text-[var(--settings-dim)]">
          {description}
        </p>
      </header>
      <div className="divide-y divide-[var(--settings-line)] px-5">
        {children}
      </div>
    </section>
  );
}

export function SettingRow({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex min-h-[76px] items-center justify-between gap-5 py-3 max-[520px]:flex-col max-[520px]:items-stretch">
      <div>
        <p className="font-ui text-chrome-title font-medium text-[var(--settings-soft)]">
          {title}
        </p>
        <p className="mt-0.5 max-w-[68ch] font-ui text-chrome-label leading-5 text-[var(--settings-dim)]">
          {description}
        </p>
      </div>
      {children}
    </div>
  );
}

export function SettingSwitch({
  checked,
  onChange,
  label,
  disabled = false,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="grid h-11 w-11 shrink-0 cursor-pointer place-items-center rounded-md focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
    >
      <span
        aria-hidden="true"
        className="relative h-5 w-9 rounded-full border transition-colors"
        style={{
          borderColor: checked
            ? 'var(--settings-teal)'
            : 'var(--settings-line-strong)',
          background: checked
            ? 'var(--settings-teal)'
            : 'var(--settings-raised)',
        }}
      >
        {/* The thumb needs an explicit `left` anchor: an absolutely
            positioned box with `left: auto` sits at its static position, and
            the button's UA `text-align: center` centers that static position
            inside the track, shifting both translate states 17px right (the
            checked thumb landed outside the track). The thumb paints the
            on-action ink when checked — the one color the theme contract
            guarantees against `--settings-teal`, including under the system
            accent overlay — and muted-text neutral against the raised track
            when off. */}
        <span
          className={`absolute left-0 top-0.5 h-3.5 w-3.5 rounded-full transition ${
            checked ? 'translate-x-4.5' : 'translate-x-0.5'
          }`}
          style={{
            background: checked
              ? 'var(--settings-teal-text)'
              : 'var(--settings-dim)',
          }}
        />
      </span>
    </button>
  );
}

/** Shared theme/presentation choice: existing Settings chrome-label control. */
export function SettingsSegmentedControl<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled = false,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: ReactNode }[];
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  return (
    <div
      className="flex shrink-0 self-start rounded-md border border-[var(--settings-line-strong)] bg-[var(--settings-raised)] p-0.5"
      role="group"
      aria-label={label}
    >
      {options.map(option => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          disabled={disabled}
          onClick={() => onChange(option.value)}
          className="h-8 rounded px-3 font-ui text-chrome-label font-medium outline-none focus-visible:ring-2 focus-visible:ring-[var(--settings-teal)] disabled:cursor-not-allowed disabled:opacity-50"
          style={{
            color:
              value === option.value
                ? 'var(--settings-text)'
                : 'var(--settings-dim)',
            background:
              value === option.value ? 'var(--settings-panel)' : 'transparent',
          }}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
