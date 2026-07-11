import { describe, expect, it } from 'vitest';
import { parseSettings } from './settings-store';

describe('parseSettings', () => {
  it('defaults notifications off when absent or malformed', () => {
    expect(parseSettings({}).notifications).toBeUndefined();
    expect(parseSettings({ notifications: { attention: 'yes' } }).notifications).toBeUndefined();
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
});
