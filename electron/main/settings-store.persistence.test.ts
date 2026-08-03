import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const electronState = vi.hoisted(() => ({ userData: '' }));

vi.mock('electron', () => ({
  app: { getPath: () => electronState.userData },
}));

import {
  CLASSIC_RECOVERY_ELECTRON_APPEARANCE_PREFERENCES,
  loadSettings,
  setAppearancePreferences,
} from './settings-store';

const classic = {
  schemaVersion: 1,
  selection: { mode: 'manual', themeId: 'exawatt-classic-dark' },
  accentSource: 'theme',
  interfaceFont: 'theme',
  interfaceScale: 100,
  contrast: 'system',
  transparency: 'system',
} as const;
const normalizedClassic = CLASSIC_RECOVERY_ELECTRON_APPEARANCE_PREFERENCES;

beforeEach(() => {
  electronState.userData = fs.mkdtempSync(
    path.join(os.tmpdir(), 'exawatt-appearance-settings-')
  );
});

afterEach(() => {
  fs.rmSync(electronState.userData, { recursive: true, force: true });
});

describe('appearance settings persistence', () => {
  it('round-trips atomically while preserving unrelated settings', () => {
    const file = path.join(electronState.userData, 'settings.json');
    fs.writeFileSync(file, JSON.stringify({ terminal: { fontSize: 15 } }));

    expect(setAppearancePreferences(classic)).toEqual({
      terminal: { fontSize: 15 },
      appearance: normalizedClassic,
    });
    expect(loadSettings()).toEqual({
      terminal: { fontSize: 15 },
      appearance: normalizedClassic,
    });
    expect(
      fs
        .readdirSync(electronState.userData)
        .filter(name => name.includes('.tmp-'))
    ).toEqual([]);
  });

  it('rejects unknown themes without touching the settings file', () => {
    const file = path.join(electronState.userData, 'settings.json');
    fs.writeFileSync(
      file,
      JSON.stringify({ notifications: { attention: true } })
    );
    const before = fs.readFileSync(file, 'utf8');

    expect(() =>
      setAppearancePreferences({
        ...classic,
        selection: { mode: 'manual', themeId: 'exawatt-remote-dark' },
      })
    ).toThrow('Invalid or unavailable');
    expect(fs.readFileSync(file, 'utf8')).toBe(before);
  });

  it('distinguishes a missing preference from corrupt settings', () => {
    const file = path.join(electronState.userData, 'settings.json');

    expect(loadSettings()).toEqual({});
    fs.writeFileSync(file, JSON.stringify({ terminal: { fontSize: 15 } }));
    expect(loadSettings()).toEqual({ terminal: { fontSize: 15 } });

    fs.writeFileSync(file, '{');
    expect(loadSettings()).toEqual({ appearance: normalizedClassic });

    fs.writeFileSync(
      file,
      JSON.stringify({
        terminal: { fontSize: 15 },
        appearance: { ...classic, injectedCss: 'body{}' },
      })
    );
    expect(loadSettings()).toEqual({
      terminal: { fontSize: 15 },
      appearance: normalizedClassic,
    });
  });
});
