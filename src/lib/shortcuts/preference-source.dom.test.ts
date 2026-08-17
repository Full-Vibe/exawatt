import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  COMMUNITY_DISTRIBUTION,
  resolveDistributionIdentity,
} from '@exawatt/core/distribution';
import type { ShortcutOverride } from '@/types/shortcuts';
import { resetResolvedDistributionForTest } from '@/lib/distribution/resolved';

/**
 * The harm BUG-044 actually caused was not the 500 in the console; it was that
 * every saved keyboard override was silently replaced by defaults on every
 * launch of a community build. These cases are about survival, so they assert
 * what a SECOND launch sees.
 */

const getKeyboardShortcuts = vi.fn();
const updateKeyboardShortcuts = vi.fn(
  async (_overrides: ShortcutOverride[]) => ({ status: 'synced' })
);
const resetKeyboardShortcuts = vi.fn(async () => ({ status: 'synced' }));

vi.mock('@/app/actions/preferences', () => ({
  getKeyboardShortcuts: () => getKeyboardShortcuts(),
  updateKeyboardShortcuts: (overrides: ShortcutOverride[]) =>
    updateKeyboardShortcuts(overrides),
  resetKeyboardShortcuts: () => resetKeyboardShortcuts(),
}));

// The repository's own official example, read rather than copied: this file
// must not carry a second hand-written account block that can drift from the
// contract the hosted build actually uses.
const OFFICIAL = readFileSync(
  path.resolve(__dirname, '../../../scripts/distribution.official.example.json'),
  'utf8'
);

/** The key the community contract resolves to; asserted rather than hard-coded
 *  so a namespace change cannot leave these cases reading a dead key. */
function communityStorageKey(): string {
  return `${resolveDistributionIdentity(COMMUNITY_DISTRIBUTION).stateNamespace}:keyboard-shortcuts:v1`;
}

const REBIND: ShortcutOverride[] = [
  { shortcutId: 'command-terminal', keys: { key: '4', modifiers: ['meta'] } },
];

async function store() {
  return import('./preference-source');
}

function useContract(json?: string) {
  if (json === undefined) {
    delete process.env.NEXT_PUBLIC_EXAWATT_DISTRIBUTION_JSON;
  } else {
    process.env.NEXT_PUBLIC_EXAWATT_DISTRIBUTION_JSON = json;
  }
  resetResolvedDistributionForTest();
}

beforeEach(() => {
  window.localStorage.clear();
  delete (window as { electron?: unknown }).electron;
  vi.clearAllMocks();
  useContract(undefined);
});

afterEach(() => {
  useContract(undefined);
});

describe('a distribution with no account service', () => {
  it('keeps a rebind across launches and never asks the account', async () => {
    const { saveShortcutOverrides, loadShortcutOverrides } = await store();

    await saveShortcutOverrides(REBIND);
    // The "next launch": a fresh read against the same device.
    await expect(loadShortcutOverrides()).resolves.toEqual(REBIND);

    expect(getKeyboardShortcuts).not.toHaveBeenCalled();
    expect(updateKeyboardShortcuts).not.toHaveBeenCalled();
  });

  it('starts on defaults when the device has stored nothing', async () => {
    const { loadShortcutOverrides } = await store();
    await expect(loadShortcutOverrides()).resolves.toEqual([]);
  });

  it('remembers a deliberate reset instead of re-adopting old bindings', async () => {
    const { saveShortcutOverrides, resetShortcutOverrides, loadShortcutOverrides } =
      await store();

    await saveShortcutOverrides(REBIND);
    await resetShortcutOverrides();
    await expect(loadShortcutOverrides()).resolves.toEqual([]);
    expect(resetKeyboardShortcuts).not.toHaveBeenCalled();
  });

  it('refuses a malformed stored value rather than throwing on launch', async () => {
    window.localStorage.setItem(
      communityStorageKey(),
      '{"overrides":[{"shortcutId":"x"},{"shortcutId":42,"keys":{"key":"a"}}]}'
    );
    const { loadShortcutOverrides } = await store();
    await expect(loadShortcutOverrides()).resolves.toEqual([]);
  });
});

describe('a distribution that does ship an account service', () => {
  beforeEach(() => useContract(OFFICIAL));

  it('adopts the account copy once, on a device that has stored nothing', async () => {
    getKeyboardShortcuts.mockResolvedValue({
      status: 'loaded',
      overrides: REBIND,
    });
    const { loadShortcutOverrides } = await store();

    await expect(loadShortcutOverrides()).resolves.toEqual(REBIND);
    // Adopted, so the second launch answers locally even if the account is
    // unreachable — the account is a sync, never a dependency.
    getKeyboardShortcuts.mockRejectedValue(new Error('offline'));
    await expect(loadShortcutOverrides()).resolves.toEqual(REBIND);
  });

  it('never lets an unreadable account replace real bindings with defaults', async () => {
    const { saveShortcutOverrides, loadShortcutOverrides } = await store();
    await saveShortcutOverrides(REBIND);

    getKeyboardShortcuts.mockResolvedValue({ status: 'error' });
    await expect(loadShortcutOverrides()).resolves.toEqual(REBIND);
  });

  it('syncs a save to the account after the device write', async () => {
    const { saveShortcutOverrides } = await store();
    await saveShortcutOverrides(REBIND);
    expect(updateKeyboardShortcuts).toHaveBeenCalledWith(REBIND);
  });

  it('still saves locally when the account sync fails', async () => {
    updateKeyboardShortcuts.mockRejectedValueOnce(new Error('offline'));
    const { saveShortcutOverrides, loadShortcutOverrides } = await store();

    await expect(saveShortcutOverrides(REBIND)).resolves.toBeUndefined();
    getKeyboardShortcuts.mockResolvedValue({ status: 'error' });
    await expect(loadShortcutOverrides()).resolves.toEqual(REBIND);
  });
});

describe('the packaged desktop', () => {
  it('persists through the Electron settings store, not the per-launch origin', async () => {
    // The packaged renderer is served from a fresh ephemeral port each launch,
    // so a per-origin store starts empty every time (BUG-022). The desktop
    // path must not depend on that being repaired.
    let stored: unknown;
    (window as { electron?: unknown }).electron = {
      settings: {
        get: async () => ({ keyboardShortcuts: stored }),
        setKeyboardShortcuts: async (value: unknown) => {
          stored = value;
          return {};
        },
      },
    };

    const { saveShortcutOverrides, loadShortcutOverrides } = await store();
    await saveShortcutOverrides(REBIND);

    expect(window.localStorage.getItem(communityStorageKey())).toBe(null);
    await expect(loadShortcutOverrides()).resolves.toEqual(REBIND);
  });
});
