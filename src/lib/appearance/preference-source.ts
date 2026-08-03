import type { ElectronSettingsApi } from '@/types/electron';
import {
  CLASSIC_RECOVERY_APPEARANCE_PREFERENCES,
  DEFAULT_APPEARANCE_PREFERENCES,
} from './resolve-appearance';
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

function defaultPreferences(): AppearancePreferencesV1 {
  return structuredClone(DEFAULT_APPEARANCE_PREFERENCES);
}

function recoveryPreferences(): AppearancePreferencesV1 {
  return structuredClone(CLASSIC_RECOVERY_APPEARANCE_PREFERENCES);
}

export function readAppearanceMirror(
  storage: Pick<Storage, 'getItem' | 'setItem'> = window.localStorage
): AppearancePreferencesV1 | null {
  try {
    const raw = storage.getItem(APPEARANCE_MIRROR_STORAGE_KEY);
    if (raw === null) return null;
    const parsed = parseProductionAppearancePreferences(JSON.parse(raw));
    if (parsed) return parsed;
    const recovery = recoveryPreferences();
    storage.setItem(APPEARANCE_MIRROR_STORAGE_KEY, JSON.stringify(recovery));
    return recovery;
  } catch {
    try {
      const recovery = recoveryPreferences();
      storage.setItem(APPEARANCE_MIRROR_STORAGE_KEY, JSON.stringify(recovery));
      return recovery;
    } catch {
      // A blocked storage surface still gets the in-memory recovery state.
    }
    return recoveryPreferences();
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
      return current.appearance === undefined
        ? defaultPreferences()
        : (parseProductionAppearancePreferences(current.appearance) ??
            recoveryPreferences());
    },
    async save(preferences) {
      const parsed = parseProductionAppearancePreferences(preferences);
      if (!parsed) throw new Error('Cannot save an unavailable appearance');
      const current = await settings.setAppearance(parsed);
      return (
        parseProductionAppearancePreferences(current.appearance) ??
        recoveryPreferences()
      );
    },
    subscribe(handler) {
      return settings.onChanged(current => {
        handler(
          current.appearance === undefined
            ? defaultPreferences()
            : (parseProductionAppearancePreferences(current.appearance) ??
                recoveryPreferences())
        );
      });
    },
  };
}

function webSource(): AppearancePreferenceSource {
  const load = () => readAppearanceMirror() ?? defaultPreferences();
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
