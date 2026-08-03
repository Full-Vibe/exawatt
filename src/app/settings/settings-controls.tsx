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
    <div className="flex min-h-[76px] items-center justify-between gap-5 py-3 max-[520px]:items-start">
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
        <span
          className={`absolute top-[2px] h-3.5 w-3.5 rounded-full bg-[var(--settings-shell)] transition-transform ${
            checked ? 'translate-x-[17px]' : 'translate-x-[2px]'
          }`}
        />
      </span>
    </button>
  );
}
