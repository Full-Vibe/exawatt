'use client';

import { useState } from 'react';
import type { FleetView } from '@exawatt/core/desktop-bridge';
import { usePresentation } from '@/components/presentation/presentation-provider';
import {
  SettingRow,
  SettingsGroup,
  SettingsSegmentedControl,
} from './settings-controls';

export function FleetSettings() {
  const { fleetView, ready, setFleetView } = usePresentation();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // P5 removes this offer gate after the v2 parity review. Stored choices
  // are deliberately parsed independently of the build that reads them.
  const options: { value: FleetView; label: string }[] = [
    { value: 'v1', label: 'v1' },
  ];
  if (process.env.NODE_ENV === 'development')
    options.push({ value: 'v2', label: 'v2 (Preview)' });
  const select = async (next: FleetView) => {
    setSaving(true);
    setError(null);
    try {
      await setFleetView(next);
    } catch {
      setError('Fleet view could not be saved. Try again.');
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
        title="Fleet view"
        description="Choose the Fleet presentation for this device."
      >
        <SettingsSegmentedControl
          label="Fleet view"
          value={fleetView}
          options={options}
          disabled={!ready || saving}
          onChange={next => void select(next)}
        />
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
