import {
  applyPresentationUpdate,
  parsePresentationPreferences,
  type PresentationPreferencesV1,
  type PresentationUpdate,
} from '@exawatt/core/desktop-bridge';

/** Read-only migration input. New choices never rewrite a combined snapshot. */
export const PRESENTATION_STORAGE_KEY = 'exawatt.presentation.v1';
export const PRESENTATION_FIELD_STORAGE_KEYS = {
  fleetView: 'exawatt.presentation.fleetView.v1',
  fleetMaterial: 'exawatt.presentation.fleetMaterial.v1',
} as const;
const CHANGE_EVENT = 'exawatt:presentation-changed';
type Preference = PresentationPreferencesV1 | undefined;

interface PresentationPreferenceSource {
  load: () => Promise<Preference>;
  update: (intent: PresentationUpdate) => Promise<Preference>;
  subscribe: (handler: (preference: Preference) => void) => () => void;
}

function readWeb(): Preference {
  try {
    let preference: Preference;
    const legacy = window.localStorage.getItem(PRESENTATION_STORAGE_KEY);
    try {
      preference = legacy
        ? parsePresentationPreferences(JSON.parse(legacy))
        : undefined;
    } catch {
      // Invalid legacy state cannot hide valid new field choices.
    }
    for (const field of Object.keys(PRESENTATION_FIELD_STORAGE_KEYS) as Array<
      keyof typeof PRESENTATION_FIELD_STORAGE_KEYS
    >) {
      const raw = window.localStorage.getItem(
        PRESENTATION_FIELD_STORAGE_KEYS[field]
      );
      if (raw === null) continue;
      // A present field owns its value, even when reset or malformed: never
      // resurrect a superseded legacy choice. Null is an explicit reset.
      preference = applyPresentationUpdate(preference, { field, value: null });
      try {
        preference = applyPresentationUpdate(preference, {
          field,
          value: JSON.parse(raw),
        });
      } catch {
        // Recover only this field; the other field remains independent.
      }
    }
    return preference;
  } catch {
    return undefined;
  }
}

export function createPresentationPreferenceSource(): PresentationPreferenceSource {
  const settings =
    typeof window === 'undefined' ? undefined : window.electron?.settings;
  if (settings) {
    return {
      async load() {
        return parsePresentationPreferences(
          (await settings.get()).presentation
        );
      },
      async update(intent) {
        // A desktop renderer must never silently switch persistence owners.
        if (typeof settings.updatePresentation !== 'function')
          throw new Error('Update Exawatt to change Fleet preferences.');
        return parsePresentationPreferences(
          (await settings.updatePresentation(intent)).presentation
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
    async update(intent) {
      applyPresentationUpdate(undefined, intent); // Validate before any write.
      // One atomic field write needs no cross-tab read/modify/write lock.
      // A tombstone suppresses legacy fallback after an explicit reset.
      window.localStorage.setItem(
        PRESENTATION_FIELD_STORAGE_KEYS[intent.field],
        JSON.stringify(intent.value)
      );
      // A blocked write rejects so Settings can report that it was not saved.
      window.dispatchEvent(new Event(CHANGE_EVENT));
      return readWeb();
    },
    subscribe(handler) {
      const onStorage = (event: StorageEvent) => {
        if (
          event.key === PRESENTATION_STORAGE_KEY ||
          event.key === null ||
          Object.values(PRESENTATION_FIELD_STORAGE_KEYS).some(
            key => key === event.key
          )
        )
          handler(readWeb());
      };
      // Events are invalidations, not snapshots: delayed delivery cannot
      // replace a newer choice with an older event payload.
      const onChange = () => handler(readWeb());
      window.addEventListener('storage', onStorage);
      window.addEventListener(CHANGE_EVENT, onChange);
      return () => {
        window.removeEventListener('storage', onStorage);
        window.removeEventListener(CHANGE_EVENT, onChange);
      };
    },
  };
}
