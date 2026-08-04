import type { ElectronSettingsApi } from '@/types/electron';

export const GOAL_VISUAL_PREFERENCE_STORAGE_KEY =
  'exawatt.goal-visuals.enabled.v1';
const GOAL_VISUAL_PREFERENCE_EVENT = 'exawatt:goal-visuals-enabled-changed';

export interface GoalVisualPreferenceSource {
  readonly kind: 'electron' | 'web';
  load: () => Promise<boolean>;
  save: (enabled: boolean) => Promise<boolean>;
  subscribe: (handler: (enabled: boolean) => void) => () => void;
}

function readWebPreference(
  storage: Pick<Storage, 'getItem'> = window.localStorage
): boolean {
  try {
    return storage.getItem(GOAL_VISUAL_PREFERENCE_STORAGE_KEY) !== 'false';
  } catch {
    return true;
  }
}

function writeWebPreference(
  enabled: boolean,
  storage: Pick<Storage, 'setItem'> = window.localStorage
): void {
  try {
    storage.setItem(GOAL_VISUAL_PREFERENCE_STORAGE_KEY, String(enabled));
  } catch {
    // The provider keeps this renderer's preference even when browser storage
    // is unavailable (for example in a locked-down embedded context).
  }
}

function electronSource(
  settings: ElectronSettingsApi
): GoalVisualPreferenceSource {
  return {
    kind: 'electron',
    async load() {
      const current = await settings.get();
      return current.goalVisuals?.enabled !== false;
    },
    async save(enabled) {
      const current = await settings.setGoalVisualsEnabled(enabled);
      return current.goalVisuals?.enabled !== false;
    },
    subscribe(handler) {
      return settings.onChanged(current => {
        handler(current.goalVisuals?.enabled !== false);
      });
    },
  };
}

function webSource(): GoalVisualPreferenceSource {
  return {
    kind: 'web',
    async load() {
      return readWebPreference();
    },
    async save(enabled) {
      writeWebPreference(enabled);
      window.dispatchEvent(
        new CustomEvent<boolean>(GOAL_VISUAL_PREFERENCE_EVENT, {
          detail: enabled,
        })
      );
      return enabled;
    },
    subscribe(handler) {
      const onStorage = (event: StorageEvent) => {
        if (event.key === GOAL_VISUAL_PREFERENCE_STORAGE_KEY) {
          handler(readWebPreference());
        }
      };
      const onPreference = (event: Event) => {
        const enabled = (event as CustomEvent<unknown>).detail;
        if (typeof enabled === 'boolean') handler(enabled);
      };
      window.addEventListener('storage', onStorage);
      window.addEventListener(GOAL_VISUAL_PREFERENCE_EVENT, onPreference);
      return () => {
        window.removeEventListener('storage', onStorage);
        window.removeEventListener(GOAL_VISUAL_PREFERENCE_EVENT, onPreference);
      };
    },
  };
}

export function createGoalVisualPreferenceSource(): GoalVisualPreferenceSource {
  const settings =
    typeof window === 'undefined' ? undefined : window.electron?.settings;
  return settings?.setGoalVisualsEnabled
    ? electronSource(settings)
    : webSource();
}
