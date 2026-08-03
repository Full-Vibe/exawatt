'use client';

import { useEffect, useState } from 'react';
import type { ExawattSettings } from '@/types/electron';
import { SettingsGroup, SettingRow, SettingSwitch } from './settings-controls';

/** Hosted labeling is automatic by default, but never invisible: Settings
 * names the processor, the bounded/redacted payload, and the local-only
 * fallback. Turning it off is enforced again in Electron main. */
export function ConversationPrivacySettings() {
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
  const hosted = settings?.conversationSummaries?.hosted !== false;

  return (
    <SettingsGroup
      title="Conversation labels"
      description="Control optional hosted labels in the Project conversation browser."
      dataAttribute="data-conversation-privacy-settings"
    >
      <SettingRow
        title="Automatic hosted summaries"
        description="Send up to eight bounded excerpts to Exawatt’s hosted Anthropic model for short titles. Common credential patterns are redacted first, and full transcripts stay local. Turn this off to stop future hosted requests; provider titles, local prompt text, and already-cached labels still work."
      >
        <SettingSwitch
          checked={hosted}
          label="Automatic hosted conversation summaries"
          onChange={next =>
            void window.electron?.settings?.setHostedConversationSummaries(next)
          }
        />
      </SettingRow>
    </SettingsGroup>
  );
}

export function GoalVisualSettings() {
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
  const enabled = settings?.goalVisuals?.enabled !== false;

  return (
    <SettingsGroup
      title="Team visuals"
      description="Visual identity for Agent goals in Team view."
      dataAttribute="data-goal-visual-settings"
    >
      <SettingRow
        title="Goal backgrounds"
        description="Show quiet generated imagery behind Agent tiles. Turning this off hides cached visuals and stops new image requests."
      >
        <SettingSwitch
          checked={enabled}
          label="Goal backgrounds"
          onChange={next =>
            void window.electron?.settings?.setGoalVisualsEnabled(next)
          }
        />
      </SettingRow>
    </SettingsGroup>
  );
}

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
