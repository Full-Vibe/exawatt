'use client';

import { useState } from 'react';
import { FLEET_MATERIALS, type FleetView } from '@exawatt/core/desktop-bridge';
import { usePresentation } from '@/components/presentation/presentation-provider';
import { Button } from '@/components/ui/button';
import { ChoiceGroup } from '@/components/ui/choice-group';
import { SettingRow, SettingsGroup } from './settings-controls';

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
        <ChoiceGroup
          label="Fleet view"
          value={fleetView}
          options={options}
          optionAttribute="data-settings-option"
          disabled={!ready || saving}
          onChange={next => void select(() => setFleetView(next))}
          className="font-ui text-chrome-label"
        />
      </SettingRow>
      <SettingRow
        topic="fleet-material"
        title="Tile material"
        description="Fleet v2 draws its Agent tiles in this material."
        body={
          <ChoiceGroup
            label="Tile material"
            layout="cards"
            value={fleetMaterial}
            options={FLEET_MATERIALS.map(material => ({
              value: material.id,
              label: material.name,
              description: material.note,
              accessibleLabel: material.name,
            }))}
            optionAttribute="data-fleet-material"
            disabled={!ready || saving}
            onChange={next => void select(() => setFleetMaterial(next))}
            className="pb-2 font-ui"
          />
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
