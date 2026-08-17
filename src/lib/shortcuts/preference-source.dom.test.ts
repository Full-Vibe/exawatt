// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetResolvedDistributionForTest } from '@/lib/distribution/resolved';
import type { ShortcutOverride } from '@/types/shortcuts';
import {
  createShortcutPreferenceSource,
  readLocalShortcutOverrides,
} from './preference-source';

describe('Community shortcut preferences', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_EXAWATT_DISTRIBUTION_JSON', '');
    resetResolvedDistributionForTest();
    window.localStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
    vi.unstubAllEnvs();
    resetResolvedDistributionForTest();
  });

  it('persists overrides locally without an account service', async () => {
    const source = createShortcutPreferenceSource();
    const overrides: ShortcutOverride[] = [
      {
        shortcutId: 'command-palette',
        keys: { key: 'p', modifiers: ['meta'] },
      },
    ];

    expect(source.kind).toBe('local');
    await source.save(overrides);

    expect(await source.load()).toEqual(overrides);
    expect(window.localStorage.key(0)).toContain(
      'ai.exawatt.community:keyboard-shortcuts:v1'
    );
  });

  it('treats corrupt or structurally invalid storage as no overrides', () => {
    const key = 'ai.exawatt.community:keyboard-shortcuts:v1';
    window.localStorage.setItem(key, '{broken');
    expect(readLocalShortcutOverrides()).toEqual([]);

    window.localStorage.setItem(
      key,
      JSON.stringify([{ shortcutId: 'command-palette', keys: 'meta+p' }])
    );
    expect(readLocalShortcutOverrides()).toEqual([]);
  });
});
