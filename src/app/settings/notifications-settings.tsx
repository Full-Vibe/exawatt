'use client';

import { useEffect, useState } from 'react';
import {
  DesktopOnlyNote,
  SettingsGroup,
  SettingRow,
  SettingSwitch,
} from './settings-controls';
import type { ExawattSettings } from '@exawatt/core/desktop-bridge';
import { Button } from '@/components/ui/button';
import { usePermissions } from '@/components/permissions/permissions-provider';
import { OptionMenu } from '@/components/ui/option-menu';
import { USAGE_ALERT_POLICY } from '@exawatt/core';

/** The second alert's lead time, as Settings names each choice. */
const LEAD_OPTIONS = USAGE_ALERT_POLICY.leadMinuteChoices.map(minutes => ({
  id: minutes === null ? 'off' : String(minutes),
  label:
    minutes === null
      ? 'No second alert'
      : minutes < 60
        ? `${minutes} minutes before`
        : minutes === 60
          ? '1 hour before'
          : `${minutes / 60} hours before`,
}));

/*
 * Data sharing is not a notification setting (ENG-030 OS1.5). Conversation
 * summaries and goal visuals left this file for Settings → Privacy, where they
 * sit beside the other two outbound behaviors and carry their disclosures.
 */

/**
 * Notification preferences (ENG-016 D6 + D18). Agent signals default OFF:
 * OS-level signals (native notifications, the dock badge count) are opt-in —
 * an unexplained badge with no in-app way to clear it reads as noise. Usage
 * alerts default on. Only the Electron app has these controls; the settings
 * live in local settings.json.
 */
export function NotificationsSettings() {
  const [settings, setSettings] = useState<ExawattSettings | null>(null);
  // null until mounted, so a browser and the app agree on the first paint.
  const [available, setAvailable] = useState<boolean | null>(null);
  const permissions = usePermissions();

  useEffect(() => {
    const api = window.electron?.settings;
    setAvailable(Boolean(api));
    if (!api) return;
    void api.get().then(setSettings);
    const off = api.onChanged?.(next => setSettings(next));
    return () => off?.();
  }, []);

  if (available === null) return null;
  if (!available)
    return (
      <DesktopOnlyNote>
        Notifications are available in the desktop app.
      </DesktopOnlyNote>
    );

  const attention = settings?.notifications?.attention ?? false;
  const dockBadge = settings?.notifications?.dockBadge ?? false;
  // Absent means ON with the policy's default lead (ENG-008 E17).
  const usageAlerts = settings?.notifications?.usageAlerts !== false;
  const lead =
    settings?.notifications?.usageAlertLeadMinutes === undefined
      ? USAGE_ALERT_POLICY.defaultLeadMinutes
      : settings.notifications.usageAlertLeadMinutes;
  const allowed = permissions.stateOf('notifications');
  // The switch is the user's intent; macOS has the final say. When the two
  // disagree the row says so and offers the way forward.
  const blocked =
    attention && (allowed === 'denied' || allowed === 'not-determined');

  return (
    <SettingsGroup dataAttribute="data-notifications-settings">
      <SettingRow
        title="Native macOS notifications"
        description="Notify you when an Agent stops, errors or asks for input while Exawatt is in the background. Click one to open that Session."
      >
        <SettingSwitch
          checked={attention}
          label="Native macOS notifications"
          onChange={next => {
            const settingsApi = window.electron?.settings;
            if (!next) {
              void settingsApi?.setAttentionNotifications(false);
              return;
            }
            // Turning it on is a moment of need: the registry primes the
            // system prompt first, and the switch follows the answer.
            void permissions
              .ensure(
                'notifications',
                'Turning this on lets Exawatt tell you when an agent needs you.'
              )
              .then(granted => {
                if (granted) void settingsApi?.setAttentionNotifications(true);
              });
          }}
        />
      </SettingRow>
      {blocked && (
        <div
          data-notifications-blocked
          className="flex items-center justify-between gap-4 py-3 max-[520px]:flex-col max-[520px]:items-stretch"
        >
          <p className="font-ui text-chrome-label leading-5 text-[var(--settings-dim)]">
            {allowed === 'denied'
              ? 'Notifications are off for Exawatt in macOS.'
              : 'Allow them for Exawatt in macOS and they start appearing.'}
          </p>
          {allowed === 'denied' ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => permissions.openSettings('notifications')}
            >
              Open System Settings
            </Button>
          ) : (
            <Button
              type="button"
              size="sm"
              onClick={() =>
                void permissions.ensure(
                  'notifications',
                  'Exawatt can tell you when an agent needs you.'
                )
              }
            >
              Allow
            </Button>
          )}
        </div>
      )}
      <SettingRow
        title="Dock badge count"
        description="Show how many Sessions are waiting on the Dock icon, and bounce it while Exawatt is in the background."
      >
        <SettingSwitch
          checked={dockBadge}
          label="Dock badge count"
          onChange={next => void window.electron?.settings?.setDockBadge(next)}
        />
      </SettingRow>
      <SettingRow
        title="Usage alerts"
        description="Notify you once when a plan limit is on course to run out before it resets."
      >
        <SettingSwitch
          checked={usageAlerts}
          label="Usage alerts"
          onChange={next => {
            const settingsApi = window.electron?.settings;
            if (!next) {
              void settingsApi?.setUsageAlerts(false);
              return;
            }
            void permissions
              .ensure(
                'notifications',
                'Turning this on lets Exawatt tell you when a plan limit is about to run out.'
              )
              .then(granted => {
                if (granted) void settingsApi?.setUsageAlerts(true);
              });
          }}
        />
      </SettingRow>
      <SettingRow
        title="Second usage alert"
        description="Alert again shortly before a limit runs out at the current pace."
      >
        <OptionMenu
          label="Second usage alert"
          options={LEAD_OPTIONS}
          value={lead === null ? 'off' : String(lead)}
          disabled={!usageAlerts}
          onValueChange={id =>
            void window.electron?.settings?.setUsageAlertLead(
              id === 'off' ? null : Number(id)
            )
          }
        />
      </SettingRow>
    </SettingsGroup>
  );
}
