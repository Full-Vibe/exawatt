'use client';

import { useEffect, useState } from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import type { ExawattSettings } from '@/types/electron';

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
      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ${
        checked ? 'border-primary bg-primary' : 'border-input bg-muted'
      }`}
    >
      <span
        className={`inline-block h-3.5 w-3.5 transform rounded-full bg-background transition-transform ${
          checked ? 'translate-x-[18px]' : 'translate-x-[3px]'
        }`}
      />
    </button>
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
    <Card className="mb-6" data-notifications-settings>
      <CardHeader>
        <CardTitle>Notifications</CardTitle>
        <CardDescription>
          How Exawatt signals outside its own window when an agent needs you.
          Everything here is off by default — inside the app, tab pulses and
          the ⌘J attention queue always work.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm">Native macOS notifications</p>
            <p className="text-xs text-muted-foreground">
              Post a notification when an agent stops, errors, or asks for
              input while Exawatt is in the background. Clicking it jumps to
              the exact session.
            </p>
          </div>
          <SettingSwitch
            checked={attention}
            label="Native macOS notifications"
            onChange={next =>
              void window.electron?.settings?.setAttentionNotifications(next)
            }
          />
        </div>
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm">Dock badge count</p>
            <p className="text-xs text-muted-foreground">
              Show the number of sessions waiting for you on the Dock icon
              (with a bounce when the app is unfocused). Clears as soon as you
              look at each session.
            </p>
          </div>
          <SettingSwitch
            checked={dockBadge}
            label="Dock badge count"
            onChange={next =>
              void window.electron?.settings?.setDockBadge(next)
            }
          />
        </div>
      </CardContent>
    </Card>
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
    <Card className="mb-6" data-permissions-explainer>
      <CardHeader>
        <CardTitle>macOS permission prompts</CardTitle>
        <CardDescription>
          What the system dialogs mean and why they name Exawatt.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-xs text-muted-foreground">
        <p>
          Agents you launch run as part of Exawatt, so when one works in a
          protected location — Desktop, Documents, Downloads, or an external
          drive — macOS asks once whether Exawatt may access that folder
          category. Allowing it is what lets your agents read and write those
          projects; denying it makes agent work there fail with permission
          errors.
        </p>
        <p>
          Grants stick to the app&apos;s signed identity, which is stable
          across updates — you should not be re-asked for the same category
          again. Review or revoke grants any time in System Settings →
          Privacy &amp; Security → Files and Folders.
        </p>
      </CardContent>
    </Card>
  );
}
