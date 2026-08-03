'use client';

/**
 * THE tenant-aware consumption seam (ENG-008 review fixes, 2026-08-03).
 *
 * Every consumption consumer — the ambient chrome meter, `/usage`, and any
 * future carrier — reads the corpus through this one hook, so the title bar
 * and the page are structurally incapable of disagreeing about which tenant's
 * numbers (and which pinned clock) are on screen. The Demo tenant reads the
 * Voltaic fortnight on the demo shell's clock; every other tenant reads the
 * Personal demo week at `DEMO_NOW_MS` until the E5 live local parse. Both
 * corpora flow through the same view-model; they never merge (ENG-027 W2).
 *
 * Render "now" is always `view.nowMs` — the corpus's own pinned instant —
 * never a per-consumer clock.
 */
import { useMemo } from 'react';
import { useOptionalWorkspaceTenancy } from '@/lib/tenancy/tenancy-provider';
import { DEMO_WORKSPACE_ID } from '@/lib/tenancy/workspace-scope';
import { demoConsumption, type DemoConsumption } from './demo-source';
import { voltaicConsumption } from './voltaic-source';

export interface TenantConsumption {
  view: DemoConsumption;
  /** The Demo tenant's Voltaic corpus is on screen, not the Personal week. */
  voltaic: boolean;
}

export function useTenantConsumption(): TenantConsumption {
  const tenancy = useOptionalWorkspaceTenancy();
  const voltaic =
    (tenancy?.hydrated ?? false) &&
    tenancy?.activeWorkspace.id === DEMO_WORKSPACE_ID;
  const view = useMemo(
    () => (voltaic ? voltaicConsumption() : demoConsumption()),
    [voltaic]
  );
  return { view, voltaic };
}
