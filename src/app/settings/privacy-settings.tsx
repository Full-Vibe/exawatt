'use client';

import { Fragment, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { readAnalyticsOptOut, setAnalyticsOptOut } from '@/lib/analytics';
import {
  HOSTED_FEATURE_IDS,
  OUTBOUND_CONTROLS,
  isHostedFeatureEnabled,
  type HostedFeatureId,
  type HostedFeaturePreferences,
  type OutboundControl,
} from '@/lib/hosted-features/contract';
import { useGoalVisualPreference } from '@/components/goal-visuals/goal-visual-preference-provider';
import type { ElectronSettingsApi, ExawattSettings } from '@/types/electron';
import { SettingsGroup, SettingRow, SettingSwitch } from './settings-controls';

/**
 * ENG-030 OS1.5 — the one place that says what Exawatt sends.
 *
 * Every row on this surface is rendered from `OUTBOUND_CONTROLS`. Nothing here
 * retypes a disclosure sentence: adding an outbound behavior to the contract is
 * what puts it on this screen, so a control cannot exist without its sentence
 * and a sentence cannot exist without its control.
 *
 * Decision `0031` keeps analytics and hosted features in separate groups on
 * purpose — consent for one is not consent for the other.
 */

/** Context labels and conversation summaries only run in the desktop app, so
 *  their switches follow the settled convention for desktop-only rows: absent
 *  in a browser rather than present and dead (`NotificationsSettings`,
 *  `PermissionsExplainer`). Goal visuals and analytics run in both. */
const DESKTOP_ONLY: Record<HostedFeatureId, boolean> = {
  contextLabels: true,
  conversationSummaries: true,
  goalVisuals: false,
};

function OutboundDisclosure({ control }: { control: OutboundControl }) {
  const facts: Array<[string, string]> = [
    ['Sends', control.sends],
    ['Goes to', control.destination],
    ['Turned off', control.cost],
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

function OutboundControlRow({
  control,
  checked,
  disabled = false,
  onChange,
}: {
  control: OutboundControl;
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div data-outbound-control={control.id}>
      <SettingRow title={control.label} description={control.purpose}>
        <SettingSwitch
          checked={checked}
          disabled={disabled}
          label={control.label}
          onChange={onChange}
        />
      </SettingRow>
      <OutboundDisclosure control={control} />
    </div>
  );
}

/** Local settings, read once and kept current. No network, so this resolves
 *  offline and signed out (ENG-016 D18). */
function useHostedFeatureSettings() {
  const [api, setApi] = useState<ElectronSettingsApi | null>(null);
  const [settings, setSettings] = useState<ExawattSettings | null>(null);

  useEffect(() => {
    const bridge = window.electron?.settings;
    if (!bridge) return;
    setApi(bridge);
    let active = true;
    void bridge.get().then(
      next => {
        if (active) setSettings(next);
      },
      () => undefined
    );
    const off = bridge.onChanged?.(next => {
      if (active) setSettings(next);
    });
    return () => {
      active = false;
      off?.();
    };
  }, []);

  const setHosted = useCallback(
    async (id: HostedFeatureId, enabled: boolean) => {
      if (!api) return;
      const save =
        id === 'contextLabels'
          ? api.setHostedContextLabels
          : api.setHostedConversationSummaries;
      try {
        setSettings(await save(enabled));
      } catch {
        // A refused write leaves the switch showing the state that is real.
      }
    },
    [api]
  );

  return { available: api !== null, settings, setHosted };
}

export function PrivacySettings() {
  const { available, settings, setHosted } = useHostedFeatureSettings();
  const goalVisuals = useGoalVisualPreference();
  const [analyticsEnabled, setAnalyticsEnabled] = useState(
    OUTBOUND_CONTROLS.productAnalytics.defaultEnabled
  );

  useEffect(() => {
    setAnalyticsEnabled(!readAnalyticsOptOut());
  }, []);

  // Absent keys mean default, never off — `isHostedFeatureEnabled` owns that.
  const preferences: HostedFeaturePreferences | null = settings;

  return (
    <section
      aria-labelledby="privacy-heading"
      className="min-w-0 bg-[var(--settings-page)] px-4 py-6 sm:px-7 lg:px-9"
    >
      <div className="mx-auto max-w-4xl">
        <div className="mb-7 border-b border-[var(--settings-line)] pb-5">
          <h2
            id="privacy-heading"
            className="font-display text-display font-semibold tracking-[-0.02em]"
          >
            Privacy
          </h2>
          <p className="mt-1 font-ui text-chrome-title text-[var(--settings-dim)]">
            Everything Exawatt sends from this device, and the switch for each
            one.
          </p>
        </div>

        <SettingsGroup
          title="Hosted features"
          description="Work Exawatt does for you off this device. Each one is on by default and switches on its own."
          dataAttribute="data-hosted-feature-settings"
        >
          {HOSTED_FEATURE_IDS.filter(id => available || !DESKTOP_ONLY[id]).map(
            id =>
              id === 'goalVisuals' ? (
                <OutboundControlRow
                  key={id}
                  control={OUTBOUND_CONTROLS[id]}
                  checked={goalVisuals.enabled}
                  disabled={!goalVisuals.ready}
                  onChange={next => void goalVisuals.setEnabled(next)}
                />
              ) : (
                <OutboundControlRow
                  key={id}
                  control={OUTBOUND_CONTROLS[id]}
                  checked={isHostedFeatureEnabled(preferences, id)}
                  onChange={next => void setHosted(id, next)}
                />
              )
          )}
        </SettingsGroup>

        <SettingsGroup
          title="Analytics"
          description="Kept separate from your account and from hosted features. Turning it back on takes effect the next time Exawatt starts."
          dataAttribute="data-analytics-settings"
        >
          <OutboundControlRow
            control={OUTBOUND_CONTROLS.productAnalytics}
            checked={analyticsEnabled}
            onChange={next => {
              setAnalyticsOptOut(!next);
              setAnalyticsEnabled(!readAnalyticsOptOut());
            }}
          />
        </SettingsGroup>

        <p className="font-ui text-chrome-label text-[var(--settings-dim)]">
          <Link
            href="/privacy"
            className="rounded underline underline-offset-2 outline-none transition-colors hover:text-[var(--settings-text)] focus-visible:ring-2 focus-visible:ring-[var(--settings-teal)]"
          >
            Privacy policy
          </Link>
        </p>
      </div>
    </section>
  );
}
