import { describe, expect, it } from 'vitest';
import {
  isPersistableAppearancePreferences,
  parseAppearancePreferences,
  parseSettings,
} from './settings-store';
import {
  emptyLaunchConfigurationPool,
  launchConfigurationId,
} from '@exawatt/core';

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

  // ENG-030 OS1.5: for every hosted feature, absent must resolve to the
  // disclosed default, and only an explicit `false` may switch one off.
  it('treats a missing or malformed hosted-feature key as the default, not off', () => {
    for (const settings of [
      parseSettings({}),
      parseSettings({ contextLabels: { hosted: 'no' } }),
      parseSettings({ contextLabels: 'off' }),
    ]) {
      expect(settings.contextLabels).toBeUndefined();
      expect(settings.contextLabels?.hosted !== false).toBe(true);
    }
    expect(parseSettings({ contextLabels: { hosted: false } })).toEqual({
      contextLabels: { hosted: false },
    });
    expect(
      parseSettings({ contextLabels: { hosted: true } }).contextLabels
    ).toEqual({ hosted: true });
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

  it('parses Launch Configuration state independently of other settings', () => {
    const configuration = {
      sourceId: 'codex-work',
      modelId: 'gpt-5.3-codex',
      effort: 'xhigh',
    };
    const parsed = parseSettings({
      terminal: { fontSize: 15 },
      launchConfigurations: {
        schemaVersion: 1,
        configurations: [{ id: 'forged', ...configuration, createdAt: 1 }],
        projects: {
          '/project': {
            usage: { forged: { launchCount: 1, lastLaunchedAt: 2 } },
            pins: ['forged'],
          },
        },
      },
    });
    expect(parsed.terminal).toEqual({ fontSize: 15 });
    expect(parsed.launchConfigurations?.configurations[0].id).toBe(
      launchConfigurationId(configuration)
    );
    expect(parsed.launchConfigurations?.projects['/project']).toEqual({
      usage: {
        [launchConfigurationId(configuration)]: {
          launchCount: 1,
          lastLaunchedAt: 2,
        },
      },
      pins: [launchConfigurationId(configuration)],
    });
    expect(
      parseSettings({ launchConfigurations: { schemaVersion: 999 } })
        .launchConfigurations
    ).toEqual(emptyLaunchConfigurationPool());
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
