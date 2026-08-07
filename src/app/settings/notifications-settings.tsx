'use client';

import { useEffect, useState } from 'react';
import type { ExawattSettings } from '@/types/electron';
import { SettingsGroup, SettingRow, SettingSwitch } from './settings-controls';

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

  return (
    <SettingsGroup
      title="Notifications"
      description="How Exawatt signals outside its own window when an agent needs you. Everything here is off by default — inside the app, tab pulses and the ⌘J attention queue always work."
      dataAttribute="data-notifications-settings"
    >
      <SettingRow
        title="Native macOS notifications"
        description="Post a notification when an agent stops, errors, or asks for input while Exawatt is in the background. Clicking it jumps to the exact Session."
      >
        <SettingSwitch
          checked={attention}
          label="Native macOS notifications"
          onChange={next =>
            void window.electron?.settings?.setAttentionNotifications(next)
          }
        />
      </SettingRow>
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
