'use client';

import { useSyncExternalStore } from 'react';
import { shortcutRegistry } from '@/lib/shortcuts';

const subscribe = (listener: () => void) =>
  shortcutRegistry.subscribe(listener);
const getSnapshot = () => shortcutRegistry.getVersion();
const getServerSnapshot = () => -1;

/** Effective registry keys with live rebind updates. */
export function useShortcutRegistryVersion() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** Effective registry keys with live rebind updates. */
export function useEffectiveShortcut(shortcutId: string | null) {
  const version = useShortcutRegistryVersion();
  if (version < 0) return undefined;
  return shortcutId ? shortcutRegistry.getEffectiveKeys(shortcutId) : undefined;
}
