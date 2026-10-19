import type { HeldStateHolder } from './held-state';

/**
 * What the app keeps in session storage lives for one run by design: where
 * the Fleet camera was (`operations-board-surface.tsx`), which Fleet view to
 * return to (`spatial-return.ts`). A quit forgets it. A restart or an update
 * is not the operator leaving, so this carries every `exawatt:` entry across
 * it (BUG-260), and any later per-run position stored the same way comes
 * along without being listed here.
 */
const PREFIX = 'exawatt:';
const MAX_ENTRIES = 32;
const MAX_VALUE = 4_096;

type Entries = Record<string, string>;

function parseEntries(value: unknown): Entries | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(
      (entry): entry is [string, string] =>
        entry[0].startsWith(PREFIX) &&
        typeof entry[1] === 'string' &&
        entry[1].length <= MAX_VALUE
    )
    .slice(0, MAX_ENTRIES);
  return entries.length > 0 ? Object.fromEntries(entries) : null;
}

export function sessionStorageHolder(scope: {
  sessionStorage: Storage;
}): HeldStateHolder<Entries> {
  return {
    capture: () => {
      const entries: Entries = {};
      const storage = scope.sessionStorage;
      for (let index = 0; index < storage.length; index++) {
        const key = storage.key(index);
        if (key?.startsWith(PREFIX)) {
          entries[key] = storage.getItem(key) ?? '';
        }
      }
      return parseEntries(entries);
    },
    parse: parseEntries,
    restore: (entries, failed) => {
      for (const [key, value] of Object.entries(entries)) {
        // One refused write (quota, a blocked storage) costs that entry.
        try {
          // This run's own value, if it already has one, is newer.
          if (scope.sessionStorage.getItem(key) === null) {
            scope.sessionStorage.setItem(key, value);
          }
        } catch (error) {
          failed(key, error);
        }
      }
    },
  };
}
