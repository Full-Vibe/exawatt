import { describe, expect, it, vi } from 'vitest';
import {
  isClaudePlanWindowsEnabled,
  isPersistableAppearancePreferences,
  parseAppearancePreferences,
  parseSettings,
} from './settings-store';
import {
  emptyLaunchConfigurationPool,
  launchConfigurationId,
} from '@exawatt/core';

// This suite runs in Node, so importing the real `electron` package would run
// its installer shim: it reads `node_modules/electron/path.txt`, and when that
// file is briefly absent — which it is every time a sibling agent worktree
// re-links Electron — it tries to DOWNLOAD Electron and then throws "Electron
// failed to install correctly". Nothing here wants the binary's path, only the
// pure logic under test, so the module is stood down rather than resolved
// (BUG-057). The four suites that need `app` already mock it with a body.
vi.mock('electron', () => ({}));

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

  // ENG-030 OS1.5: same contract for the re-entry recap — absent resolves to
  // the disclosed default-on, and only an explicit boolean is a choice.
  it('treats a missing or malformed recap key as the default, not off', () => {
    for (const settings of [
      parseSettings({}),
      parseSettings({ reentryRecap: { enabled: 'no' } }),
      parseSettings({ reentryRecap: 'off' }),
    ]) {
      expect(settings.reentryRecap).toBeUndefined();
      expect(settings.reentryRecap?.enabled !== false).toBe(true);
    }
    expect(parseSettings({ reentryRecap: { enabled: false } })).toEqual({
      reentryRecap: { enabled: false },
    });
    expect(
      parseSettings({ reentryRecap: { enabled: true } }).reentryRecap
    ).toEqual({ enabled: true });
  });

  // ENG-038: same default-on contract for the Claude plan-window read —
  // absent resolves to the disclosed default, only an explicit false is off.
  it('treats a missing or malformed Claude plan-window key as the default, not off', () => {
    for (const settings of [
      parseSettings({}),
      parseSettings({ claudePlanWindows: { enabled: 'no' } }),
      parseSettings({ claudePlanWindows: 'off' }),
    ]) {
      expect(settings.claudePlanWindows).toBeUndefined();
      expect(isClaudePlanWindowsEnabled(settings)).toBe(true);
    }
    const off = parseSettings({ claudePlanWindows: { enabled: false } });
    expect(off).toEqual({ claudePlanWindows: { enabled: false } });
    expect(isClaudePlanWindowsEnabled(off)).toBe(false);
    expect(
      parseSettings({ claudePlanWindows: { enabled: true } }).claudePlanWindows
    ).toEqual({ enabled: true });
  });

  // ENG-035: the publishing switch has the OPPOSITE polarity — opt-in under
  // decision `0029`. Absent or malformed must resolve to OFF, never on, and
  // only an explicit boolean is a choice.
  it('treats a missing or malformed publishing key as off, never on', () => {
    for (const settings of [
      parseSettings({}),
      parseSettings({ operatorProfile: { autoPublish: 'yes' } }),
      parseSettings({ operatorProfile: 'on' }),
      parseSettings({ operatorProfile: { autoPublish: 1 } }),
    ]) {
      expect(settings.operatorProfile).toBeUndefined();
      expect(settings.operatorProfile?.autoPublish === true).toBe(false);
    }
    expect(parseSettings({ operatorProfile: { autoPublish: true } })).toEqual({
      operatorProfile: { autoPublish: true },
    });
    expect(
      parseSettings({ operatorProfile: { autoPublish: false } }).operatorProfile
    ).toEqual({ autoPublish: false });
  });

  it('keeps only valid durable Operator profile metadata', () => {
    expect(
      parseSettings({
        operatorProfile: {
          autoPublish: true,
          startedAt: '2026-08-03T18:00:00.000Z',
          lastSyncedAt: '2026-08-16T19:00:00.000Z',
          profileEnabled: true,
        },
      }).operatorProfile
    ).toEqual({
      autoPublish: true,
      startedAt: '2026-08-03T18:00:00.000Z',
      lastSyncedAt: '2026-08-16T19:00:00.000Z',
      profileEnabled: true,
    });
    expect(
      parseSettings({
        operatorProfile: {
          autoPublish: true,
          startedAt: 'not-a-date',
          lastSyncedAt: 42,
          profileEnabled: 'yes',
        },
      }).operatorProfile
    ).toEqual({ autoPublish: true });
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
