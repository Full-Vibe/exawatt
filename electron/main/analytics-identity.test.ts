import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { getPath: () => '/nonexistent' } }));

import type { AnalyticsDeviceRecord } from '@exawatt/core/desktop-bridge';
import {
  claimActiveDay,
  claimWebLink,
  configureAnalyticsIdentity,
  markAnalyticsInternal,
  readAnalyticsIdentity,
  setAnalyticsOptOut,
  takeFirstAgentLaunch,
  type AnalyticsDeviceStore,
} from './analytics-identity';

const KEPT = '0b8e4f5e-3c1d-4a2b-9f6e-7d8c9b0a1e2f';
const LEGACY = '5f1c2d3e-4a5b-4c6d-8e7f-9a0b1c2d3e4f';
const MINTED = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

/**
 * The device record as the store holds it, kept in a settings-shaped object
 * (`analytics`) so the assertions read like the file did before the move;
 * `unreadable` models a record that cannot be read.
 */
function fakeStore(
  initial:
    | { analytics?: AnalyticsDeviceRecord; [key: string]: unknown }
    | 'unreadable' = {},
  options: { failWrites?: boolean } = {}
) {
  let disk = initial;
  const writes: AnalyticsDeviceRecord[] = [];
  const store: AnalyticsDeviceStore = {
    read: () =>
      disk === 'unreadable'
        ? { status: 'unavailable' }
        : { status: 'ready', record: structuredClone(disk.analytics) },
    write: record => {
      if (options.failWrites) throw new Error('EACCES');
      if (disk === 'unreadable') throw new Error('unreadable');
      disk = { ...disk, analytics: structuredClone(record) };
      writes.push(structuredClone(record));
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
      internal: false,
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
    ).toEqual({
      status: 'ready',
      optedOut: true,
      installationId: null,
      internal: false,
    });
  });

  it('reading the switch creates no identity', () => {
    const { store, writes } = fakeStore();
    expect(
      readAnalyticsIdentity({ legacy: null, ensureId: false }, store)
    ).toEqual({
      status: 'ready',
      optedOut: false,
      installationId: null,
      internal: false,
    });
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
    ).toEqual({
      status: 'ready',
      optedOut: true,
      installationId: null,
      internal: false,
    });
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
    ).toEqual({
      status: 'ready',
      optedOut: true,
      installationId: null,
      internal: false,
    });
  });

  it('refuses a malformed legacy id and mints instead', () => {
    const { store } = fakeStore();
    expect(
      readAnalyticsIdentity(
        {
          legacy: { optedOut: false, installationId: 'not-an-analytics-id' },
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
      internal: false,
    });
    expect(disk()).toEqual({
      terminal: { fontSize: 14 },
      analytics: { optedOut: true },
    });
    expect(setAnalyticsOptOut(false, store)).toEqual({
      status: 'ready',
      optedOut: false,
      installationId: null,
      internal: false,
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

describe('facts this device records once (ENG-047)', () => {
  it('claims the first Agent launch once, and keeps it across an opt-out', () => {
    const { store, disk } = fakeStore({
      analytics: { optedOut: false, installationId: KEPT },
    });
    expect(takeFirstAgentLaunch(store)).toBe(true);
    expect(takeFirstAgentLaunch(store)).toBe(false);
    setAnalyticsOptOut(true, store);
    expect(disk()).toEqual({
      analytics: { optedOut: true, agentLaunched: true },
    });
    setAnalyticsOptOut(false, store);
    expect(takeFirstAgentLaunch(store)).toBe(false);
  });

  it('claims the web link once, never while opted out, never on a bad read', () => {
    const fresh = fakeStore();
    expect(claimWebLink(fresh.store)).toBe(true);
    expect(claimWebLink(fresh.store)).toBe(false);

    expect(
      claimWebLink(fakeStore({ analytics: { optedOut: true } }).store)
    ).toBe(false);
    expect(claimWebLink(fakeStore('unreadable').store)).toBe(false);
    expect(claimWebLink(fakeStore({}, { failWrites: true }).store)).toBe(false);
  });
});

describe('who is internal (ENG-047 F6)', () => {
  it('a team sign-in marks the device for good, through sign-out and opt-out', () => {
    const { store, disk } = fakeStore({
      analytics: { optedOut: false, installationId: KEPT },
    });
    expect(markAnalyticsInternal(store)).toMatchObject({
      status: 'ready',
      internal: true,
    });
    setAnalyticsOptOut(true, store);
    setAnalyticsOptOut(false, store);
    expect(disk()).toEqual({
      analytics: { optedOut: false, internal: true },
    });
    expect(
      readAnalyticsIdentity({ legacy: null, ensureId: true }, store)
    ).toMatchObject({ installationId: MINTED, internal: true });
  });

  it('marks once, and answers unavailable for a mark it could not keep', () => {
    const marked = fakeStore({
      analytics: { optedOut: false, internal: true },
    });
    markAnalyticsInternal(marked.store);
    expect(marked.writes).toEqual([]);
    expect(
      markAnalyticsInternal(fakeStore({}, { failWrites: true }).store)
    ).toEqual({ status: 'unavailable' });
    expect(markAnalyticsInternal(fakeStore('unreadable').store)).toEqual({
      status: 'unavailable',
    });
  });

  it('a dogfood build marks its device, and the mark outlives the build', () => {
    const { store } = fakeStore();
    try {
      configureAnalyticsIdentity({ internalBuild: true });
      expect(
        readAnalyticsIdentity({ legacy: null, ensureId: true }, store)
      ).toMatchObject({ installationId: MINTED, internal: true });
    } finally {
      configureAnalyticsIdentity({ internalBuild: false });
    }
    expect(
      readAnalyticsIdentity({ legacy: null, ensureId: true }, store)
    ).toMatchObject({ installationId: MINTED, internal: true });
  });

  it('a signed build on an unmarked device is not internal', () => {
    expect(
      readAnalyticsIdentity({ legacy: null, ensureId: true }, fakeStore().store)
    ).toMatchObject({ internal: false });
  });
});

describe('the active day (ENG-047 F6)', () => {
  it('claims each local day once, and a new day again', () => {
    const { store, disk } = fakeStore({
      analytics: { optedOut: false, installationId: KEPT },
    });
    expect(claimActiveDay('2026-11-12', store)).toBe(true);
    expect(claimActiveDay('2026-11-12', store)).toBe(false);
    expect(claimActiveDay('2026-11-13', store)).toBe(true);
    expect(disk()).toEqual({
      analytics: {
        optedOut: false,
        installationId: KEPT,
        activeDay: '2026-11-13',
      },
    });
  });

  it('never claims while opted out, on a bad read, a failed write or a bad day', () => {
    expect(
      claimActiveDay(
        '2026-11-12',
        fakeStore({ analytics: { optedOut: true } }).store
      )
    ).toBe(false);
    expect(claimActiveDay('2026-11-12', fakeStore('unreadable').store)).toBe(
      false
    );
    expect(
      claimActiveDay('2026-11-12', fakeStore({}, { failWrites: true }).store)
    ).toBe(false);
    for (const bad of ['2026-13-01', '11/12/2026', '', null, 20261112]) {
      expect(claimActiveDay(bad, fakeStore().store)).toBe(false);
    }
  });
});
