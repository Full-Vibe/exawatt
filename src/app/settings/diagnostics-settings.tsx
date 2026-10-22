'use client';

import { useCallback, useEffect, useState } from 'react';
import { createOptionalClient } from '@/lib/supabase/client';
import { resolvedDistribution } from '@/lib/distribution/resolved';
import { Button } from '@/components/ui/button';
import { SettingRow, SettingsGroup } from './settings-controls';

/**
 * ENG-025 F5 — the diagnostics report's visible home.
 *
 * ⌘⇧F carries the same bundle on a bug report, but it is a no-op signed out,
 * and a machine whose install or update is broken is disproportionately
 * signed out. This path needs no account and no network: it writes the file
 * and puts a Finder window in front of it, which is the whole support loop.
 *
 * Desktop-only, following the settled convention on this surface: absent in a
 * browser rather than present and dead.
 */
export function DiagnosticsSettings() {
  const [available, setAvailable] = useState(false);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  useEffect(() => {
    setAvailable(Boolean(window.electron?.app?.saveDiagnosticsReport));
  }, []);

  const save = useCallback(async () => {
    setSaving(true);
    setResult(null);
    try {
      // Self-reported into a self-reported bundle. A failure to read the
      // session reports signed out rather than blocking the save: the whole
      // point of this path is that it works when other things do not.
      let signedIn = false;
      try {
        const supabase = createOptionalClient(resolvedDistribution());
        if (supabase) {
          const { data } = await supabase.auth.getSession();
          signedIn = Boolean(data.session);
        }
      } catch {
        signedIn = false;
      }
      const outcome =
        await window.electron?.app?.saveDiagnosticsReport?.(signedIn);
      setResult(
        outcome?.ok
          ? 'Saved to Downloads and revealed in Finder.'
          : 'Could not write the report.'
      );
    } catch {
      setResult('Could not write the report.');
    } finally {
      setSaving(false);
    }
  }, []);

  if (!available) return null;

  return (
    <SettingsGroup
      title="Diagnostics"
      description="Machine state you can hand to support. Nothing is sent from here."
      dataAttribute="data-diagnostics-settings"
    >
      <SettingRow
        title="Save a diagnostic report"
        description="Writes your build, update state and recent app logs to a file in Downloads. It holds no Session text, prompts, Project names or file contents. Works signed out."
      >
        <div className="flex flex-col items-end gap-1.5">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void save()}
            disabled={saving}
          >
            {saving ? 'Saving…' : 'Save report'}
          </Button>
          <p
            aria-live="polite"
            className="font-ui text-chrome-meta text-[var(--settings-faint)]"
          >
            {result ?? ' '}
          </p>
        </div>
      </SettingRow>
    </SettingsGroup>
  );
}
