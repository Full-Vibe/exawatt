'use client';
import { useCallback } from 'react';
import { SessionModelControl } from './session-model-control';
import type { SessionTab } from './use-workspace-state';
import type { SessionModelChange } from '@exawatt/core/desktop-bridge';

export function LiveSessionModelControl({
  tab,
  busy,
  change,
}: {
  tab: SessionTab;
  busy: boolean;
  change: (id: string, choice: SessionModelChange) => Promise<void>;
}) {
  const loadCatalog = useCallback(async () => {
    const api = window.electron?.pty;
    if (!api || tab.harness === 'shell')
      throw new Error('Model catalog unavailable.');
    return api.listAgentModels(tab.harness, tab.cwd);
  }, [tab.harness, tab.cwd]);
  const apply = useCallback(
    (choice: SessionModelChange) => change(tab.id, choice),
    [change, tab.id]
  );
  const supported = tab.harness === 'claude' || tab.harness === 'codex';
  return (
    <SessionModelControl
      loadCatalog={loadCatalog}
      apply={apply}
      initialModel={tab.launchModel}
      initialEffort={tab.launchEffort}
      unavailableReason={
        !supported
          ? 'Change the model inside this Agent Source.'
          : !tab.sessionId
            ? 'Resume this Session to change its model.'
            : !tab.harnessSessionId
              ? 'Waiting for a saved conversation.'
              : busy
                ? 'Available after the Agent and its delegated work finish.'
                : undefined
      }
    />
  );
}
