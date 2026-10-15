import { randomUUID } from 'node:crypto';
import {
  isAnalyticsId,
  type AnalyticsDeviceRecord,
  type AnalyticsIdentityRead,
  type AnalyticsLegacyIdentity,
} from '@exawatt/core/desktop-bridge';
import {
  readSettings,
  writeSettings,
  type SettingsRead,
  type StoredSettings,
} from './settings-store';

/**
 * BUG-171: product analytics identity is main's.
 *
 * The opt-out and the anonymous installation id used to live in the
 * renderer's `localStorage`, which is scoped to its loopback origin. Since
 * BUG-022 an install keeps one port, but a launch that finds it taken serves
 * from another origin with empty storage, and for that launch the opt-out
 * read as unset and a new id was minted. Both now live in `settings.json`,
 * which no port can change, and the renderer reads them through
 * `analytics:identity`.
 *
 * Every read is strict: an unreadable settings file, or an id that could not
 * be kept, answers `unavailable` and the renderer starts no analytics. A
 * failed read never answers "opted in" (it would silently undo an opt-out),
 * and an id that was not persisted would be a new person every launch.
 */

export interface AnalyticsSettingsStore {
  read(): SettingsRead;
  write(settings: StoredSettings): void;
  mint(): string;
}

const SETTINGS_STORE: AnalyticsSettingsStore = {
  read: readSettings,
  write: writeSettings,
  mint: randomUUID,
};

const UNAVAILABLE: AnalyticsIdentityRead = { status: 'unavailable' };

function legacyOf(raw: unknown): AnalyticsLegacyIdentity | null {
  if (!raw || typeof raw !== 'object') return null;
  const candidate = raw as Record<string, unknown>;
  return {
    optedOut: candidate.optedOut === true,
    installationId: isAnalyticsId(candidate.installationId)
      ? candidate.installationId
      : null,
  };
}

/**
 * The record after the renderer's pre-BUG-171 values are offered. A device
 * with no record adopts them whole. A device that already has one keeps its
 * id (a stable id is the point), but a legacy opt-out still wins: that origin
 * last said "off", and the renderer deletes its copy once main answers, so
 * it can assert itself exactly once.
 */
function adopt(
  current: AnalyticsDeviceRecord | undefined,
  legacy: AnalyticsLegacyIdentity | null
): AnalyticsDeviceRecord | undefined {
  if (!current) {
    if (!legacy) return undefined;
    if (legacy.optedOut) return { optedOut: true };
    return legacy.installationId
      ? { optedOut: false, installationId: legacy.installationId }
      : { optedOut: false };
  }
  if (legacy?.optedOut && !current.optedOut) return { optedOut: true };
  return current;
}

function answer(
  record: AnalyticsDeviceRecord | undefined
): AnalyticsIdentityRead {
  const optedOut = record?.optedOut === true;
  return {
    status: 'ready',
    optedOut,
    installationId: optedOut ? null : (record?.installationId ?? null),
  };
}

function persist(
  store: AnalyticsSettingsStore,
  settings: StoredSettings,
  record: AnalyticsDeviceRecord
): boolean {
  try {
    store.write({ ...settings, analytics: record });
    return true;
  } catch {
    return false;
  }
}

/**
 * The device's analytics identity. `ensureId` mints an id when none is held;
 * only a starting analytics client asks for that, so reading the Privacy
 * switch never creates identity, and a community build never asks at all.
 */
export function readAnalyticsIdentity(
  request: unknown,
  store: AnalyticsSettingsStore = SETTINGS_STORE
): AnalyticsIdentityRead {
  const read = store.read();
  if (read.status !== 'ready') return UNAVAILABLE;
  const candidate =
    request && typeof request === 'object'
      ? (request as Record<string, unknown>)
      : {};
  const current = read.settings.analytics;
  let next = adopt(current, legacyOf(candidate.legacy));
  if (candidate.ensureId === true && !next?.optedOut && !next?.installationId) {
    next = { optedOut: false, installationId: store.mint() };
  }
  if (next && next !== current) {
    if (!persist(store, read.settings, next)) return UNAVAILABLE;
  }
  return answer(next);
}

/**
 * Decision `0031`'s runtime switch. Opting out forgets the installation id;
 * opting back in mints a new one at the next launch, so the two periods are
 * never one person. A choice that cannot be persisted answers `unavailable`.
 */
export function setAnalyticsOptOut(
  optedOut: unknown,
  store: AnalyticsSettingsStore = SETTINGS_STORE
): AnalyticsIdentityRead {
  if (typeof optedOut !== 'boolean') {
    throw new TypeError('The analytics opt-out must be a boolean.');
  }
  const read = store.read();
  if (read.status !== 'ready') return UNAVAILABLE;
  const current = read.settings.analytics;
  const next: AnalyticsDeviceRecord = optedOut
    ? { optedOut: true }
    : current?.installationId
      ? { optedOut: false, installationId: current.installationId }
      : { optedOut: false };
  if (!persist(store, read.settings, next)) return UNAVAILABLE;
  return answer(next);
}
