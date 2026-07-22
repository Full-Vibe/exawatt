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
      className="grid h-11 w-11 shrink-0 cursor-pointer place-items-center rounded-md focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
    >
      <span
        aria-hidden="true"
        className={`relative h-5 w-9 rounded-full border transition-colors ${
          checked ? 'border-primary bg-primary' : 'border-input bg-muted'
        }`}
      >
        <span
          className={`absolute top-[2px] h-3.5 w-3.5 rounded-full bg-background transition-transform ${
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
    <Card className="mb-6" data-conversation-privacy-settings>
      <CardHeader>
        <CardTitle>Conversation labels</CardTitle>
        <CardDescription>
          Control optional hosted labels in the Project conversation browser.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-5">
          <div>
            <p className="text-sm">Automatic hosted summaries</p>
            <p className="text-xs leading-5 text-muted-foreground">
              Send up to eight bounded excerpts to Exawatt’s hosted Anthropic
              model for short titles. Common credential patterns are redacted
              first, and full transcripts stay local. Turn this off to stop
              future hosted requests; provider titles, local prompt text, and
              already-cached labels still work.
            </p>
          </div>
          <SettingSwitch
            checked={hosted}
            label="Automatic hosted conversation summaries"
            onChange={next =>
              void window.electron?.settings?.setHostedConversationSummaries(
                next
              )
            }
          />
        </div>
      </CardContent>
    </Card>
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
          Everything here is off by default — inside the app, tab pulses and the
          ⌘J attention queue always work.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          <div>
            <p className="text-sm">Native macOS notifications</p>
            <p className="text-xs text-muted-foreground">
              Post a notification when an agent stops, errors, or asks for input
              while Exawatt is in the background. Clicking it jumps to the exact
              session.
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
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          <div>
            <p className="text-sm">Dock badge count</p>
            <p className="text-xs text-muted-foreground">
              Show the number of sessions waiting for you on the Dock icon (with
              a bounce when the app is unfocused). Clears as soon as you look at
              each session.
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
          Grants stick to the app&apos;s signed identity, which is stable across
          updates — you should not be re-asked for the same category again.
          Review or revoke grants any time in System Settings → Privacy &amp;
          Security → Files and Folders.
        </p>
      </CardContent>
    </Card>
  );
}
