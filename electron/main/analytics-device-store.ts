import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import {
  parseAnalyticsDeviceRecord,
  type AnalyticsDeviceRecord,
} from '@exawatt/core/desktop-bridge';
import {
  recordStoreDiagnostic,
  replaceJsonFileAtomic,
  reportJsonStoreReadFailure,
  setAsideDamagedFile,
} from './atomic-json-file';
import { readSettings, writeSettings } from './settings-store';

/**
 * ENG-047 F6 — where main keeps this device's analytics record.
 *
 * The record used to live in `settings.json` (BUG-171). Every build parses
 * that file down to the keys it knows and writes back only those, so a
 * build older than the record (a 0.1.10 dogfood opened by Launch Services,
 * 2026-10-22 and 2026-10-28) rewrote settings without it, and the next
 * launch minted a new installation id: the operator's install became three
 * people in three weeks. The record now has a file of its own,
 * `analytics-device.json`, which no other build writes, and a write keeps
 * every key it does not know, so a newer build's fields survive an older
 * one.
 *
 * Compatibility, both directions:
 *  - **Adoption.** When the file does not exist yet, the settings copy is
 *    adopted and written here once, so an install keeps its id across the
 *    move.
 *  - **Mirror.** Each write also refreshes the settings copy with the fields
 *    builds from 2026-10-15 on read (opt-out, id, the two facts), so such a
 *    build launched on the same profile reports under the same id and
 *    honours the same opt-out. Best effort: the file here is the authority,
 *    and a mirror that cannot be written never fails the write.
 *
 * Reads are strict, as before: a file that cannot be read is `unavailable`,
 * never "no record" (absence is not an answer). A file that reads but does
 * not parse is set aside and the record is adopted again from the mirror,
 * which holds the same id; nothing is quarantined for good, because a
 * permanently unreadable record would silently end analytics on the device.
 */

export type AnalyticsDeviceRead =
  | { status: 'ready'; record: AnalyticsDeviceRecord | undefined }
  | { status: 'unavailable' };

export interface AnalyticsDeviceStore {
  read(): AnalyticsDeviceRead;
  /** Throws when the record could not be kept. */
  write(record: AnalyticsDeviceRecord): void;
  mint(): string;
}

/** The keys this build understands; any other key on disk is kept as is. */
const KNOWN_KEYS: ReadonlySet<string> = new Set<keyof AnalyticsDeviceRecord>([
  'optedOut',
  'installationId',
  'agentLaunched',
  'webLinked',
  'internal',
  'activeDay',
]);

/** The fields builds from 2026-10-15 to 2026-11-12 read from settings. */
function legacyView(record: AnalyticsDeviceRecord): AnalyticsDeviceRecord {
  const view: AnalyticsDeviceRecord = { optedOut: record.optedOut };
  if (record.installationId) view.installationId = record.installationId;
  if (record.agentLaunched) view.agentLaunched = true;
  if (record.webLinked) view.webLinked = true;
  return view;
}

function sameRecord(
  a: AnalyticsDeviceRecord | undefined,
  b: AnalyticsDeviceRecord
): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b);
}

export interface DeviceFileIo {
  /** `absent`, the parsed JSON object, or `unreadable`. */
  readFile():
    | { status: 'absent' }
    | { status: 'ok'; value: Record<string, unknown> }
    | { status: 'unreadable' };
  writeFile(value: Record<string, unknown>): void;
  /** The settings copy: `unreadable`, or the record it holds, if any. */
  readLegacy():
    | { status: 'ready'; record: AnalyticsDeviceRecord | undefined }
    | { status: 'unreadable' };
  writeLegacy(record: AnalyticsDeviceRecord): void;
}

export function createAnalyticsDeviceStore(
  io: DeviceFileIo,
  mint: () => string = randomUUID
): AnalyticsDeviceStore {
  /** Unknown keys from disk, kept through every write. */
  const carried = (): Record<string, unknown> => {
    const current = io.readFile();
    if (current.status !== 'ok') return {};
    return Object.fromEntries(
      Object.entries(current.value).filter(([key]) => !KNOWN_KEYS.has(key))
    );
  };

  const mirror = (record: AnalyticsDeviceRecord) => {
    try {
      const legacy = io.readLegacy();
      if (legacy.status !== 'ready') return;
      const view = legacyView(record);
      if (!sameRecord(legacy.record, view)) io.writeLegacy(view);
    } catch {
      // The record here is the authority; the mirror is for older builds.
    }
  };

  const write = (record: AnalyticsDeviceRecord) => {
    io.writeFile({ ...carried(), ...record });
    mirror(record);
  };

  return {
    read() {
      const current = io.readFile();
      if (current.status === 'unreadable') return { status: 'unavailable' };
      if (current.status === 'ok') {
        return {
          status: 'ready',
          record: parseAnalyticsDeviceRecord(current.value),
        };
      }
      // First read since the move: adopt the settings copy, once.
      const legacy = io.readLegacy();
      if (legacy.status !== 'ready') return { status: 'unavailable' };
      if (!legacy.record) return { status: 'ready', record: undefined };
      try {
        io.writeFile({ ...legacy.record });
      } catch {
        // Like any id that cannot be kept: no analytics this launch.
        return { status: 'unavailable' };
      }
      return { status: 'ready', record: legacy.record };
    },
    write,
    mint,
  };
}

function deviceFile(): string {
  return path.join(app.getPath('userData'), 'analytics-device.json');
}

const FILE_IO: DeviceFileIo = {
  readFile() {
    const file = deviceFile();
    let text: string;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
        return { status: 'absent' };
      }
      reportJsonStoreReadFailure(file);
      return { status: 'unreadable' };
    }
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      value = null;
    }
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return { status: 'ok', value: value as Record<string, unknown> };
    }
    try {
      setAsideDamagedFile(file);
      recordStoreDiagnostic('store.set-aside', { store: path.basename(file) });
    } catch {
      return { status: 'unreadable' };
    }
    return { status: 'absent' };
  },
  writeFile(value) {
    replaceJsonFileAtomic(deviceFile(), value);
  },
  readLegacy() {
    const read = readSettings();
    return read.status === 'ready'
      ? { status: 'ready', record: read.settings.analytics }
      : { status: 'unreadable' };
  },
  writeLegacy(record) {
    const read = readSettings();
    if (read.status !== 'ready') return;
    writeSettings({ ...read.settings, analytics: record });
  },
};

export const ANALYTICS_DEVICE_STORE: AnalyticsDeviceStore =
  createAnalyticsDeviceStore(FILE_IO);
