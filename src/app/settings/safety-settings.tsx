'use client';

import { Fragment, useEffect, useState } from 'react';
import {
  SAFETY_CONTROLS,
  isSafetyControlEnabled,
  type SafetyControl,
  type SafetyControlId,
} from '@exawatt/core';
import type {
  DesktopSettingsApi,
  ExawattSettings,
} from '@exawatt/core/desktop-bridge';
import { useLatestRequest } from '@/hooks/use-latest-request';
import { SettingsGroup, SettingRow, SettingSwitch } from './settings-controls';

/**
 * ENG-044 — limits the operator sets on what the agents Exawatt starts may do.
 *
 * Every row is rendered from `SAFETY_CONTROLS`, the same declaration Electron
 * main enforces from, so a control cannot appear here without its enforcement
 * or be enforced without appearing here. Each one is off until turned on.
 */

function ControlFacts({ control }: { control: SafetyControl }) {
  const facts: Array<[string, string]> = [
    ['Applies to', control.appliesTo],
    ['Enforced by', control.enforcedBy],
    ['Takes effect', control.takesEffect],
  ];
  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 pb-3 font-ui text-chrome-meta leading-4">
      {facts.map(([term, value]) => (
        <Fragment key={term}>
          <dt className="text-[var(--settings-faint)]">{term}</dt>
          <dd className="max-w-[68ch] text-[var(--settings-dim)]">{value}</dd>
        </Fragment>
      ))}
    </dl>
  );
}

function useSafetySettings() {
  const [api, setApi] = useState<DesktopSettingsApi | null>(null);
  const [settings, setSettings] = useState<ExawattSettings | null>(null);
  // One channel for reads and writes: a write supersedes the first read, so
  // a slow initial read can never paint over the operator's newer choice.
  const requests = useLatestRequest();

  useEffect(() => {
    const bridge = window.electron?.settings;
    if (!bridge) return;
    setApi(bridge);
    const ticket = requests.begin();
    void bridge.get().then(
      next => {
        if (ticket.current) setSettings(next);
      },
      () => undefined
    );
    const off = bridge.onChanged?.(setSettings);
    return () => {
      requests.invalidate();
      off?.();
    };
  }, [requests]);

  const setControl = async (id: SafetyControlId, enabled: boolean) => {
    if (!api) return;
    const ticket = requests.begin();
    try {
      const next = await api.setSafetyControl(id, enabled);
      if (ticket.current) setSettings(next);
    } catch {
      // A refused write leaves the switch showing the state that is real.
    }
  };

  return { available: api !== null, settings, setControl };
}

export function SafetySettings() {
  const { available, settings, setControl } = useSafetySettings();
  return (
    <section
      aria-labelledby="safety-heading"
      className="min-w-0 bg-[var(--settings-page)] px-4 py-6 sm:px-7 lg:px-9"
    >
      <div className="mx-auto max-w-4xl">
        <div className="mb-7 border-b border-[var(--settings-line)] pb-5">
          <h2
            id="safety-heading"
            className="font-display text-display font-semibold tracking-[-0.02em]"
          >
            Safety
          </h2>
          <p className="mt-1 font-ui text-chrome-title text-[var(--settings-dim)]">
            Limits on what the agents you start in Exawatt may do. Each one is
            off until you turn it on.
          </p>
        </div>

        <SettingsGroup
          title="Agent actions"
          description="Checked before an agent's command runs. A blocked agent is told what it would have hit and what to do instead."
          dataAttribute="data-safety-controls"
        >
          {SAFETY_CONTROLS.map(control => (
            <div key={control.id} data-safety-control={control.id}>
              <SettingRow title={control.label} description={control.purpose}>
                {available ? (
                  <SettingSwitch
                    checked={isSafetyControlEnabled(
                      settings?.safety,
                      control.id
                    )}
                    disabled={settings === null}
                    label={control.label}
                    onChange={next => void setControl(control.id, next)}
                  />
                ) : (
                  <p className="shrink-0 font-ui text-chrome-meta text-[var(--settings-faint)]">
                    In the desktop app
                  </p>
                )}
              </SettingRow>
              <ControlFacts control={control} />
            </div>
          ))}
        </SettingsGroup>
      </div>
    </section>
  );
}
