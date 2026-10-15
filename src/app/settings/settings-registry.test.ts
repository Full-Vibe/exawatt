import { describe, expect, it } from 'vitest';
import {
  SETTINGS_DESTINATIONS,
  SETTINGS_GROUPS,
  resolveSettingsSection,
  searchSettings,
  settingsHref,
} from './settings-registry';

describe('Settings destination contract', () => {
  it('gives every feature a unique owned destination and unique focus targets', () => {
    const ids = SETTINGS_DESTINATIONS.map(item => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    const topicIds = SETTINGS_DESTINATIONS.flatMap(item =>
      item.topics.map(topic => topic.id)
    );
    expect(new Set(topicIds).size).toBe(topicIds.length);
    for (const item of SETTINGS_DESTINATIONS) {
      expect(item.owner.trim()).not.toBe('');
      expect(item.description.trim()).not.toBe('');
      expect(SETTINGS_GROUPS).toContain(item.group);
      const url = new URL(settingsHref(item.id), 'https://example.test');
      expect(resolveSettingsSection(url.searchParams.get('section'))).toBe(
        item.id
      );
      expect(
        searchSettings(item.label).map(result => result.destination.id)
      ).toContain(item.id);
    }
  });
  it('finds a specific topic without returning unrelated topics from the same section', () => {
    const results = searchSettings('interface font');
    expect(
      results.flatMap(result => result.topics.map(topic => topic.id))
    ).toEqual(['interface-font']);
  });
  it('keeps the old preferences destination useful and falls back for unknown links', () => {
    expect(resolveSettingsSection('preferences')).toBe('appearance');
    expect(resolveSettingsSection('future-missing-feature')).toBe(
      resolveSettingsSection(null)
    );
  });
});
