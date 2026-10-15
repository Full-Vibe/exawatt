/**
 * BUG-171 — where this device's analytics opt-out and anonymous id live.
 *
 * The website keeps both in `localStorage`, which is the browser's own
 * per-site store. The desktop app keeps both in Electron main's settings,
 * because its renderer is served from a loopback origin, and a launch that
 * finds the kept port taken serves from another origin with empty storage:
 * read from `localStorage` there, the opt-out read as unset and a new id was
 * minted. A desktop install that kept values on its origin before this moved
 * offers them to main once, and drops its copy when main answers.
 *
 * `null` means the identity could not be read. It is never the same answer
 * as "opted in": the caller starts no analytics for that load.
 */

import { isAnalyticsId } from '@exawatt/core/desktop-bridge';
import { detectElectron } from './config';

export const ANALYTICS_OPT_OUT_STORAGE_KEY = 'exawatt.analytics.opt-out.v1';
export const ANALYTICS_INSTALLATION_ID_STORAGE_KEY =
  'exawatt.analytics.installation-id.v1';

interface AnalyticsIdentity {
  optedOut: boolean;
  /** Null while opted out, or before anything asked for one. */
  installationId: string | null;
}

type MinimalStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function localStorageOrNull(): MinimalStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    // Blocked storage (private mode, embedded contexts) is not an error here.
    return null;
  }
}

/* ---- The website: the browser's own store ------------------------------ */

function readWebIdentity(
  storage: MinimalStorage | null,
  ensureId: boolean,
  generate: () => string
): AnalyticsIdentity | null {
  if (!storage) return null;
  try {
    if (storage.getItem(ANALYTICS_OPT_OUT_STORAGE_KEY) === 'true') {
      return { optedOut: true, installationId: null };
    }
    const existing = storage.getItem(ANALYTICS_INSTALLATION_ID_STORAGE_KEY);
    if (isAnalyticsId(existing)) {
      return { optedOut: false, installationId: existing };
    }
    if (!ensureId) return { optedOut: false, installationId: null };
    const created = generate();
    storage.setItem(ANALYTICS_INSTALLATION_ID_STORAGE_KEY, created);
    return { optedOut: false, installationId: created };
  } catch {
    return null;
  }
}

function writeWebOptOut(
  storage: MinimalStorage | null,
  optedOut: boolean
): AnalyticsIdentity | null {
  if (!storage) return null;
  try {
    if (optedOut) {
      storage.setItem(ANALYTICS_OPT_OUT_STORAGE_KEY, 'true');
      storage.removeItem(ANALYTICS_INSTALLATION_ID_STORAGE_KEY);
    } else {
      storage.removeItem(ANALYTICS_OPT_OUT_STORAGE_KEY);
    }
  } catch {
    return null;
  }
  return readWebIdentity(storage, false, () => '');
}

/* ---- The desktop app: main's settings ---------------------------------- */

function desktopBridge() {
  return typeof window === 'undefined' ? undefined : window.electron?.analytics;
}

/** What this origin kept before BUG-171, if anything. */
function readLegacyDesktopIdentity(storage: MinimalStorage | null) {
  try {
    const optedOut = storage?.getItem(ANALYTICS_OPT_OUT_STORAGE_KEY) === 'true';
    const id = storage?.getItem(ANALYTICS_INSTALLATION_ID_STORAGE_KEY) ?? null;
    if (!optedOut && id === null) return null;
    return { optedOut, installationId: isAnalyticsId(id) ? id : null };
  } catch {
    return null;
  }
}

function dropLegacyDesktopIdentity(storage: MinimalStorage | null): void {
  try {
    storage?.removeItem(ANALYTICS_OPT_OUT_STORAGE_KEY);
    storage?.removeItem(ANALYTICS_INSTALLATION_ID_STORAGE_KEY);
  } catch {
    // Main already holds the answer; a stale copy only re-offers itself.
  }
}

async function readDesktopIdentity(
  ensureId: boolean
): Promise<AnalyticsIdentity | null> {
  const bridge = desktopBridge();
  if (!bridge) return null;
  const storage = localStorageOrNull();
  const legacy = readLegacyDesktopIdentity(storage);
  try {
    const read = await bridge.identity({ legacy, ensureId });
    if (read.status !== 'ready') return null;
    if (legacy) dropLegacyDesktopIdentity(storage);
    return { optedOut: read.optedOut, installationId: read.installationId };
  } catch {
    return null;
  }
}

/* ---- One surface for both ---------------------------------------------- */

/**
 * The opt-out and, with `ensureId`, an id (minted and kept when none is
 * held). Only a starting analytics client passes `ensureId`; reading the
 * Privacy switch creates no identity.
 */
export async function loadAnalyticsIdentity(
  options: { ensureId: boolean },
  generate: () => string = () => crypto.randomUUID()
): Promise<AnalyticsIdentity | null> {
  if (detectElectron()) return readDesktopIdentity(options.ensureId);
  return readWebIdentity(localStorageOrNull(), options.ensureId, generate);
}

/** Persist the opt-out. Opting out forgets the id. `null`: not persisted. */
export async function persistAnalyticsOptOut(
  optedOut: boolean
): Promise<AnalyticsIdentity | null> {
  if (!detectElectron()) return writeWebOptOut(localStorageOrNull(), optedOut);
  const bridge = desktopBridge();
  if (!bridge) return null;
  try {
    const read = await bridge.setOptOut(optedOut);
    return read.status === 'ready'
      ? { optedOut: read.optedOut, installationId: read.installationId }
      : null;
  } catch {
    return null;
  }
}
