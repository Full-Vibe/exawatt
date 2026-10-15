'use client';

import { useState } from 'react';
import { FLEET_MATERIALS, type FleetView } from '@exawatt/core/desktop-bridge';
import { usePresentation } from '@/components/presentation/presentation-provider';
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
    { value: 'v2', label: 'v2' },
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
    <SettingsGroup
      title="Fleet"
      description="Choose how Agents appear on the Fleet board."
      dataAttribute="data-fleet-settings"
    >
      <SettingRow
        id="fleet-view"
        title="Fleet view"
        description="Choose the Fleet presentation for this device."
      >
        <SettingsSegmentedControl
          label="Fleet view"
          value={fleetView}
          options={options}
          disabled={!ready || saving}
          onChange={next => void select(() => setFleetView(next))}
        />
      </SettingRow>
      <div
        id="fleet-material"
        tabIndex={-1}
        className="scroll-mt-6 py-4 focus:outline-none"
      >
        <div className="flex items-center justify-between gap-3">
          <h4 className="text-chrome-title font-medium text-[var(--settings-soft)]">
            Tile material
          </h4>
          <button
            type="button"
            disabled={!ready || saving || !preference?.fleetMaterial}
            onClick={() => void select(resetFleetMaterial)}
            className="rounded px-2 py-1 text-chrome-label text-[var(--settings-teal)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--settings-teal)] disabled:opacity-50"
          >
            Reset material
          </button>
        </div>
        <p className="mt-1 mb-4 text-chrome-label leading-5 text-[var(--settings-dim)]">
          Used by Fleet v2. Gummy is the default; your material choice is saved
          separately from the view.
        </p>
        <div
          role="group"
          aria-label="Tile material"
          className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3"
        >
          {FLEET_MATERIALS.map(material => (
            <button
              key={material.id}
              aria-label={material.name}
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
      </div>
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
