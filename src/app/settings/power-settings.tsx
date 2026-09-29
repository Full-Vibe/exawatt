'use client';

import { useEffect, useState } from 'react';
import { useLatestRequest } from '@/hooks/use-latest-request';
import type {
  DeviceKeepAwakePolicy,
  DevicePowerStatus,
} from '@exawatt/core/desktop-bridge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SettingsGroup, SettingRow } from './settings-controls';

/** This control reports Exawatt's own assertion. It never paints a global
 * “safe to sleep” success state: sources and other apps retain their authority. */
export function PowerSettings() {
  const reads = useLatestRequest();
  const writes = useLatestRequest();
  const [status, setStatus] = useState<DevicePowerStatus | null>(null);
  const [available, setAvailable] = useState(false);
  const [saving, setSaving] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const api = window.electron?.app;
    if (!api?.devicePower) return;
    setAvailable(true);
    const ticket = reads.begin();
    let revision = -1;
    const receive = (next: DevicePowerStatus) => {
      if (!ticket.current || next.revision < revision) return;
      revision = next.revision;
      setStatus(next);
      setReadError(null);
    };
    const off = api.onDevicePowerChanged(receive);
    void api
      .devicePower()
      .then(receive)
      .catch(() => {
        if (ticket.current && revision < 0)
          setReadError('Power status is unavailable. Try reopening Settings.');
      });
    return () => {
      reads.invalidate();
      off();
    };
  }, [reads]);
  if (!available) return null;
  const save = async (value: string) => {
    if (value !== 'never' && value !== 'ac-only' && value !== 'ac-and-battery')
      return;
    const ticket = writes.begin();
    setSaving(true);
    setError(null);
    try {
      await window.electron!.settings.setKeepAwake(
        value as DeviceKeepAwakePolicy
      );
    } catch {
      if (!ticket.current) return;
      setError(
        'The power preference could not be saved. Your previous choice still applies.'
      );
    } finally {
      if (ticket.current) setSaving(false);
    }
  };
  return (
    <SettingsGroup
      title="Power"
      description="Keep this Mac awake while supported local Agents work. The display can turn off, and locking never pauses an Agent. This preference belongs to this device."
      dataAttribute="data-power-settings"
    >
      <SettingRow
        title="Exawatt sleep prevention"
        description="On AC only releases Exawatt’s sleep prevention when you unplug. On AC and battery can use substantial battery power during unattended work."
      >
        <Select
          value={status?.policy ?? 'ac-only'}
          onValueChange={value => void save(value)}
          disabled={!status || saving}
        >
          <SelectTrigger
            aria-label="Exawatt sleep prevention"
            className="w-full min-w-44 sm:w-auto"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="never">Never</SelectItem>
            <SelectItem value="ac-only">On AC only</SelectItem>
            <SelectItem value="ac-and-battery">On AC and battery</SelectItem>
          </SelectContent>
        </Select>
      </SettingRow>
      <div className="space-y-2 py-4 font-ui text-sm leading-5 text-[var(--settings-dim)]">
        <p role="status">
          {!status
            ? 'Reading power status…'
            : (status.error ??
              (status.assertion === 'active'
                ? `Exawatt is keeping this Mac awake for ${status.supportedWorkingSessions} working ${status.supportedWorkingSessions === 1 ? 'Session' : 'Sessions'}.`
                : 'Exawatt is not keeping this Mac awake.'))}
        </p>
        <p>
          Applies to supported Codex launches started by this app. Existing
          Sessions and other sources manage their own sleep behavior; Claude
          Code can still keep this Mac awake on battery.
        </p>
        <p>
          Agent settings changed inside a source, and other apps, can override
          sleep independently. Never disables Exawatt’s sleep prevention; it
          does not pause or stop work. When macOS sleeps, local work depends on
          the source’s recovery behavior.
        </p>
        {status?.independentSources.length ? (
          <p>
            Working sources outside this control:{' '}
            {status.independentSources.join(', ')}.
          </p>
        ) : null}
        {(error || readError) && <p role="alert">{error || readError}</p>}
      </div>
    </SettingsGroup>
  );
}
