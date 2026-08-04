import { describe, expect, it } from 'vitest';
import {
  isPersistableAppearancePreferences,
  parseAppearancePreferences,
  parseSettings,
} from './settings-store';

describe('parseSettings', () => {
  it('defaults notifications off when absent or malformed', () => {
    expect(parseSettings({}).notifications).toBeUndefined();
    expect(
      parseSettings({ notifications: { attention: 'yes' } }).notifications
    ).toBeUndefined();
  });

  it('preserves terminal preferences beside the notification toggle', () => {
    expect(
      parseSettings({
        terminal: { fontSize: 15 },
        notifications: { attention: true },
      })
    ).toEqual({
      terminal: { fontSize: 15 },
      notifications: { attention: true },
    });
  });

  it('parses only an explicit hosted-summary privacy choice', () => {
    expect(
      parseSettings({ conversationSummaries: { hosted: false } })
        .conversationSummaries
    ).toEqual({ hosted: false });
    expect(
      parseSettings({ conversationSummaries: { hosted: 'no' } })
        .conversationSummaries
    ).toBeUndefined();
  });

  it('sanitizes Agent Source recommendations while preserving future source ids', () => {
    expect(
      parseSettings({
        agentSources: {
          projectLastUsed: {
            '/project': 'codex',
            '/bad': 'not a source!',
          },
          sourceRecency: { codex: 42, broken: -1 },
          projectPermissionModes: {
            '/project': {
              codex: 'auto',
              claude: 'unrestricted',
              bad: 'always',
            },
          },
        },
      }).agentSources
    ).toEqual({
      projectLastUsed: { '/project': 'codex' },
      sourceRecency: { codex: 42 },
      projectPermissionModes: {
        '/project': { codex: 'auto', claude: 'unrestricted' },
      },
    });
  });
});

describe('parseSettings dock badge (D18)', () => {
  it('parses dockBadge beside attention and defaults both off', () => {
    expect(
      parseSettings({ notifications: { attention: true, dockBadge: true } })
        .notifications
    ).toEqual({ attention: true, dockBadge: true });
    // dockBadge alone still yields a valid record with attention defaulted off
    expect(
      parseSettings({ notifications: { dockBadge: true } }).notifications
    ).toEqual({ attention: false, dockBadge: true });
    expect(
      parseSettings({ notifications: { dockBadge: 'yes' } }).notifications
    ).toBeUndefined();
  });
});

describe('appearance preferences (ENG-032 T1)', () => {
  const classic = {
    schemaVersion: 1,
    selection: { mode: 'manual', themeId: 'exawatt-classic-dark' },
    accentSource: 'theme',
    interfaceFont: 'theme',
    interfaceScale: 100,
    contrast: 'system',
    transparency: 'system',
  } as const;
  const defaultAutoPair = {
    lightThemeId: 'exawatt-air-light',
    darkThemeId: 'exawatt-night-dark',
  } as const;
  const normalizedClassic = { ...classic, autoPair: defaultAutoPair };

  it('parses a valid preference without disturbing unrelated settings', () => {
    expect(
      parseSettings({ terminal: { fontSize: 15 }, appearance: classic })
    ).toEqual({ terminal: { fontSize: 15 }, appearance: normalizedClassic });
  });

  it('migrates retired manual accessibility overrides back to system', () => {
    expect(
      parseAppearancePreferences({
        ...classic,
        contrast: 'enhanced',
        transparency: 'reduced',
      })
    ).toMatchObject({
      contrast: 'system',
      transparency: 'system',
    });
  });

  it('rejects corrupt, unknown, and wrongly paired appearance data only', () => {
    expect(
      parseSettings({
        notifications: { attention: true },
        appearance: {
          ...classic,
          selection: { mode: 'manual', themeId: 'remote-theme' },
        },
      })
    ).toEqual({ notifications: { attention: true } });
    expect(
      parseAppearancePreferences({
        ...classic,
        selection: {
          mode: 'auto',
          lightThemeId: 'exawatt-night-dark',
          darkThemeId: 'exawatt-air-light',
        },
      })
    ).toBeNull();
    expect(
      parseAppearancePreferences({
        ...classic,
        selection: {
          mode: 'auto',
          lightThemeId: 'exawatt-air-light',
          darkThemeId: 'exawatt-night-dark',
        },
        autoPair: {
          lightThemeId: 'exawatt-air-light',
          darkThemeId: 'exawatt-classic-dark',
        },
      })
    ).toBeNull();
    expect(
      parseAppearancePreferences({ ...classic, injectedCss: 'body{}' })
    ).toBeNull();
  });

  it('promotes all three built-ins to persistable production themes', () => {
    const automatic = parseAppearancePreferences({
      ...classic,
      selection: {
        mode: 'auto',
        lightThemeId: 'exawatt-air-light',
        darkThemeId: 'exawatt-night-dark',
      },
    });
    expect(automatic).toMatchObject({
      selection: {
        mode: 'auto',
        lightThemeId: 'exawatt-air-light',
        darkThemeId: 'exawatt-night-dark',
      },
      autoPair: defaultAutoPair,
    });
    expect(isPersistableAppearancePreferences(automatic!)).toBe(true);
    expect(isPersistableAppearancePreferences(normalizedClassic)).toBe(true);
  });

  it('normalizes a legacy Manual preference with a remembered Auto pair', () => {
    expect(parseAppearancePreferences(classic)).toEqual(normalizedClassic);
    expect(
      parseAppearancePreferences({
        ...classic,
        autoPair: {
          lightThemeId: 'exawatt-air-light',
          darkThemeId: 'exawatt-classic-dark',
        },
      })
    ).toMatchObject({
      selection: classic.selection,
      autoPair: {
        lightThemeId: 'exawatt-air-light',
        darkThemeId: 'exawatt-classic-dark',
      },
    });
  });
});
