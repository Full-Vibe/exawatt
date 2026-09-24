import { Suspense } from 'react';
import { SpatialFleetClient } from '@/components/fleet/spatial/spatial-fleet-client';
import { WorkspaceScopeGate } from '@/lib/tenancy/workspace-scope-gate';

// SiteHeaderNav owns the fixed h-12 application navigation. This route is the
// single remaining-viewport owner: loading, scoped, Demo, and Live states all
// inherit it. The viewport gate checks against the actual header bounds.
export default function SpatialFleetPage() {
  return (
    <div className="h-[calc(100dvh-3rem)] min-h-0" data-spatial-viewport>
      <Suspense
        fallback={
          <div className="flex h-full items-center justify-center bg-background text-muted-foreground">
            Loading the fleet…
          </div>
        }
      >
        {/* the Fleet altitude is Personal live truth (window.electron.pty via
          the fleet transport) — a non-personal tenant gets its scoped view,
          never this machine's fleet under another identity (ENG-027). The
          Demo tenant renders the SAME client: the tenant-aware FleetProvider
          swaps the transport underneath, so Demo shows the Voltaic board. */}
        <WorkspaceScopeGate className="min-h-0" demo={<SpatialFleetClient />}>
          <SpatialFleetClient />
        </WorkspaceScopeGate>
      </Suspense>
    </div>
  );
}
