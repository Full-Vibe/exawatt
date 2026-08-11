'use client';

/**
 * Live per-Session burn for the Team exposé tiles (ENG-008 E5, closing E7's
 * live half). Joins each workspace tab's captured provider identity
 * (`harnessSessionId`) to the live corpus's per-session rollups and
 * normalizes through the ONE shared burn derivation (`computeAgentBurn`) —
 * the same seam the Demo shell feeds from `demoAgentBurn`. A tab whose
 * Session reports no samples in the window stays absent from the result:
 * unreported is absent, never zero, so its tile renders no readout at all.
 */
import { useMemo, useSyncExternalStore } from 'react';
import { computeAgentBurn } from '@exawatt/ui-model';
import type { SessionConsumptionReadout } from '@/components/workspace/session-overview-card';
import {
  getLiveConsumption,
  getServerLiveConsumption,
  subscribeLiveConsumption,
} from './live-store';

interface TabRef {
  id: string;
  harnessSessionId: string | null;
}

interface ProjectRef {
  tabs: readonly TabRef[];
}

export function useLiveConsumptionByTab(
  projects: readonly ProjectRef[]
): Record<string, SessionConsumptionReadout> {
  const state = useSyncExternalStore(
    subscribeLiveConsumption,
    getLiveConsumption,
    getServerLiveConsumption
  );
  return useMemo(() => {
    if (state.status !== 'ready' || state.burnByProviderId.size === 0) {
      return {};
    }
    const inputs = projects.flatMap(project =>
      project.tabs.flatMap(tab => {
        const burn = tab.harnessSessionId
          ? state.burnByProviderId.get(tab.harnessSessionId)
          : undefined;
        return burn
          ? [
              {
                id: tab.id,
                rawTokens: burn.rawTokens,
                normalizedTokens: burn.normalizedTokens,
              },
            ]
          : [];
      })
    );
    if (inputs.length === 0) return {};
    const view = computeAgentBurn(inputs);
    const out: Record<string, SessionConsumptionReadout> = {};
    for (const [id, entry] of view.byAgent) {
      out[id] = {
        rawTokens: entry.rawTokens,
        share: entry.share,
        intensity: entry.intensity,
      };
    }
    return out;
  }, [state, projects]);
}
