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
  if (legacy?.optedOut && !current.optedOut) return withOptOut(current, true);
  if (!current.optedOut && !current.installationId && legacy?.installationId) {
    return { ...current, installationId: legacy.installationId };
  }
  return current;
}

/** The record with the opt-out set; opting out forgets the id, and only the
 *  id: what this device has done (an Agent launched, a link followed) is a
 *  local fact, not identity. */
function withOptOut(
  current: AnalyticsDeviceRecord | undefined,
  optedOut: boolean
): AnalyticsDeviceRecord {
  const { installationId, ...facts } = current ?? { optedOut };
  return optedOut || !installationId
    ? { ...facts, optedOut }
    : { ...facts, optedOut, installationId };
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
    next = { ...next, optedOut: false, installationId: store.mint() };
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
  const next = withOptOut(read.settings.analytics, optedOut);
  if (!persist(store, read.settings, next)) return UNAVAILABLE;
  return answer(next);
}

/**
 * Record one fact about this device once. Answers true exactly the first
 * time, and false on every later call, on an unreadable file, or when the
 * fact could not be written (so it is never claimed twice).
 */
function claimOnce(
  fact: 'agentLaunched' | 'webLinked',
  store: AnalyticsSettingsStore,
  options: { unlessOptedOut: boolean }
): boolean {
  const read = store.read();
  if (read.status !== 'ready') return false;
  const current = read.settings.analytics;
  if (current?.[fact]) return false;
  if (options.unlessOptedOut && current?.optedOut) return false;
  const next: AnalyticsDeviceRecord = {
    ...(current ?? { optedOut: false }),
    [fact]: true,
  };
  return persist(store, read.settings, next);
}

/** ENG-047 `first_for_install`: true for this installation's first Agent.
 *  Kept even while opted out, so opting in later does not claim a first. */
export function takeFirstAgentLaunch(
  store: AnalyticsSettingsStore = SETTINGS_STORE
): boolean {
  return claimOnce('agentLaunched', store, { unlessOptedOut: false });
}

/** ENG-047 F2: true the one time this installation may record the
 *  web-to-app alias; never while opted out, never twice. */
export function claimWebLink(
  store: AnalyticsSettingsStore = SETTINGS_STORE
): boolean {
  return claimOnce('webLinked', store, { unlessOptedOut: true });
}
