import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createPresentationPreferenceSource,
  PRESENTATION_FIELD_STORAGE_KEYS as keys,
  PRESENTATION_STORAGE_KEY as legacyKey,
} from './preference-source';
import {
  installBridgeDouble,
  removeBridgeDouble,
} from '@/test-support/desktop-bridge-double';

beforeEach(() => {
  localStorage.clear();
  removeBridgeDouble();
});
afterEach(() => {
  vi.restoreAllMocks();
  removeBridgeDouble();
});

describe('independent browser presentation fields', () => {
  it('reads legacy choices without migration writes and never resurrects a reset', async () => {
    const legacy = JSON.stringify({
      schemaVersion: 1,
      fleetView: 'v2',
      fleetMaterial: 'anodized',
    });
    localStorage.setItem(legacyKey, legacy);
    const write = vi.spyOn(Storage.prototype, 'setItem');
    const source = createPresentationPreferenceSource();
    expect(await source.load()).toEqual(JSON.parse(legacy));
    expect(write).not.toHaveBeenCalled();
    await source.update({ field: 'fleetView', value: null });
    expect(write).toHaveBeenCalledExactlyOnceWith(keys.fleetView, 'null');
    expect(await createPresentationPreferenceSource().load()).toEqual({
      schemaVersion: 1,
      fleetMaterial: 'anodized',
    });
    expect(localStorage.getItem(legacyKey)).toBe(legacy);
    await source.update({ field: 'fleetMaterial', value: null });
    expect(await createPresentationPreferenceSource().load()).toBeUndefined();
  });

  it.each([
    ['fleetView', 'v2'],
    ['fleetMaterial', 'matte'],
  ] as const)(
    'writes only the %s field rather than a snapshot of another tab',
    async (field, value) => {
      const write = vi.spyOn(Storage.prototype, 'setItem');
      await createPresentationPreferenceSource().update({ field, value } as
        | { field: 'fleetView'; value: 'v2' }
        | { field: 'fleetMaterial'; value: 'matte' });
      expect(write).toHaveBeenCalledExactlyOnceWith(
        keys[field],
        JSON.stringify(value)
      );
      expect(localStorage.getItem(legacyKey)).toBeNull();
    }
  );

  it('preserves independent updates and resets from separate sources without subscriptions', async () => {
    const first = createPresentationPreferenceSource();
    const second = createPresentationPreferenceSource();
    await Promise.all([
      first.update({ field: 'fleetView', value: 'v2' }),
      second.update({ field: 'fleetMaterial', value: 'acrylic' }),
    ]);
    expect(await first.load()).toEqual({
      schemaVersion: 1,
      fleetView: 'v2',
      fleetMaterial: 'acrylic',
    });
    await Promise.all([
      second.update({ field: 'fleetMaterial', value: 'anodized' }),
      first.update({ field: 'fleetView', value: null }),
    ]);
    expect(await second.load()).toEqual({
      schemaVersion: 1,
      fleetMaterial: 'anodized',
    });
  });

  it('reads current storage when old events arrive, and unsubscribes cleanly', async () => {
    const source = createPresentationPreferenceSource();
    const listener = vi.fn();
    const unsubscribe = source.subscribe(listener);
    await source.update({ field: 'fleetView', value: 'v2' });
    await source.update({ field: 'fleetView', value: 'v1' });
    window.dispatchEvent(
      new StorageEvent('storage', { key: keys.fleetView, newValue: '"v2"' })
    );
    window.dispatchEvent(
      new CustomEvent('exawatt:presentation-changed', {
        detail: { schemaVersion: 1, fleetView: 'v2' },
      })
    );
    expect(listener).toHaveBeenLastCalledWith({
      schemaVersion: 1,
      fleetView: 'v1',
    });
    localStorage.clear();
    window.dispatchEvent(new StorageEvent('storage', { key: null }));
    expect(listener).toHaveBeenLastCalledWith(undefined);
    unsubscribe();
    listener.mockClear();
    await source.update({ field: 'fleetMaterial', value: 'matte' });
    window.dispatchEvent(
      new StorageEvent('storage', { key: keys.fleetMaterial })
    );
    expect(listener).not.toHaveBeenCalled();
  });

  it.each([
    'broken JSON',
    JSON.stringify({ schemaVersion: 8, fleetView: 'v2' }),
    JSON.stringify({ schemaVersion: 1, fleetView: 'other' }),
  ])(
    'recovers unsupported legacy state without rewriting it: %s',
    async saved => {
      localStorage.setItem(legacyKey, saved);
      const source = createPresentationPreferenceSource();
      expect(await source.load()).toBeUndefined();
      await source.update({ field: 'fleetMaterial', value: 'glazed' });
      expect(await source.load()).toEqual({
        schemaVersion: 1,
        fleetMaterial: 'glazed',
      });
      expect(localStorage.getItem(legacyKey)).toBe(saved);
    }
  );

  it('recovers a malformed field independently without resurrecting legacy state', async () => {
    localStorage.setItem(
      legacyKey,
      JSON.stringify({
        schemaVersion: 1,
        fleetView: 'v2',
        fleetMaterial: 'gummy',
      })
    );
    localStorage.setItem(keys.fleetView, 'broken');
    localStorage.setItem(keys.fleetMaterial, '"matte"');
    expect(await createPresentationPreferenceSource().load()).toEqual({
      schemaVersion: 1,
      fleetMaterial: 'matte',
    });
  });

  it('reports a blocked write without publishing or changing the visible saved choice', async () => {
    const source = createPresentationPreferenceSource();
    await source.update({ field: 'fleetView', value: 'v2' });
    const listener = vi.fn();
    const unsubscribe = source.subscribe(listener);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Storage blocked');
    });
    await expect(
      source.update({ field: 'fleetView', value: 'v1' })
    ).rejects.toThrow('Storage blocked');
    expect(listener).not.toHaveBeenCalled();
    expect(await source.load()).toEqual({ schemaVersion: 1, fleetView: 'v2' });
    unsubscribe();
  });

  it('does not fall back to browser persistence for an incomplete desktop bridge', async () => {
    installBridgeDouble({
      settings: {
        get: vi.fn(async () => ({})),
        onChanged: vi.fn(() => () => undefined),
      },
    });
    const source = createPresentationPreferenceSource();
    await expect(
      source.update({ field: 'fleetView', value: 'v2' })
    ).rejects.toThrow('Update Exawatt');
    expect(localStorage.length).toBe(0);
  });
});
