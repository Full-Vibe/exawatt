/**
 * BUG-142 — every persisted settings field survives write → parse.
 *
 * BUG-044 shipped a fix that never worked: `settings:set-keyboard-shortcuts`
 * wrote `keyboardShortcuts` to `settings.json`, `parseSettings` never assigned
 * it back, and no test crossed the channel. A rebind vanished on relaunch,
 * and any other settings write (`loadSettings` + `writeSettings`) erased it
 * from disk within the same session. This suite is the missing crossing, for
 * every field rather than the one that failed: the fixture map below is typed
 * over `keyof StoredSettings`, so adding a field to the interface without a
 * fixture here is a compile error, and `SETTINGS_KEYS` is asserted to be
 * exactly that key set.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  emptyKeyboardShortcutOverrides,
  emptyLaunchConfigurationPool,
  saveNamedLaunchConfiguration,
  type KeyboardShortcutOverridesV1,
} from '@exawatt/core';

const electronState = vi.hoisted(() => ({ userData: '' }));

vi.mock('electron', () => ({
  app: { getPath: () => electronState.userData },
}));

import {
  DEFAULT_ELECTRON_APPEARANCE_PREFERENCES,
  SETTINGS_KEYS,
  loadSettings,
  setKeyboardShortcutOverrides,
  setReentryRecapEnabled,
  writeSettings,
  type StoredSettings,
} from './settings-store';

const REBIND: KeyboardShortcutOverridesV1 = {
  ...emptyKeyboardShortcutOverrides(),
  overrides: [
    { shortcutId: 'tab.close', keys: { key: 'w', modifiers: ['meta'] } },
    {
      shortcutId: 'palette.open',
      keys: [
        { key: 'k', modifiers: ['meta'] },
        { key: 'p', modifiers: ['ctrl', 'shift'] },
      ],
    },
  ],
};

/**
 * One representative value per persisted field. `-?` makes every key of the
 * interface mandatory here, so a new field cannot be added without also being
 * proven to round-trip.
 */
const FIXTURES: {
  [K in keyof StoredSettings]-?: NonNullable<StoredSettings[K]>;
} = {
  terminal: {
    fontFamily: '"MesloLGS For Powerline", Menlo, monospace',
    fontSize: 14,
    lineHeight: 1,
    letterSpacing: -1,
    fontStrokeWidth: 0.15,
  },
  notifications: { attention: true, dockBadge: true },
  contextLabels: { hosted: false },
  conversationSummaries: { hosted: false },
  goalVisuals: { enabled: false },
  reentryRecap: { enabled: false },
  claudePlanWindows: { enabled: false },
  operatorProfile: {
    autoPublish: true,
    startedAt: '2026-08-03T18:00:00.000Z',
    lastSyncedAt: '2026-09-16T12:00:00.000Z',
    profileEnabled: true,
  },
  agentSources: {
    projectLastUsed: { '/w/acme': 'claude-local' },
    sourceRecency: { 'claude-local': 1_700_000_000_000 },
    projectPermissionModes: { '/w/acme': { 'claude-local': 'auto' } },
  },
  launchConfigurations: saveNamedLaunchConfiguration(
    emptyLaunchConfigurationPool(),
    {
      sourceId: 'claude-local',
      modelId: 'claude-opus-5',
      effort: 'high',
      labels: { source: 'Claude Code', model: 'Opus 5', effort: 'High' },
    },
    'Reviewer',
    10
  ),
  appearance: DEFAULT_ELECTRON_APPEARANCE_PREFERENCES,
  keyboardShortcuts: REBIND,
};

const settingsFile = () => path.join(electronState.userData, 'settings.json');

beforeEach(() => {
  electronState.userData = fs.mkdtempSync(
    path.join(os.tmpdir(), 'exawatt-settings-round-trip-')
  );
});

afterEach(() => {
  fs.rmSync(electronState.userData, { recursive: true, force: true });
});

describe('the settings schema', () => {
  it('declares exactly the fields the interface has', () => {
    expect([...SETTINGS_KEYS].sort()).toEqual(Object.keys(FIXTURES).sort());
  });

  it.each(Object.keys(FIXTURES) as (keyof StoredSettings)[])(
    '%s survives write → parse unchanged',
    key => {
      writeSettings({ [key]: FIXTURES[key] });
      expect(loadSettings()).toEqual({ [key]: FIXTURES[key] });
    }
  );

  it('the whole file survives write → parse unchanged', () => {
    writeSettings(FIXTURES);
    expect(loadSettings()).toEqual(FIXTURES);
  });

  it('writes nothing the parser would not read back', () => {
    writeSettings({
      ...FIXTURES,
      ...({ notASetting: { leaked: true } } as object),
    });
    expect(JSON.parse(fs.readFileSync(settingsFile(), 'utf8'))).toEqual(
      FIXTURES
    );
  });
});

describe('keyboard overrides (BUG-044, read side)', () => {
  it('a rebind survives a relaunch', () => {
    setKeyboardShortcutOverrides(REBIND);
    expect(loadSettings().keyboardShortcuts).toEqual(REBIND);
  });

  it('another settings write in the same session leaves the rebind on disk', () => {
    setKeyboardShortcutOverrides(REBIND);
    setReentryRecapEnabled(false);
    expect(loadSettings()).toEqual({
      keyboardShortcuts: REBIND,
      reentryRecap: { enabled: false },
    });
  });

  it('a deliberate reset is stored as a choice, not as never having chosen', () => {
    setKeyboardShortcutOverrides(REBIND);
    setKeyboardShortcutOverrides(emptyKeyboardShortcutOverrides());
    expect(loadSettings().keyboardShortcuts).toEqual(
      emptyKeyboardShortcutOverrides()
    );
    expect(loadSettings().keyboardShortcuts).toBeDefined();
  });

  it('a device that never stored a choice reads as absent', () => {
    writeSettings({ terminal: { fontSize: 15 } });
    expect(loadSettings().keyboardShortcuts).toBeUndefined();
  });
});
