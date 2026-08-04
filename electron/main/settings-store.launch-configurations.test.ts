import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { launchConfigurationId, SHELL_LAUNCH_TARGET_ID } from '@exawatt/core';

const electronState = vi.hoisted(() => ({ userData: '' }));

vi.mock('electron', () => ({
  app: { getPath: () => electronState.userData },
}));

import {
  deleteLaunchConfiguration,
  loadSettings,
  recordLaunchConfigurationSuccess,
  renameLaunchConfiguration,
  saveNamedLaunchConfiguration,
  setLaunchConfigurationPinned,
} from './settings-store';

const opus = {
  sourceId: 'claude-local',
  modelId: 'claude-opus-5',
  effort: 'high',
  labels: { source: 'Claude Code', model: 'Opus 5', effort: 'High' },
};

beforeEach(() => {
  electronState.userData = fs.mkdtempSync(
    path.join(os.tmpdir(), 'exawatt-launch-config-settings-')
  );
});

afterEach(() => {
  fs.rmSync(electronState.userData, { recursive: true, force: true });
});

describe('Launch Configuration settings persistence', () => {
  it('records only explicit successful launches and preserves unrelated settings', () => {
    const file = path.join(electronState.userData, 'settings.json');
    fs.writeFileSync(file, JSON.stringify({ terminal: { fontSize: 15 } }));

    saveNamedLaunchConfiguration(opus, 'Reviewer', 10);
    let settings = loadSettings();
    expect(settings.terminal).toEqual({ fontSize: 15 });
    expect(settings.launchConfigurations?.configurations[0].name).toBe(
      'Reviewer'
    );
    expect(settings.launchConfigurations?.projects).toEqual({});

    recordLaunchConfigurationSuccess('/alpha', opus, 20);
    recordLaunchConfigurationSuccess('/alpha', opus, 30);
    recordLaunchConfigurationSuccess('/alpha', { kind: 'shell' }, 40);
    settings = loadSettings();
    expect(
      settings.launchConfigurations?.projects['/alpha'].usage[
        launchConfigurationId(opus)
      ]
    ).toEqual({ launchCount: 2, lastLaunchedAt: 30 });
    expect(
      settings.launchConfigurations?.projects['/alpha'].usage[
        SHELL_LAUNCH_TARGET_ID
      ]
    ).toEqual({ launchCount: 1, lastLaunchedAt: 40 });
    expect(settings.launchConfigurations?.configurations).toHaveLength(1);
  });

  it('persists Project-local pins and explicit rename/delete operations', () => {
    recordLaunchConfigurationSuccess('/alpha', opus, 20);
    const id = launchConfigurationId(opus);
    setLaunchConfigurationPinned('/alpha', id, true);
    setLaunchConfigurationPinned('/beta', SHELL_LAUNCH_TARGET_ID, true);
    renameLaunchConfiguration(id, 'Primary reviewer');
    let settings = loadSettings();
    expect(settings.launchConfigurations?.configurations[0].name).toBe(
      'Primary reviewer'
    );
    expect(settings.launchConfigurations?.projects['/alpha'].pins).toEqual([
      id,
    ]);
    expect(settings.launchConfigurations?.projects['/beta'].pins).toEqual([
      SHELL_LAUNCH_TARGET_ID,
    ]);

    deleteLaunchConfiguration(id);
    settings = loadSettings();
    expect(settings.launchConfigurations?.configurations).toEqual([]);
    expect(settings.launchConfigurations?.projects['/alpha']).toBeUndefined();
    expect(settings.launchConfigurations?.projects['/beta'].pins).toEqual([
      SHELL_LAUNCH_TARGET_ID,
    ]);
  });

  it('rejects invalid mutations without touching the durable file', () => {
    recordLaunchConfigurationSuccess('/alpha', opus, 20);
    const file = path.join(electronState.userData, 'settings.json');
    const before = fs.readFileSync(file, 'utf8');

    expect(() => saveNamedLaunchConfiguration(opus, '   ', 30)).toThrow(
      'Invalid Launch Configuration name'
    );
    expect(() =>
      setLaunchConfigurationPinned('/alpha', 'missing', true)
    ).toThrow('Launch target not found');
    expect(() =>
      recordLaunchConfigurationSuccess('/alpha', null, 40)
    ).toThrow();
    expect(fs.readFileSync(file, 'utf8')).toBe(before);
  });

  it('isolates corrupt Launch Configuration data from valid settings', () => {
    const file = path.join(electronState.userData, 'settings.json');
    fs.writeFileSync(
      file,
      JSON.stringify({
        terminal: { fontSize: 15 },
        launchConfigurations: {
          schemaVersion: 1,
          configurations: [
            { sourceId: '', modelId: 'broken' },
            { sourceId: 'codex', modelId: 'gpt', effort: '' },
          ],
          projects: { '/alpha': { usage: { forged: -1 }, pins: ['forged'] } },
        },
      })
    );
    expect(loadSettings()).toMatchObject({
      terminal: { fontSize: 15 },
      launchConfigurations: {
        schemaVersion: 1,
        configurations: [],
        projects: {},
      },
    });
  });
});
