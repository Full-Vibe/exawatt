'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check } from 'lucide-react';
import { useAppearance } from '@/components/appearance/appearance-provider';
import { THEME_DEFINITIONS } from '@/generated/theme-registry';
import type {
  AppearanceAutoPairV1,
  AppearancePreferencesV1,
  ThemeDefinitionV1,
} from '@/lib/appearance/types';
import {
  rememberedAutoPair,
  selectAutoThemes,
  selectManualTheme,
} from '@/lib/appearance/selection';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SettingsGroup, SettingRow, SettingSwitch } from './settings-controls';

const AIR_THEME_ID = 'exawatt-air-light';
const CLASSIC_THEME_ID = 'exawatt-classic-dark';
const NIGHT_THEME_ID = 'exawatt-night-dark';

const BUILT_IN_THEME_IDS = [
  CLASSIC_THEME_ID,
  AIR_THEME_ID,
  NIGHT_THEME_ID,
] as const;

const themeById = new Map<string, ThemeDefinitionV1>(
  THEME_DEFINITIONS.map(theme => [theme.id, theme])
);

function ThemeCard({
  theme,
  selected,
  disabled,
  onSelect,
}: {
  theme: ThemeDefinitionV1;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      onClick={onSelect}
      className="min-w-0 rounded-md border p-2 text-left outline-none transition-[border-color,background-color] focus-visible:ring-2 focus-visible:ring-[var(--settings-teal)] disabled:cursor-not-allowed disabled:opacity-50"
      style={{
        borderColor: selected
          ? 'var(--settings-teal)'
          : 'var(--settings-line-strong)',
        background: selected
          ? 'var(--settings-teal-wash)'
          : 'var(--settings-raised)',
      }}
    >
      <span
        aria-hidden
        className="mb-2 flex h-8 overflow-hidden rounded border"
        style={{
          background: theme.foundation.canvas,
          borderColor: theme.foundation.border,
        }}
      >
        <span
          className="m-1.5 flex-1 rounded-sm"
          style={{ background: theme.foundation.surface }}
        />
        <span
          className="my-1.5 mr-1.5 w-3 rounded-sm"
          style={{ background: theme.foundation.action }}
        />
      </span>
      <span className="flex items-center gap-1.5 font-ui text-chrome-label font-medium text-[var(--settings-soft)]">
        <span className="truncate">{theme.label}</span>
        {selected && <Check aria-hidden className="ml-auto h-3.5 w-3.5" />}
      </span>
    </button>
  );
}

function ThemeSelect({
  value,
  themes,
  label,
  disabled,
  onChange,
}: {
  value: string;
  themes: ThemeDefinitionV1[];
  label: string;
  disabled: boolean;
  onChange: (themeId: AppearanceAutoPairV1[keyof AppearanceAutoPairV1]) => void;
}) {
  return (
    <Select value={value} disabled={disabled} onValueChange={onChange}>
      <SelectTrigger className="w-44 max-[520px]:w-full" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {themes.map(theme => (
          <SelectItem key={theme.id} value={theme.id}>
            {theme.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function AppearanceSettings() {
  const { preferences, resolved, ready, commitPreferences } = useAppearance();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const preferencesRef = useRef(preferences);
  const stablePreferencesRef = useRef(preferences);
  const pendingPreferencesRef = useRef<AppearancePreferencesV1 | null>(null);
  const savingRef = useRef(false);

  useEffect(() => {
    preferencesRef.current = preferences;
    stablePreferencesRef.current = preferences;
  }, [preferences]);

  const drainCommits = useCallback(async () => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      while (pendingPreferencesRef.current) {
        const next = pendingPreferencesRef.current;
        pendingPreferencesRef.current = null;
        await commitPreferences(next);
        stablePreferencesRef.current = next;
      }
    } catch {
      pendingPreferencesRef.current = null;
      preferencesRef.current = stablePreferencesRef.current;
      setError('Appearance could not be saved. Try again.');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [commitPreferences]);

  const commit = useCallback(
    (update: (current: AppearancePreferencesV1) => AppearancePreferencesV1) => {
      if (!ready) return;
      const next = update(preferencesRef.current);
      preferencesRef.current = next;
      pendingPreferencesRef.current = next;
      void drainCommits();
    },
    [drainCommits, ready]
  );

  const themes = useMemo(
    () =>
      BUILT_IN_THEME_IDS.map(id => themeById.get(id)).filter(
        (theme): theme is ThemeDefinitionV1 => Boolean(theme)
      ),
    []
  );
  const lightThemes = useMemo(
    () => themes.filter(theme => theme.appearance === 'light'),
    [themes]
  );
  const darkThemes = useMemo(
    () => themes.filter(theme => theme.appearance === 'dark'),
    [themes]
  );
  const autoPair = rememberedAutoPair(preferences);
  const disabled = !ready || saving;
  const manualThemeId =
    preferences.selection.mode === 'manual'
      ? preferences.selection.themeId
      : undefined;

  return (
    <SettingsGroup
      title="Appearance"
      description="Choose the app theme and interface typography for this device."
      dataAttribute="data-appearance-settings"
    >
      <SettingRow
        title="Theme mode"
        description="Follow the system appearance or keep one theme selected."
      >
        <div
          className="flex shrink-0 self-start rounded-md border border-[var(--settings-line-strong)] bg-[var(--settings-raised)] p-0.5"
          role="group"
          aria-label="Theme mode"
        >
          {(['auto', 'manual'] as const).map(mode => {
            const selected = preferences.selection.mode === mode;
            return (
              <button
                key={mode}
                type="button"
                aria-pressed={selected}
                disabled={disabled}
                onClick={() =>
                  commit(current =>
                    mode === 'auto'
                      ? selectAutoThemes(current)
                      : selectManualTheme(
                          current,
                          current.selection.mode === 'manual'
                            ? current.selection.themeId
                            : resolved.themeId
                        )
                  )
                }
                className="h-8 rounded px-3 font-ui text-chrome-label font-medium outline-none focus-visible:ring-2 focus-visible:ring-[var(--settings-teal)] disabled:cursor-not-allowed disabled:opacity-50"
                style={{
                  color: selected
                    ? 'var(--settings-text)'
                    : 'var(--settings-dim)',
                  background: selected
                    ? 'var(--settings-panel)'
                    : 'transparent',
                }}
              >
                {mode === 'auto' ? 'Auto' : 'Manual'}
              </button>
            );
          })}
        </div>
      </SettingRow>

      {preferences.selection.mode === 'manual' ? (
        <SettingRow
          title="Theme"
          description="Choose Classic Dark, Air, or Night."
        >
          <div className="grid w-full max-w-md grid-cols-1 gap-2 sm:grid-cols-3">
            {themes.map(theme => (
              <ThemeCard
                key={theme.id}
                theme={theme}
                selected={manualThemeId === theme.id}
                disabled={disabled}
                onSelect={() =>
                  commit(current => selectManualTheme(current, theme.id))
                }
              />
            ))}
          </div>
        </SettingRow>
      ) : (
        <>
          <SettingRow
            title="Light appearance"
            description="Theme used while the system is in light mode."
          >
            <ThemeSelect
              value={autoPair.lightThemeId}
              themes={lightThemes}
              label="Light appearance"
              disabled={disabled}
              onChange={lightThemeId =>
                commit(current =>
                  selectAutoThemes(current, { ...autoPair, lightThemeId })
                )
              }
            />
          </SettingRow>
          <SettingRow
            title="Dark appearance"
            description="Theme used while the system is in dark mode."
          >
            <ThemeSelect
              value={autoPair.darkThemeId}
              themes={darkThemes}
              label="Dark appearance"
              disabled={disabled}
              onChange={darkThemeId =>
                commit(current =>
                  selectAutoThemes(current, { ...autoPair, darkThemeId })
                )
              }
            />
          </SettingRow>
        </>
      )}

      <SettingRow
        title="System accent"
        description="Use the operating system accent for primary actions."
      >
        <SettingSwitch
          checked={preferences.accentSource === 'system'}
          disabled={disabled}
          label="Use system accent"
          onChange={system =>
            commit(current => ({
              ...current,
              accentSource: system ? 'system' : 'theme',
            }))
          }
        />
      </SettingRow>

      <SettingRow
        title="Interface font"
        description="Use the theme default, the system UI font, or bundled Geist."
      >
        <Select
          value={preferences.interfaceFont}
          disabled={disabled}
          onValueChange={interfaceFont =>
            commit(current => ({
              ...current,
              interfaceFont:
                interfaceFont as AppearancePreferencesV1['interfaceFont'],
            }))
          }
        >
          <SelectTrigger
            className="w-44 max-[520px]:w-full"
            aria-label="Interface font"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="theme">Theme default</SelectItem>
            <SelectItem value="system">System</SelectItem>
            <SelectItem value="geist">Geist</SelectItem>
          </SelectContent>
        </Select>
      </SettingRow>

      <SettingRow
        title="Interface text size"
        description="Scale app labels and reading text without changing layout density or Terminal text."
      >
        <Select
          value={String(preferences.interfaceScale)}
          disabled={disabled}
          onValueChange={value =>
            commit(current => ({
              ...current,
              interfaceScale: Number(
                value
              ) as AppearancePreferencesV1['interfaceScale'],
            }))
          }
        >
          <SelectTrigger
            className="w-32 max-[520px]:w-full"
            aria-label="Interface text size"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {[90, 100, 110, 120].map(scale => (
              <SelectItem key={scale} value={String(scale)}>
                {scale}%
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingRow>

      {error && (
        <p
          role="alert"
          className="py-3 font-ui text-chrome-label text-[var(--settings-red)]"
        >
          {error}
        </p>
      )}
    </SettingsGroup>
  );
}
