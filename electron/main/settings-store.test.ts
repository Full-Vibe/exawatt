import { describe, expect, it } from 'vitest';
import { parseSettings } from './settings-store';

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
