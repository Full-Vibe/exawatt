'use client';

import { createContext, useContext, type ReactNode } from 'react';
import type {
  SETTINGS_DESTINATIONS,
  SettingsTopicId,
} from './settings-registry';

/** The row a link has just landed on, if any. The page frame provides it. */
const LandedTopic = createContext<SettingsTopicId | null>(null);

/**
 * The frame of every Settings destination (BUG-306). The header comes from
 * the registry entry, so a feature module fills the page and never titles
 * it. `wide` gives a module with its own panes the full width below the
 * header instead of the reading column.
 */
export function SettingsPage({
  destination,
  landed,
  wide = false,
  children,
}: {
  destination: (typeof SETTINGS_DESTINATIONS)[number];
  landed: SettingsTopicId | null;
  wide?: boolean;
  children: ReactNode;
}) {
  const headingId = `settings-page-${destination.id}`;
  const header = (
    <header
      className={
        wide
          ? 'border-b border-[var(--settings-line)] px-5 py-6 sm:px-8'
          : 'mb-6 border-b border-[var(--settings-line)] pb-5'
      }
    >
      <p className="mb-1 font-ui text-chrome-label text-[var(--settings-faint)]">
        {destination.group}
      </p>
      <h2
        id={headingId}
        className="font-ui text-surface-title font-semibold text-[var(--settings-text)]"
      >
        {destination.label}
      </h2>
      <p className="mt-1 max-w-[72ch] font-ui text-sm text-[var(--settings-dim)]">
        {destination.description}
      </p>
    </header>
  );
  return (
    <LandedTopic.Provider value={landed}>
      <section
        aria-labelledby={headingId}
        data-settings-page={destination.id}
        className={wide ? 'flex min-w-0 flex-col' : 'min-w-0 px-4 py-6 sm:px-8'}
      >
        {wide ? (
          <>
            {header}
            {children}
          </>
        ) : (
          <div className="mx-auto max-w-4xl">
            {header}
            {children}
          </div>
        )}
      </section>
    </LandedTopic.Provider>
  );
}

/**
 * A card of rows. A destination with one group leaves `title` out: the page
 * header already names it.
 */
export function SettingsGroup({
  title,
  description,
  children,
  dataAttribute,
}: {
  title?: string;
  description?: string;
  children: ReactNode;
  dataAttribute: string;
}) {
  return (
    <section
      className="mb-6 overflow-hidden rounded-lg border border-[var(--settings-line)] bg-[var(--settings-panel)]"
      {...{ [dataAttribute]: '' }}
    >
      {title && (
        <header className="border-b border-[var(--settings-line)] px-5 py-4">
          <h3 className="font-display text-reading font-semibold text-[var(--settings-text)]">
            {title}
          </h3>
          {description && (
            <p className="mt-1 max-w-[72ch] font-ui text-chrome-label leading-5 text-[var(--settings-dim)]">
              {description}
            </p>
          )}
        </header>
      )}
      <div className="divide-y divide-[var(--settings-line)] px-5">
        {children}
      </div>
    </section>
  );
}

/**
 * One setting: its title and what it decides, the control at the end, and
 * any wider content (`body`) below. A row with a `topic` is where that
 * topic's links land: it carries the topic as its id and shows a brief wash
 * across the card when one does.
 */
export function SettingRow({
  topic,
  title,
  description,
  children,
  body,
}: {
  topic?: SettingsTopicId;
  title: string;
  description?: string;
  children?: ReactNode;
  body?: ReactNode;
}) {
  const landed = useContext(LandedTopic);
  return (
    <div
      id={topic}
      tabIndex={topic ? -1 : undefined}
      data-settings-landed={topic && landed === topic ? '' : undefined}
      className="relative isolate scroll-mt-6 py-3 outline-none before:pointer-events-none before:absolute before:inset-y-0 before:-inset-x-5 before:-z-10 before:border-l-2 before:border-[var(--settings-teal)] before:bg-[var(--settings-teal-wash)] before:opacity-0 before:transition-opacity before:duration-700 data-[settings-landed]:before:opacity-100 data-[settings-landed]:before:duration-150 motion-reduce:before:transition-none"
    >
      <div className="flex min-h-13 items-center justify-between gap-5 max-[520px]:flex-col max-[520px]:items-stretch">
        <div>
          <p className="font-ui text-chrome-title font-medium text-[var(--settings-soft)]">
            {title}
          </p>
          {description && (
            <p className="mt-0.5 max-w-[68ch] font-ui text-chrome-label leading-5 text-[var(--settings-dim)]">
              {description}
            </p>
          )}
        </div>
        {children}
      </div>
      {body && <div className="mt-3">{body}</div>}
    </div>
  );
}

/** A destination whose controls live only in the desktop app, in a browser. */
export function DesktopOnlyNote({ children }: { children: ReactNode }) {
  return (
    <p className="font-ui text-sm text-[var(--settings-dim)]">{children}</p>
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
