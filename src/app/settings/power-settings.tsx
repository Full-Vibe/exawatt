'use client';

import { useEffect, useState } from 'react';
import { AGENT_SOURCE_DECLARATIONS } from '@/generated/agent-source-declarations';
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
import {
  DesktopOnlyNote,
  SettingsGroup,
  SettingRow,
} from './settings-controls';

/** This control reports Exawatt's own assertion. It never paints a global
 * “safe to sleep” success state: sources and other apps retain their authority. */
export function PowerSettings() {
  const reads = useLatestRequest();
  const writes = useLatestRequest();
  const [status, setStatus] = useState<DevicePowerStatus | null>(null);
  // null until mounted, so a browser and the app agree on the first paint.
  const [available, setAvailable] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const api = window.electron?.app;
    setAvailable(Boolean(api?.devicePower));
    if (!api?.devicePower) return;
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
  if (available === null) return null;
  if (!available)
    return (
      <DesktopOnlyNote>
        Sleep prevention is available in the desktop app.
      </DesktopOnlyNote>
    );
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
    <SettingsGroup dataAttribute="data-power-settings">
      <SettingRow
        title="Exawatt sleep prevention"
        description="On AC only lets this Mac sleep when you unplug. On AC and battery can drain the battery during long unattended work."
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
          Covers Codex Agents started in Exawatt. Other sources decide for
          themselves; Claude Code can keep this Mac awake even on battery.
        </p>
        {status?.independentSources.length ? (
          <p>
            Working sources outside this control:{' '}
            {status.independentSources
              .map(
                id =>
                  AGENT_SOURCE_DECLARATIONS.find(
                    source => source.adapterId === id
                  )?.label ?? id
              )
              .join(', ')}
            .
          </p>
        ) : null}
        {(error || readError) && <p role="alert">{error || readError}</p>}
      </div>
    </SettingsGroup>
  );
}
