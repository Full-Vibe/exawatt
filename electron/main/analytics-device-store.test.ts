import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { getPath: () => '/nonexistent' } }));

import type { AnalyticsDeviceRecord } from '@exawatt/core/desktop-bridge';
import {
  createAnalyticsDeviceStore,
  type DeviceFileIo,
} from './analytics-device-store';

const KEPT = '0b8e4f5e-3c1d-4a2b-9f6e-7d8c9b0a1e2f';

/** The two files main touches: its own record, and the settings copy. */
function fakeIo(options: {
  file?: Record<string, unknown> | 'absent' | 'unreadable';
  legacy?: AnalyticsDeviceRecord | 'unreadable';
  failFileWrites?: boolean;
  failLegacyWrites?: boolean;
}) {
  let file = options.file ?? 'absent';
  let legacy: AnalyticsDeviceRecord | undefined | 'unreadable' = options.legacy;
  const legacyWrites: AnalyticsDeviceRecord[] = [];
  const io: DeviceFileIo = {
    readFile: () =>
      file === 'absent'
        ? { status: 'absent' }
        : file === 'unreadable'
          ? { status: 'unreadable' }
          : { status: 'ok', value: structuredClone(file) },
    writeFile: value => {
      if (options.failFileWrites) throw new Error('EACCES');
      file = structuredClone(value);
    },
    readLegacy: () =>
      legacy === 'unreadable'
        ? { status: 'unreadable' }
        : { status: 'ready', record: structuredClone(legacy) },
    writeLegacy: record => {
      if (options.failLegacyWrites) throw new Error('EACCES');
      legacy = structuredClone(record);
      legacyWrites.push(legacy);
    },
  };
  return { io, file: () => file, legacy: () => legacy, legacyWrites };
}

describe('the analytics device record has a file of its own (ENG-047 F6)', () => {
  it('adopts the settings copy once, so an install keeps its id across the move', () => {
    const disk = fakeIo({
      legacy: { optedOut: false, installationId: KEPT, agentLaunched: true },
    });
    const store = createAnalyticsDeviceStore(disk.io);
    expect(store.read()).toEqual({
      status: 'ready',
      record: { optedOut: false, installationId: KEPT, agentLaunched: true },
    });
    expect(disk.file()).toEqual({
      optedOut: false,
      installationId: KEPT,
      agentLaunched: true,
    });
  });

  it('survives an older build rewriting settings without the record', () => {
    // The cause of the operator's three ids: a pre-F0 build saved settings
    // and dropped `analytics`. The record here is untouched by that.
    const disk = fakeIo({
      file: { optedOut: false, installationId: KEPT },
      legacy: undefined,
    });
    expect(createAnalyticsDeviceStore(disk.io).read()).toEqual({
      status: 'ready',
      record: { optedOut: false, installationId: KEPT },
    });
  });

  it('keeps keys a newer build wrote, through this build writing', () => {
    const disk = fakeIo({
      file: { optedOut: false, installationId: KEPT, futureFact: 3 },
    });
    createAnalyticsDeviceStore(disk.io).write({
      optedOut: false,
      installationId: KEPT,
      internal: true,
    });
    expect(disk.file()).toEqual({
      optedOut: false,
      installationId: KEPT,
      internal: true,
      futureFact: 3,
    });
  });

  it('mirrors what builds from 2026-10-15 read, so they share the id and the opt-out', () => {
    const disk = fakeIo({ file: { optedOut: false }, legacy: undefined });
    const store = createAnalyticsDeviceStore(disk.io);
    store.write({
      optedOut: true,
      agentLaunched: true,
      internal: true,
      activeDay: '2026-11-12',
    });
    expect(disk.legacy()).toEqual({ optedOut: true, agentLaunched: true });
    // An unchanged mirror is not rewritten for a field it does not carry.
    store.write({
      optedOut: true,
      agentLaunched: true,
      internal: true,
      activeDay: '2026-11-13',
    });
    expect(disk.legacyWrites).toHaveLength(1);
  });

  it('a mirror that cannot be written never fails the write', () => {
    const disk = fakeIo({ file: { optedOut: false }, failLegacyWrites: true });
    expect(() =>
      createAnalyticsDeviceStore(disk.io).write({
        optedOut: false,
        installationId: KEPT,
      })
    ).not.toThrow();
    expect(disk.file()).toMatchObject({ installationId: KEPT });
  });

  it('answers unavailable, never "no record", when either file cannot be read', () => {
    expect(
      createAnalyticsDeviceStore(fakeIo({ file: 'unreadable' }).io).read()
    ).toEqual({ status: 'unavailable' });
    expect(
      createAnalyticsDeviceStore(fakeIo({ legacy: 'unreadable' }).io).read()
    ).toEqual({ status: 'unavailable' });
    expect(
      createAnalyticsDeviceStore(
        fakeIo({
          legacy: { optedOut: false, installationId: KEPT },
          failFileWrites: true,
        }).io
      ).read()
    ).toEqual({ status: 'unavailable' });
  });

  it('a device that never asked has no record, and writes nothing to read it', () => {
    const disk = fakeIo({});
    expect(createAnalyticsDeviceStore(disk.io).read()).toEqual({
      status: 'ready',
      record: undefined,
    });
    expect(disk.file()).toBe('absent');
  });
});
