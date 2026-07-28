'use client';

import { useSyncExternalStore } from 'react';

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

function subscribe(onStoreChange: () => void) {
  if (typeof window.matchMedia !== 'function') return () => undefined;
  const query = window.matchMedia(REDUCED_MOTION_QUERY);
  query.addEventListener('change', onStoreChange);
  return () => query.removeEventListener('change', onStoreChange);
}

function getSnapshot() {
  return typeof window.matchMedia === 'function'
    ? window.matchMedia(REDUCED_MOTION_QUERY).matches
    : false;
}

function getServerSnapshot() {
  return false;
}

export function usePrefersReducedMotion() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
