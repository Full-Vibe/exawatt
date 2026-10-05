'use client';

import { Fragment, useCallback, useEffect, useState } from 'react';
import {
  SAFETY_CONTROLS,
  SAFETY_POLICY_PREVIEWS,
  isSafetyControlEnabled,
  type SafetyControl,
  type SafetyControlId,
  type SafetyControlSettings,
} from '@exawatt/core';
import type { DesktopSettingsApi } from '@exawatt/core/desktop-bridge';
import { AnnouncedChip } from '@/components/readiness';
import { Button } from '@/components/ui/button';
import { useLatestRequest } from '@/hooks/use-latest-request';
import { SettingsGroup, SettingRow, SettingSwitch } from './settings-controls';

/**
 * ENG-044 — limits the operator sets on what the agents Exawatt starts may do.
 *
 * Every row with a switch is rendered from `SAFETY_CONTROLS`, the same
 * declaration Electron main enforces from, so a control cannot appear here
 * without its enforcement or be enforced without appearing here. Each one is
 * off until turned on. The policy preview below it renders
 * `SAFETY_POLICY_PREVIEWS`: the shaped next controls, drawn where they will
 * live with the readiness grammar's announced chip in place of a switch. A
 * preview's id is not a `SafetyControlId`, so nothing here can store or send
 * one.
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

/**
 * What the Safety page knows about the operator's choices. `unreadable` is
 * its own state: a read that failed says nothing about whether a control is
 * on, so the page never shows it as off.
 */
type SafetyState =
  | { status: 'loading' }
  | { status: 'ready'; controls: SafetyControlSettings }
  | { status: 'unreadable' };

function useSafetySettings() {
  const [api, setApi] = useState<DesktopSettingsApi | null>(null);
  const [state, setState] = useState<SafetyState>({ status: 'loading' });
  const [saveFailed, setSaveFailed] = useState(false);
  // One channel for reads and writes: a write supersedes the first read, so
  // a slow initial read can never paint over the operator's newer choice.
  const requests = useLatestRequest();

  const load = useCallback(
    (bridge: DesktopSettingsApi) => {
      const ticket = requests.begin();
      void bridge.getSafetyControls().then(
        next => {
          if (ticket.current) setState(next);
        },
        () => {
          if (ticket.current) setState({ status: 'unreadable' });
        }
      );
    },
    [requests]
  );

  useEffect(() => {
    const bridge = window.electron?.settings;
    if (!bridge) return;
    setApi(bridge);
    load(bridge);
    // Any settings write elsewhere re-reads the controls from their source
    // rather than trusting the broadcast copy.
    const off = bridge.onChanged?.(() => load(bridge));
    return () => {
      requests.invalidate();
      off?.();
    };
  }, [load, requests]);

  const setControl = async (id: SafetyControlId, enabled: boolean) => {
    if (!api) return;
    const ticket = requests.begin();
    setSaveFailed(false);
    try {
      const next = await api.setSafetyControl(id, enabled);
      if (ticket.current)
        setState({ status: 'ready', controls: next.safety ?? {} });
    } catch {
      // The switch keeps showing the state that is real; the operator is
      // told the change did not take.
      if (!ticket.current) return;
      setSaveFailed(true);
      // A refused write may mean the file itself became unreadable.
      load(api);
    }
  };

  return {
    available: api !== null,
    state,
    saveFailed,
    setControl,
    retry: () => {
      if (!api) return;
      setState({ status: 'loading' });
      load(api);
    },
  };
}

export function SafetySettings() {
  const { available, state, saveFailed, setControl, retry } =
    useSafetySettings();
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
                {available && state.status === 'unreadable' ? (
                  <div className="flex shrink-0 items-center gap-3">
                    <p
                      role="status"
                      className="font-ui text-chrome-meta text-[var(--settings-dim)]"
                    >
                      Couldn&apos;t load
                    </p>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={retry}
                    >
                      Retry
                    </Button>
                  </div>
                ) : available ? (
                  <SettingSwitch
                    checked={
                      state.status === 'ready' &&
                      isSafetyControlEnabled(state.controls, control.id)
                    }
                    disabled={state.status !== 'ready'}
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
          {saveFailed && (
            <p
              role="alert"
              className="py-3 font-ui text-chrome-label text-[var(--settings-red)]"
            >
              That change didn&apos;t save. Try again.
            </p>
          )}
        </SettingsGroup>

        <SettingsGroup
          title="Policy preview"
          description="Not enforced yet. Each one will be off until you turn it on."
          dataAttribute="data-safety-policy-preview"
        >
          {SAFETY_POLICY_PREVIEWS.map(preview => (
            <div key={preview.id} data-safety-preview={preview.id}>
              <SettingRow title={preview.label} description={preview.purpose}>
                <AnnouncedChip
                  coming="enforcement of this control"
                  className="shrink-0"
                >
                  Off
                </AnnouncedChip>
              </SettingRow>
            </div>
          ))}
        </SettingsGroup>
      </div>
    </section>
  );
}
