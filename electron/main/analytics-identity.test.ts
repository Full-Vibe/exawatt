import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { getPath: () => '/nonexistent' } }));

import {
  readAnalyticsIdentity,
  setAnalyticsOptOut,
  type AnalyticsSettingsStore,
} from './analytics-identity';
import type { StoredSettings } from './settings-store';

const KEPT = '0b8e4f5e-3c1d-4a2b-9f6e-7d8c9b0a1e2f';
const LEGACY = '5f1c2d3e-4a5b-4c6d-8e7f-9a0b1c2d3e4f';
const MINTED = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

/** settings.json as the store sees it; `unreadable` models a corrupt file. */
function fakeStore(
  initial: StoredSettings | 'unreadable' = {},
  options: { failWrites?: boolean } = {}
) {
  let disk = initial;
  const writes: StoredSettings[] = [];
  const store: AnalyticsSettingsStore = {
    read: () =>
      disk === 'unreadable'
        ? { status: 'unreadable' }
        : { status: 'ready', settings: structuredClone(disk) },
    write: settings => {
      if (options.failWrites) throw new Error('EACCES');
      disk = structuredClone(settings);
      writes.push(disk);
    },
    mint: () => MINTED,
  };
  return { store, writes, disk: () => disk };
}

describe('the analytics identity main holds (BUG-171)', () => {
  it('mints one id and answers it on every later launch, whatever the port', () => {
    const { store, writes } = fakeStore();
    const first = readAnalyticsIdentity(
      { legacy: null, ensureId: true },
      store
    );
    expect(first).toEqual({
      status: 'ready',
      optedOut: false,
      installationId: MINTED,
    });
    // A fallback-port launch has empty localStorage: no legacy values.
    const fallback = readAnalyticsIdentity(
      { legacy: null, ensureId: true },
      store
    );
    expect(fallback).toEqual(first);
    expect(writes).toHaveLength(1);
  });

  it('keeps an opt-out across a launch that offers no legacy values', () => {
    const { store } = fakeStore({ analytics: { optedOut: true } });
    expect(
      readAnalyticsIdentity({ legacy: null, ensureId: true }, store)
    ).toEqual({ status: 'ready', optedOut: true, installationId: null });
  });

  it('reading the switch creates no identity', () => {
    const { store, writes } = fakeStore();
    expect(
      readAnalyticsIdentity({ legacy: null, ensureId: false }, store)
    ).toEqual({ status: 'ready', optedOut: false, installationId: null });
    expect(writes).toEqual([]);
  });

  it('adopts the renderer-origin id and opt-out once', () => {
    const adopted = fakeStore();
    expect(
      readAnalyticsIdentity(
        { legacy: { optedOut: false, installationId: LEGACY }, ensureId: true },
        adopted.store
      )
    ).toMatchObject({ installationId: LEGACY });
    expect(adopted.disk()).toEqual({
      analytics: { optedOut: false, installationId: LEGACY },
    });

    const optedOut = fakeStore();
    expect(
      readAnalyticsIdentity(
        { legacy: { optedOut: true, installationId: LEGACY }, ensureId: true },
        optedOut.store
      )
    ).toEqual({ status: 'ready', optedOut: true, installationId: null });
  });

  it('keeps its own id over a legacy one, but a legacy opt-out still wins', () => {
    const kept = fakeStore({
      analytics: { optedOut: false, installationId: KEPT },
    });
    expect(
      readAnalyticsIdentity(
        { legacy: { optedOut: false, installationId: LEGACY }, ensureId: true },
        kept.store
      )
    ).toMatchObject({ installationId: KEPT });
    expect(kept.writes).toEqual([]);

    const overruled = fakeStore({
      analytics: { optedOut: false, installationId: KEPT },
    });
    expect(
      readAnalyticsIdentity(
        { legacy: { optedOut: true, installationId: null }, ensureId: true },
        overruled.store
      )
    ).toEqual({ status: 'ready', optedOut: true, installationId: null });
  });

  it('refuses a malformed legacy id and mints instead', () => {
    const { store } = fakeStore();
    expect(
      readAnalyticsIdentity(
        {
          legacy: { optedOut: false, installationId: '/Users/me/secret' },
          ensureId: true,
        },
        store
      )
    ).toMatchObject({ installationId: MINTED });
  });

  it('answers unavailable, never opted in, when settings cannot be read', () => {
    const { store, writes } = fakeStore('unreadable');
    expect(
      readAnalyticsIdentity({ legacy: null, ensureId: true }, store)
    ).toEqual({ status: 'unavailable' });
    expect(writes).toEqual([]);
  });

  it('answers unavailable rather than use an id it could not keep', () => {
    const { store } = fakeStore({}, { failWrites: true });
    expect(
      readAnalyticsIdentity({ legacy: null, ensureId: true }, store)
    ).toEqual({ status: 'unavailable' });
  });
});

describe('the runtime opt-out (decision 0031)', () => {
  it('opting out persists and forgets the id; opting in mints at next launch', () => {
    const { store, disk } = fakeStore({
      terminal: { fontSize: 14 },
      analytics: { optedOut: false, installationId: KEPT },
    });
    expect(setAnalyticsOptOut(true, store)).toEqual({
      status: 'ready',
      optedOut: true,
      installationId: null,
    });
    expect(disk()).toEqual({
      terminal: { fontSize: 14 },
      analytics: { optedOut: true },
    });
    expect(setAnalyticsOptOut(false, store)).toEqual({
      status: 'ready',
      optedOut: false,
      installationId: null,
    });
    expect(
      readAnalyticsIdentity({ legacy: null, ensureId: true }, store)
    ).toMatchObject({ installationId: MINTED });
  });

  it('refuses a non-boolean and reports a choice it could not persist', () => {
    expect(() => setAnalyticsOptOut('yes', fakeStore().store)).toThrow(
      TypeError
    );
    expect(setAnalyticsOptOut(true, fakeStore('unreadable').store)).toEqual({
      status: 'unavailable',
    });
  });
});
