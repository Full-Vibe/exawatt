'use client';

import { Check, CircleAlert } from 'lucide-react';
import {
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from '@/components/ui/command';
import { THEME_DEFINITIONS } from '@/generated/theme-registry';

export const BUILT_IN_THEME_IDS: ReadonlySet<string> = new Set(
  THEME_DEFINITIONS.map(theme => theme.id)
);

export function ThemePickerCommand({
  search,
  currentThemeId,
  busy,
  error,
  onSearchChange,
  onSelect,
}: {
  search: string;
  currentThemeId: string;
  busy: boolean;
  error: string | null;
  onSearchChange: (value: string) => void;
  onSelect: (themeId: string) => void;
}) {
  return (
    <>
      <CommandInput
        autoFocus
        placeholder="Search themes…"
        value={search}
        onValueChange={onSearchChange}
        disabled={busy}
      />
      <CommandList data-theme-picker>
        <CommandEmpty>No themes found.</CommandEmpty>
        <CommandGroup heading="Themes">
          {THEME_DEFINITIONS.map(theme => {
            const current = theme.id === currentThemeId;
            return (
              <CommandItem
                key={theme.id}
                value={theme.id}
                disabled={busy}
                onSelect={() => onSelect(theme.id)}
                data-theme-id={theme.id}
              >
                <span
                  aria-hidden
                  className="flex h-7 w-12 shrink-0 overflow-hidden rounded border"
                  style={{
                    background: theme.foundation.canvas,
                    borderColor: theme.foundation.borderStrong,
                  }}
                >
                  <span
                    className="m-1 flex-1 rounded-sm"
                    style={{ background: theme.foundation.surface }}
                  />
                  <span
                    className="my-1 mr-1 w-2 rounded-sm"
                    style={{ background: theme.foundation.action }}
                  />
                </span>
                <span className="min-w-0">
                  <span className="block truncate font-ui text-sm font-medium">
                    {theme.label}
                  </span>
                  <span className="block font-ui text-chrome-meta text-muted-foreground">
                    {theme.appearance === 'light' ? 'Light' : 'Dark'}
                  </span>
                </span>
                {current ? (
                  <CommandShortcut className="inline-flex items-center gap-1">
                    <Check aria-hidden className="h-3.5 w-3.5" />
                    Current
                  </CommandShortcut>
                ) : null}
              </CommandItem>
            );
          })}
        </CommandGroup>
      </CommandList>
      <div className="flex min-h-9 items-center gap-3 border-t border-border px-3 font-ui text-chrome-meta text-muted-foreground">
        {error ? (
          <span
            role="alert"
            className="inline-flex items-center gap-1.5 text-destructive"
          >
            <CircleAlert aria-hidden className="h-3.5 w-3.5" />
            {error}
          </span>
        ) : (
          <>
            <span>↑↓ Preview</span>
            <span>Enter Apply</span>
            <span>Esc Cancel</span>
          </>
        )}
      </div>
    </>
  );
}
