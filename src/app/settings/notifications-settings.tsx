'use client';

import { useEffect, useState } from 'react';
import type { ExawattSettings } from '@/types/electron';

function SettingsGroup({
  title,
  description,
  children,
  dataAttribute,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
  dataAttribute: string;
}) {
  return (
    <section
      className="mb-6 overflow-hidden rounded-lg border border-[var(--settings-line)] bg-[var(--settings-panel)]"
      {...{ [dataAttribute]: '' }}
    >
      <header className="border-b border-[var(--settings-line)] px-5 py-4">
        <h3 className="font-display text-[15px] font-semibold text-[var(--settings-text)]">
          {title}
        </h3>
        <p className="mt-1 max-w-[72ch] font-ui text-[12px] leading-5 text-[var(--settings-dim)]">
          {description}
        </p>
      </header>
      <div className="divide-y divide-[var(--settings-line)] px-5">
        {children}
      </div>
    </section>
  );
}

function SettingRow({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-[76px] items-center justify-between gap-5 py-3 max-[520px]:items-start">
      <div>
        <p className="font-ui text-[13px] font-medium text-[var(--settings-soft)]">
          {title}
        </p>
        <p className="mt-0.5 max-w-[68ch] font-ui text-[12px] leading-5 text-[var(--settings-dim)]">
          {description}
        </p>
      </div>
      {children}
    </div>
  );
}

function SettingSwitch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className="grid h-11 w-11 shrink-0 cursor-pointer place-items-center rounded-md focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
    >
      <span
        aria-hidden="true"
        className="relative h-5 w-9 rounded-full border transition-colors"
        style={{
          borderColor: checked
            ? 'var(--settings-teal)'
            : 'var(--settings-line-strong)',
          background: checked
            ? 'var(--settings-teal)'
            : 'var(--settings-raised)',
        }}
      >
        <span
          className={`absolute top-[2px] h-3.5 w-3.5 rounded-full bg-[var(--settings-shell)] transition-transform ${
            checked ? 'translate-x-[17px]' : 'translate-x-[2px]'
          }`}
        />
      </span>
    </button>
  );
}

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
