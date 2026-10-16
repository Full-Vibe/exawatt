import { describe, expect, it } from 'vitest';
import {
  contributingHarnesses,
  displayPath,
  provenanceLine,
  splitByRecency,
  suggestedSource,
  suggestionOpenedContext,
  unreadableStoreLines,
} from './project-suggestions';
import { harnessStoreName } from './store-names';
import {
  registryWith,
  storeReads,
  suggestionFixture,
} from './start-screen-fixtures';

describe('the engine an opened suggestion recommends', () => {
  it('is the most recent harness that knows the folder and can launch here', () => {
    const row = suggestionFixture('atlas', ['codex', 'claude'], 1);
    expect(
      suggestedSource(row, registryWith({ codex: 'ready', claude: 'ready' }))
    ).toBe('codex');
    // Codex knows the folder but is not on this Mac: never recommended.
    expect(suggestedSource(row, registryWith({ claude: 'ready' }))).toBe(
      'claude'
    );
  });

  it('is nothing when no harness that knows the folder is installed', () => {
    const row = suggestionFixture('atlas', ['antigravity'], 1);
    expect(suggestedSource(row, registryWith({ claude: 'ready' }))).toBe(
      undefined
    );
  });
});

describe('where the rows came from', () => {
  it('names exactly the harnesses that contributed a row', () => {
    const rows = [
      suggestionFixture('a', ['codex'], 1),
      suggestionFixture('b', ['codex', 'claude'], 2),
    ];
    const line = provenanceLine(rows)!;
    for (const harness of contributingHarnesses(rows)) {
      expect(line).toContain(harnessStoreName(harness));
    }
    expect(line).not.toContain(harnessStoreName('antigravity'));
    expect(provenanceLine([])).toBeNull();
  });
});

describe('a store that could not be read', () => {
  it('is a line of its own, and a missing store says nothing', () => {
    const stores = storeReads({
      'claude-code-config': {
        status: 'unreadable',
        reason: 'permission denied',
      },
    });
    const lines = unreadableStoreLines(stores);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('permission denied');
    // Antigravity's stores are missing in the fixture: a fact, not a fault.
    expect(unreadableStoreLines(storeReads())).toEqual([]);
  });
});

describe('recency', () => {
  it('follows the window main applied, without re-deciding it', () => {
    const rows = [
      suggestionFixture('fresh', ['claude'], 2),
      suggestionFixture('stale', ['claude'], 45),
      suggestionFixture('undated', ['codex'], null),
    ];
    const { recent, older } = splitByRecency(rows);
    expect(recent.map(row => row.name)).toEqual(
      rows.filter(row => row.recent).map(row => row.name)
    );
    expect(older).toHaveLength(rows.length - recent.length);
  });
});

describe('folder display', () => {
  it('abbreviates the home directory and leaves other paths alone', () => {
    expect(displayPath('/Users/operator/Code/x')).toBe('~/Code/x');
    expect(displayPath('/Volumes/work/x')).toBe('/Volumes/work/x');
  });
});

describe('why an opened suggestion opened', () => {
  it('is suggested, hinted by the harness that knew the folder most recently', () => {
    const row = suggestionFixture('atlas', ['codex', 'claude'], 1);
    expect(suggestionOpenedContext(row)).toEqual({
      source: 'suggested',
      harnessHint: 'codex',
    });
  });
});
