'use client';

import {
  emptyKeyboardShortcutOverrides,
  parseKeyboardShortcutOverrides,
  type KeyboardShortcutOverridesV1,
} from '@exawatt/core';
import { resolveDistributionIdentity } from '@exawatt/core/distribution';
import {
  getKeyboardShortcuts,
  resetKeyboardShortcuts,
  updateKeyboardShortcuts,
} from '@/app/actions/preferences';
import { distributionCapabilities } from '@/lib/distribution/capabilities';
import { resolvedDistribution } from '@/lib/distribution/resolved';
import type { ShortcutOverride } from '@/types/shortcuts';

/**
 * Where a rebound key actually lives (BUG-044).
 *
 * A keyboard override is a property of THIS device. It needs no account, and
 * making it need one is what broke it: in a distribution with no account
 * service the read threw, the provider swallowed the error, and every saved
 * override was silently replaced by defaults on every launch.
 *
 * So the device is the source of truth and the write that matters happens
 * locally, first, before any network exists in the picture:
 *
 * - Desktop: `userData/settings.json` through the Electron settings bridge.
 *   Deliberately NOT `localStorage` — the packaged renderer is served from a
 *   fresh ephemeral port each launch, so a per-origin store starts empty every
 *   time (BUG-022). Nothing here depends on that being repaired.
 * - Web: `localStorage`, whose origin is stable there.
 *
 * An account, where the distribution ships one, SYNCS the device copy. It is
 * the second act, never the first, and its failure is never the operator's
 * problem: the bindings are already saved.
 *
 * This supersedes the account-OR-local source that landed hours earlier in the
 * same day. That version stopped the 500 but not the data loss: its local arm
 * was `localStorage`, which on the packaged desktop — the build the defect was
 * reported from — is a fresh empty store on every launch, and its account arm
 * made a configured distribution depend on a remote read that a stale or failed
 * answer could still turn into defaults. One path, device-first, replaces both.
 */

/** Scoped to the distribution's own state namespace so two distributions
 *  sharing an origin never read each other's bindings. */
function storageKey(): string {
  const identity = resolveDistributionIdentity(resolvedDistribution());
  return `${identity.stateNamespace}:keyboard-shortcuts:v1`;
}

function accountConfigured(): boolean {
  try {
    return distributionCapabilities(resolvedDistribution()).account;
  } catch {
    return false;
  }
}

/**
 * Present only inside the desktop shell, and only once its preload carries the
 * channel — an older shell driving a newer renderer falls through to the web
 * path rather than losing the write.
 */
function settingsBridge() {
  if (typeof window === 'undefined') return null;
  const bridge = window.electron?.settings;
  if (!bridge || typeof bridge.setKeyboardShortcuts !== 'function') return null;
  return bridge as typeof bridge & {
    setKeyboardShortcuts: NonNullable<typeof bridge.setKeyboardShortcuts>;
  };
}

function toOverrides(stored: KeyboardShortcutOverridesV1): ShortcutOverride[] {
  return stored.overrides as ShortcutOverride[];
}

/**
 * `null` means "this device has never stored a choice", which is different
 * from "this device stored no overrides". Only the first is allowed to adopt
 * an account copy; the second is a deliberate reset that a stale remote row
 * must not undo.
 */
async function readLocal(): Promise<ShortcutOverride[] | null> {
  const bridge = settingsBridge();
  if (bridge) {
    try {
      const settings = await bridge.get();
      const stored = settings?.keyboardShortcuts;
      if (stored === undefined) return null;
      return toOverrides(parseKeyboardShortcutOverrides(stored));
    } catch {
      return null;
    }
  }
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(storageKey());
    if (raw === null) return null;
    return toOverrides(parseKeyboardShortcutOverrides(JSON.parse(raw)));
  } catch {
    return null;
  }
}

async function writeLocal(overrides: ShortcutOverride[]): Promise<void> {
  const payload = parseKeyboardShortcutOverrides({
    ...emptyKeyboardShortcutOverrides(),
    overrides,
  });
  const bridge = settingsBridge();
  if (bridge) {
    try {
      await bridge.setKeyboardShortcuts(payload);
    } catch (error) {
      console.warn('[exawatt] could not persist keyboard overrides:', error);
    }
    return;
  }
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      storageKey(),
      JSON.stringify(payload)
    );
  } catch (error) {
    console.warn('[exawatt] could not persist keyboard overrides:', error);
  }
}

/**
 * The device copy, adopting an account copy exactly once: the first time this
 * device is used by a signed-in operator who already rebound keys elsewhere.
 * After that the device answers on its own, so a slow or failed account read
 * can never replace real bindings with defaults.
 */
export async function loadShortcutOverrides(): Promise<ShortcutOverride[]> {
  const local = await readLocal();
  // No write-back on load. The save path already syncs, and pushing the device
  // copy on every mount would let a machine that has not been rebound in months
  // overwrite what another device saved yesterday.
  if (local !== null) return local;
  if (!accountConfigured()) return [];
  try {
    const remote = await getKeyboardShortcuts();
    if (remote.status !== 'loaded') return [];
    await writeLocal(remote.overrides);
    return remote.overrides;
  } catch (error) {
    console.warn('[exawatt] could not read account keyboard overrides:', error);
    return [];
  }
}

async function syncToAccount(overrides: ShortcutOverride[]): Promise<void> {
  try {
    await updateKeyboardShortcuts(overrides);
  } catch (error) {
    console.warn('[exawatt] could not sync keyboard overrides:', error);
  }
}

/** Local write first; the account sync is best-effort and never awaited by
 *  the caller's success path. */
export async function saveShortcutOverrides(
  overrides: ShortcutOverride[]
): Promise<void> {
  await writeLocal(overrides);
  if (accountConfigured()) await syncToAccount(overrides);
}

export async function resetShortcutOverrides(): Promise<void> {
  await writeLocal([]);
  if (!accountConfigured()) return;
  try {
    await resetKeyboardShortcuts();
  } catch (error) {
    console.warn('[exawatt] could not reset account keyboard overrides:', error);
  }
}
