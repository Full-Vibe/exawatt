import type { ElectronSettingsApi } from '@/types/electron';
import { DEFAULT_APPEARANCE_PREFERENCES } from './resolve-appearance';
import { parseProductionAppearancePreferences } from './preferences';
import type { AppearancePreferencesV1 } from './types';

export const APPEARANCE_MIRROR_STORAGE_KEY = 'exawatt.appearance.v1';
const APPEARANCE_MIRROR_EVENT = 'exawatt:appearance-mirror-changed';

export interface AppearancePreferenceSource {
  readonly kind: 'electron' | 'web';
  load: () => Promise<AppearancePreferencesV1>;
  save: (
    preferences: AppearancePreferencesV1
  ) => Promise<AppearancePreferencesV1>;
  subscribe: (
    handler: (preferences: AppearancePreferencesV1) => void
  ) => () => void;
}

function fallback(): AppearancePreferencesV1 {
  return structuredClone(DEFAULT_APPEARANCE_PREFERENCES);
}

export function readAppearanceMirror(
  storage: Pick<Storage, 'getItem' | 'removeItem'> = window.localStorage
): AppearancePreferencesV1 | null {
  try {
    const raw = storage.getItem(APPEARANCE_MIRROR_STORAGE_KEY);
    if (!raw) return null;
    const parsed = parseProductionAppearancePreferences(JSON.parse(raw));
    if (!parsed) storage.removeItem(APPEARANCE_MIRROR_STORAGE_KEY);
    return parsed;
  } catch {
    try {
      storage.removeItem(APPEARANCE_MIRROR_STORAGE_KEY);
    } catch {
      // A blocked storage surface still gets the in-memory Classic fallback.
    }
    return null;
  }
}

export function writeAppearanceMirror(
  preferences: AppearancePreferencesV1,
  storage: Pick<Storage, 'setItem'> = window.localStorage
): void {
  const parsed = parseProductionAppearancePreferences(preferences);
  if (!parsed) throw new Error('Cannot mirror an unavailable appearance');
  try {
    storage.setItem(APPEARANCE_MIRROR_STORAGE_KEY, JSON.stringify(parsed));
  } catch {
    // Persistence can be blocked in private/embedded contexts. The live
    // provider remains authoritative for this renderer lifetime.
  }
}

function electronSource(
  settings: ElectronSettingsApi
): AppearancePreferenceSource {
  return {
    kind: 'electron',
    async load() {
      const current = await settings.get();
      return (
        parseProductionAppearancePreferences(current.appearance) ?? fallback()
      );
    },
    async save(preferences) {
      const parsed = parseProductionAppearancePreferences(preferences);
      if (!parsed) throw new Error('Cannot save an unavailable appearance');
      const current = await settings.setAppearance(parsed);
      return (
        parseProductionAppearancePreferences(current.appearance) ?? fallback()
      );
    },
    subscribe(handler) {
      return settings.onChanged(current => {
        const parsed = parseProductionAppearancePreferences(current.appearance);
        if (parsed) handler(parsed);
      });
    },
  };
}

function webSource(): AppearancePreferenceSource {
  const load = () => readAppearanceMirror() ?? fallback();
  return {
    kind: 'web',
    async load() {
      return load();
    },
    async save(preferences) {
      const parsed = parseProductionAppearancePreferences(preferences);
      if (!parsed) throw new Error('Cannot save an unavailable appearance');
      writeAppearanceMirror(parsed);
      window.dispatchEvent(
        new CustomEvent(APPEARANCE_MIRROR_EVENT, { detail: parsed })
      );
      return parsed;
    },
    subscribe(handler) {
      const onStorage = (event: StorageEvent) => {
        if (event.key === APPEARANCE_MIRROR_STORAGE_KEY) handler(load());
      };
      const onMirror = (event: Event) => {
        const parsed = parseProductionAppearancePreferences(
          (event as CustomEvent<unknown>).detail
        );
        if (parsed) handler(parsed);
      };
      window.addEventListener('storage', onStorage);
      window.addEventListener(APPEARANCE_MIRROR_EVENT, onMirror);
      return () => {
        window.removeEventListener('storage', onStorage);
        window.removeEventListener(APPEARANCE_MIRROR_EVENT, onMirror);
      };
    },
  };
}

export function createAppearancePreferenceSource(): AppearancePreferenceSource {
  const settings =
    typeof window === 'undefined' ? undefined : window.electron?.settings;
  return settings?.setAppearance ? electronSource(settings) : webSource();
}
