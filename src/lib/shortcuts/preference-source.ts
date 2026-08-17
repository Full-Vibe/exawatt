'use client';

import { resolveDistributionIdentity } from '@exawatt/core/distribution';
import {
  getKeyboardShortcuts,
  updateKeyboardShortcuts,
} from '@/app/actions/preferences';
import { resolvedDistribution } from '@/lib/distribution/resolved';
import type {
  KeyBinding,
  ShortcutKeys,
  ShortcutOverride,
} from '@/types/shortcuts';

export interface ShortcutPreferenceSource {
  readonly kind: 'account' | 'local';
  load: () => Promise<ShortcutOverride[]>;
  save: (overrides: ShortcutOverride[]) => Promise<void>;
}

function localStorageKey(): string {
  const identity = resolveDistributionIdentity(resolvedDistribution());
  return `${identity.stateNamespace}:keyboard-shortcuts:v1`;
}

function isKeyBinding(value: unknown): value is KeyBinding {
  if (!value || typeof value !== 'object') return false;
  const binding = value as Partial<KeyBinding>;
  return (
    typeof binding.key === 'string' &&
    (binding.modifiers === undefined ||
      (Array.isArray(binding.modifiers) &&
        binding.modifiers.every(modifier =>
          ['ctrl', 'alt', 'shift', 'meta'].includes(String(modifier))
        )))
  );
}

function isShortcutKeys(value: unknown): value is ShortcutKeys {
  return (
    isKeyBinding(value) ||
    (Array.isArray(value) && value.length === 2 && value.every(isKeyBinding))
  );
}

function parseOverrides(value: unknown): ShortcutOverride[] {
  if (!Array.isArray(value)) return [];
  return value.every(
    override =>
      !!override &&
      typeof override === 'object' &&
      typeof (override as Partial<ShortcutOverride>).shortcutId === 'string' &&
      isShortcutKeys((override as Partial<ShortcutOverride>).keys)
  )
    ? (value as ShortcutOverride[])
    : [];
}

export function readLocalShortcutOverrides(
  storage: Pick<Storage, 'getItem'> = window.localStorage
): ShortcutOverride[] {
  try {
    const raw = storage.getItem(localStorageKey());
    return raw === null ? [] : parseOverrides(JSON.parse(raw));
  } catch {
    return [];
  }
}

export function writeLocalShortcutOverrides(
  overrides: ShortcutOverride[],
  storage: Pick<Storage, 'setItem'> = window.localStorage
): void {
  storage.setItem(localStorageKey(), JSON.stringify(parseOverrides(overrides)));
}

function localSource(): ShortcutPreferenceSource {
  return {
    kind: 'local',
    async load() {
      return readLocalShortcutOverrides();
    },
    async save(overrides) {
      writeLocalShortcutOverrides(overrides);
    },
  };
}

function accountSource(): ShortcutPreferenceSource {
  return {
    kind: 'account',
    load: getKeyboardShortcuts,
    async save(overrides) {
      const result = await updateKeyboardShortcuts(overrides);
      if (!result.success) {
        throw new Error(
          result.error ?? 'Keyboard shortcuts could not be saved.'
        );
      }
    },
  };
}

export function createShortcutPreferenceSource(): ShortcutPreferenceSource {
  return resolvedDistribution().account ? accountSource() : localSource();
}
