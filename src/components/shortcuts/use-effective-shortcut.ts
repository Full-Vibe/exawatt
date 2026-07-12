'use client';

import { useSyncExternalStore } from 'react';
import { shortcutRegistry } from '@/lib/shortcuts';

const subscribe = (listener: () => void) =>
  shortcutRegistry.subscribe(listener);
const getSnapshot = () => shortcutRegistry.getVersion();

/** Effective registry keys with live rebind updates. */
export function useShortcutRegistryVersion() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Effective registry keys with live rebind updates. */
export function useEffectiveShortcut(shortcutId: string | null) {
  useShortcutRegistryVersion();
  return shortcutId ? shortcutRegistry.getEffectiveKeys(shortcutId) : undefined;
}
