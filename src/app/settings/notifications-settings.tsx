'use client';

import { useEffect, useState } from 'react';
import { SettingsGroup, SettingRow, SettingSwitch } from './settings-controls';
import type { ExawattSettings } from '@exawatt/core/desktop-bridge';
import { Button } from '@/components/ui/button';
import { usePermissions } from '@/components/permissions/permissions-provider';

/*
 * Data sharing is not a notification setting (ENG-030 OS1.5). Conversation
 * summaries and goal visuals left this file for Settings → Privacy, where they
 * sit beside the other two outbound behaviors and carry their disclosures.
 */

/**
 * Notification preferences (ENG-016 D6 + D18). Everything here defaults OFF:
 * OS-level signals (native notifications, the dock badge count) are opt-in —
 * an unexplained badge with no in-app way to clear it reads as noise. Only
 * rendered in the Electron app; the settings live in local settings.json.
 */
export function NotificationsSettings() {
  const [settings, setSettings] = useState<ExawattSettings | null>(null);
  const [available, setAvailable] = useState(false);
  const permissions = usePermissions();

  useEffect(() => {
    const api = window.electron?.settings;
    if (!api) return;
    setAvailable(true);
    void api.get().then(setSettings);
    const off = api.onChanged?.(next => setSettings(next));
    return () => off?.();
  }, []);

  if (!available) return null;

  const attention = settings?.notifications?.attention ?? false;
  const dockBadge = settings?.notifications?.dockBadge ?? false;
  const allowed = permissions.stateOf('notifications');
  // The switch is the user's intent; macOS has the final say. When the two
  // disagree the row says so and offers the way forward.
  const blocked =
    attention && (allowed === 'denied' || allowed === 'not-determined');

  return (
    <SettingsGroup
      title="Notifications"
      description="How Exawatt signals outside its own window when an agent needs you. Everything here starts off. Inside the app, tab pulses and the ⌘J attention queue always work."
      dataAttribute="data-notifications-settings"
    >
      <SettingRow
        title="Native macOS notifications"
        description="Post a notification when an agent stops, errors, or asks for input while Exawatt is in the background. Clicking it jumps to the exact Session."
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
        description="Show the number of Sessions waiting for you on the Dock icon, with a bounce when the app is unfocused. It clears as soon as you look at each Session."
      >
        <SettingSwitch
          checked={dockBadge}
          label="Dock badge count"
          onChange={next => void window.electron?.settings?.setDockBadge(next)}
        />
      </SettingRow>
    </SettingsGroup>
  );
}

/**
 * Why macOS asks for folder access (ENG-016 D18). Agent processes run as
 * children of Exawatt, so their file access is attributed to Exawatt by
 * macOS privacy protection. This card makes the system prompts explicable
 * instead of mysterious. Electron-only, static copy.
 */
export function PermissionsExplainer() {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    setAvailable(!!window.electron?.isElectron);
  }, []);
  if (!available) return null;

  return (
    <SettingsGroup
      title="macOS permission prompts"
      description="What the system dialogs mean and why they name Exawatt."
      dataAttribute="data-permissions-explainer"
    >
      <SettingRow
        title="Files and folders"
        description="Agents run as part of Exawatt, so macOS names Exawatt when work enters Desktop, Documents, Downloads, or an external drive. Allowing access lets Agents work there; denying it produces permission errors. Grants stay with the app’s signed identity across updates. Review them in System Settings → Privacy & Security → Files and Folders."
      />
    </SettingsGroup>
  );
}
