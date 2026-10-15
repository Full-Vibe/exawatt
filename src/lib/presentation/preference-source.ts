import {
  parsePresentationPreferences,
  type PresentationPreferencesV1,
} from '@exawatt/core/desktop-bridge';

export const PRESENTATION_STORAGE_KEY = 'exawatt.presentation.v1';
const CHANGE_EVENT = 'exawatt:presentation-changed';
type Preference = PresentationPreferencesV1 | undefined;

interface PresentationPreferenceSource {
  load: () => Promise<Preference>;
  save: (preference: Preference) => Promise<Preference>;
  subscribe: (handler: (preference: Preference) => void) => () => void;
}

function readWeb(): Preference {
  try {
    const saved = window.localStorage.getItem(PRESENTATION_STORAGE_KEY);
    return saved ? parsePresentationPreferences(JSON.parse(saved)) : undefined;
  } catch {
    return undefined;
  }
}

export function createPresentationPreferenceSource(): PresentationPreferenceSource {
  const settings =
    typeof window === 'undefined' ? undefined : window.electron?.settings;
  if (settings?.setPresentation) {
    return {
      async load() {
        return parsePresentationPreferences(
          (await settings.get()).presentation
        );
      },
      async save(preference) {
        return parsePresentationPreferences(
          (await settings.setPresentation(preference ?? null)).presentation
        );
      },
      subscribe(handler) {
        return settings.onChanged(current =>
          handler(parsePresentationPreferences(current.presentation))
        );
      },
    };
  }
  return {
    async load() {
      return readWeb();
    },
    async save(preference) {
      const parsed = parsePresentationPreferences(preference);
      const choice =
        parsed?.fleetView || parsed?.fleetMaterial ? parsed : undefined;
      try {
        if (choice)
          window.localStorage.setItem(
            PRESENTATION_STORAGE_KEY,
            JSON.stringify(choice)
          );
        else window.localStorage.removeItem(PRESENTATION_STORAGE_KEY);
      } catch {
        // Keep this renderer usable when storage is unavailable.
      }
      window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: choice }));
      return choice;
    },
    subscribe(handler) {
      const onStorage = (event: StorageEvent) => {
        if (event.key === PRESENTATION_STORAGE_KEY || event.key === null)
          handler(readWeb());
      };
      const onChange = (event: Event) =>
        handler(
          parsePresentationPreferences((event as CustomEvent<unknown>).detail)
        );
      window.addEventListener('storage', onStorage);
      window.addEventListener(CHANGE_EVENT, onChange);
      return () => {
        window.removeEventListener('storage', onStorage);
        window.removeEventListener(CHANGE_EVENT, onChange);
      };
    },
  };
}
