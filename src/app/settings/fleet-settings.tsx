'use client';

import { useState } from 'react';
import { FLEET_MATERIALS, type FleetView } from '@exawatt/core/desktop-bridge';
import { usePresentation } from '@/components/presentation/presentation-provider';
import { Button } from '@/components/ui/button';
import {
  SettingRow,
  SettingsGroup,
  SettingsSegmentedControl,
} from './settings-controls';

export function FleetSettings() {
  const {
    preference,
    fleetView,
    fleetMaterial,
    ready,
    setFleetView,
    setFleetMaterial,
    resetFleetMaterial,
  } = usePresentation();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const options: { value: FleetView; label: string }[] = [
    { value: 'v1', label: 'v1' },
    { value: 'v2', label: 'v2 (Preview)' },
  ];
  const select = async (save: () => Promise<void>) => {
    setSaving(true);
    setError(null);
    try {
      await save();
    } catch {
      setError('Your Fleet preference could not be saved. Try again.');
    } finally {
      setSaving(false);
    }
  };
  return (
    <SettingsGroup dataAttribute="data-fleet-settings">
      <SettingRow
        topic="fleet-view"
        title="Fleet view"
        description="v2 is a preview of the new Fleet board."
      >
        <SettingsSegmentedControl
          label="Fleet view"
          value={fleetView}
          options={options}
          disabled={!ready || saving}
          onChange={next => void select(() => setFleetView(next))}
        />
      </SettingRow>
      <SettingRow
        topic="fleet-material"
        title="Tile material"
        description="Fleet v2 draws its Agent tiles in this material."
        body={
          <div
            role="group"
            aria-label="Tile material"
            className="grid grid-cols-1 gap-2 pb-2 sm:grid-cols-2 xl:grid-cols-3"
          >
            {FLEET_MATERIALS.map(material => (
              <button
                key={material.id}
                aria-label={material.name}
                data-fleet-material={material.id}
                type="button"
                aria-pressed={fleetMaterial === material.id}
                disabled={!ready || saving}
                onClick={() => void select(() => setFleetMaterial(material.id))}
                className="rounded-lg border px-4 py-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-[var(--settings-teal)] disabled:opacity-50"
                style={{
                  borderColor:
                    fleetMaterial === material.id
                      ? 'var(--settings-teal)'
                      : 'var(--settings-line-strong)',
                  background:
                    fleetMaterial === material.id
                      ? 'var(--settings-teal-wash)'
                      : 'var(--settings-raised)',
                }}
              >
                <span className="block text-sm font-medium text-[var(--settings-text)]">
                  {material.name}
                </span>
                <span className="mt-1 block text-chrome-label leading-5 text-[var(--settings-dim)]">
                  {material.note}
                </span>
              </button>
            ))}
          </div>
        }
      >
        <Button
          type="button"
          size="sm"
          variant="outline"
          data-fleet-material-reset
          disabled={!ready || saving || !preference?.fleetMaterial}
          onClick={() => void select(resetFleetMaterial)}
        >
          Reset material
        </Button>
      </SettingRow>
      {error && (
        <p
          role="alert"
          className="py-3 font-ui text-chrome-label text-[var(--settings-red)]"
        >
          {error}
        </p>
      )}
    </SettingsGroup>
  );
}
