// Named as a DOM suite because web preferences use storage and window events.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ElectronSettingsApi } from '@/types/electron';
import {
  CLASSIC_RECOVERY_APPEARANCE_PREFERENCES,
  DEFAULT_APPEARANCE_PREFERENCES,
} from './resolve-appearance';
import {
  APPEARANCE_MIRROR_STORAGE_KEY,
  createAppearancePreferenceSource,
  readAppearanceMirror,
} from './preference-source';

const defaults = structuredClone(DEFAULT_APPEARANCE_PREFERENCES);
const classic = structuredClone(CLASSIC_RECOVERY_APPEARANCE_PREFERENCES);

afterEach(() => {
  window.localStorage.clear();
  delete window.electron;
});

describe('appearance preference sources', () => {
  it('uses web storage, validates reads, and notifies the current window', async () => {
    const source = createAppearancePreferenceSource();
    expect(source.kind).toBe('web');
    const changed = vi.fn();
    const unsubscribe = source.subscribe(changed);

    await expect(source.load()).resolves.toEqual(defaults);
    await expect(source.save(classic)).resolves.toEqual(classic);
    expect(readAppearanceMirror()).toEqual(classic);
    expect(changed).toHaveBeenCalledWith(classic);
    unsubscribe();
  });

  it('replaces corrupt mirrors with the explicit Classic recovery', async () => {
    window.localStorage.setItem(
      APPEARANCE_MIRROR_STORAGE_KEY,
      JSON.stringify({
        ...classic,
        selection: { mode: 'manual', themeId: 'not-a-built-in' },
      })
    );
    const source = createAppearancePreferenceSource();
    await expect(source.load()).resolves.toEqual(classic);
    expect(readAppearanceMirror()).toEqual(classic);
  });

  it('keeps missing and corrupt Electron preferences distinct', async () => {
    const get = vi
      .fn()
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ appearance: { schemaVersion: 1 } });
    window.electron = {
      isElectron: true,
      platform: 'darwin',
      settings: {
        get,
        setAppearance: vi.fn(),
        onChanged: vi.fn(() => vi.fn()),
      },
    } as unknown as NonNullable<Window['electron']>;

    const source = createAppearancePreferenceSource();
    await expect(source.load()).resolves.toEqual(defaults);
    await expect(source.load()).resolves.toEqual(classic);
  });

  it('treats Electron settings as authoritative', async () => {
    const onChanged = vi.fn(() => vi.fn());
    const settings = {
      get: vi.fn().mockResolvedValue({ appearance: classic }),
      setAppearance: vi.fn().mockResolvedValue({ appearance: classic }),
      onChanged,
    } as unknown as ElectronSettingsApi;
    window.electron = {
      isElectron: true,
      platform: 'darwin',
      settings,
    } as unknown as NonNullable<Window['electron']>;

    const source = createAppearancePreferenceSource();
    expect(source.kind).toBe('electron');
    await expect(source.load()).resolves.toEqual(classic);
    await source.save(classic);
    expect(settings.setAppearance).toHaveBeenCalledWith(classic);
  });
});
